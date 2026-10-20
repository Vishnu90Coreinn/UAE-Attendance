using System.Globalization;
using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services;

/// <summary>
/// Result of saving the payroll settings. <see cref="Errors"/> maps a camelCase field name to a user-readable message
/// when the body was rejected; <see cref="Settings"/> is set otherwise.
/// </summary>
public sealed record SettingsResult(PayrollSettingsResponse? Settings = null, IReadOnlyDictionary<string, string>? Errors = null)
{
    public bool Succeeded => Settings is not null;
}

/// <summary>Reads and (for the Administrator) edits the single company-wide <see cref="PayrollSettings"/> row.</summary>
public sealed class SettingsService(AppDbContext db, IAuditLogger audit)
{
    public const int MaxCompanyNameLength = 120;
    public const int MaxTaglineLength = 200;
    public const int MaxContactEmailLength = 120;
    public const int MaxLabelLength = 60;
    public const decimal MaxOvertimeRatePerHour = 999.99m;
    public const decimal MaxBasicHoursLimit = 24m;

    public async Task<PayrollSettingsResponse> GetAsync(CancellationToken cancellationToken = default) =>
        ToResponse(await db.PayrollSettings.AsNoTracking()
            .SingleAsync(s => s.Id == PayrollSettings.SingletonId, cancellationToken));

    /// <summary>
    /// Validates and saves every field. Saving values equal to the stored ones succeeds and writes no audit row;
    /// otherwise one <c>SettingsChanged</c> row lists only the changed fields as <c>{old, new}</c>.
    /// </summary>
    public async Task<SettingsResult> UpdateAsync(PayrollSettingsRequest request, CancellationToken cancellationToken = default)
    {
        var input = Validate(request, out var errors);
        if (input is null)
        {
            return new SettingsResult(Errors: errors);
        }

        var settings = await db.PayrollSettings.SingleAsync(s => s.Id == PayrollSettings.SingletonId, cancellationToken);

        var changes = new Dictionary<string, FieldChange>();
        Apply(changes, "companyName", settings.CompanyName, input.CompanyName, v => settings.CompanyName = v);
        Apply(changes, "tagline", settings.Tagline, input.Tagline, v => settings.Tagline = v);
        Apply(changes, "contactEmail", settings.ContactEmail, input.ContactEmail, v => settings.ContactEmail = v);
        Apply(changes, "overtimeRatePerHour", settings.OvertimeRatePerHour, input.OvertimeRatePerHour, v => settings.OvertimeRatePerHour = v);
        Apply(changes, "maxBasicHoursPerDay", settings.MaxBasicHoursPerDay, input.MaxBasicHoursPerDay, v => settings.MaxBasicHoursPerDay = v);
        Apply(changes, "shiftDescription", settings.ShiftDescription, input.ShiftDescription, v => settings.ShiftDescription = v);
        Apply(changes, "preparedByLabel", settings.PreparedByLabel, input.PreparedByLabel, v => settings.PreparedByLabel = v);
        Apply(changes, "approvedByLabel", settings.ApprovedByLabel, input.ApprovedByLabel, v => settings.ApprovedByLabel = v);

        if (changes.Count > 0)
        {
            audit.Write("SettingsChanged", entityType: nameof(PayrollSettings),
                entityId: PayrollSettings.SingletonId.ToString(CultureInfo.InvariantCulture), details: changes);
            await db.SaveChangesAsync(cancellationToken);
        }

        return new SettingsResult(ToResponse(settings));
    }

    // --- helpers -------------------------------------------------------------------------------------------

    private static void Apply<T>(Dictionary<string, FieldChange> changes, string field, T current, T incoming, Action<T> assign)
        where T : notnull
    {
        // Strings are compared exactly (ordinal) on purpose: a change of case is a change.
        if (EqualityComparer<T>.Default.Equals(current, incoming))
        {
            return;
        }

        changes[field] = new FieldChange(current, incoming);
        assign(incoming);
    }

    private sealed record ValidSettings(
        string CompanyName, string Tagline, string ContactEmail, decimal OvertimeRatePerHour,
        decimal MaxBasicHoursPerDay, string ShiftDescription, string PreparedByLabel, string ApprovedByLabel);

    /// <summary>Returns the trimmed values, or null with <paramref name="errors"/> filled in (one message per field).</summary>
    private static ValidSettings? Validate(PayrollSettingsRequest request, out Dictionary<string, string> errors)
    {
        errors = [];

        var companyName = RequiredText(errors, "companyName", "Company name", request.CompanyName, MaxCompanyNameLength);
        var tagline = (request.Tagline ?? "").Trim();
        if (tagline.Length > MaxTaglineLength)
        {
            errors["tagline"] = $"Tagline must be {MaxTaglineLength} characters or fewer.";
        }

        var contactEmail = RequiredText(errors, "contactEmail", "Contact email", request.ContactEmail, MaxContactEmailLength);
        if (!errors.ContainsKey("contactEmail") && !LooksLikeAnEmail(contactEmail))
        {
            errors["contactEmail"] = "Contact email must be a valid email address.";
        }

        var overtime = request.OvertimeRatePerHour;
        if (overtime is null)
        {
            errors["overtimeRatePerHour"] = "Overtime rate is required.";
        }
        else if (overtime < 0)
        {
            errors["overtimeRatePerHour"] = "Overtime rate cannot be negative.";
        }
        else if (overtime > MaxOvertimeRatePerHour)
        {
            errors["overtimeRatePerHour"] = $"Overtime rate must be {MaxOvertimeRatePerHour.ToString("0.00", CultureInfo.InvariantCulture)} or less.";
        }
        else if (decimal.Round(overtime.Value, 2) != overtime.Value)
        {
            errors["overtimeRatePerHour"] = "Overtime rate can have at most 2 decimal places.";
        }

        var maxBasic = request.MaxBasicHoursPerDay;
        if (maxBasic is null)
        {
            errors["maxBasicHoursPerDay"] = "Maximum basic hours per day is required.";
        }
        else if (maxBasic <= 0)
        {
            errors["maxBasicHoursPerDay"] = "Maximum basic hours per day must be greater than 0.";
        }
        else if (maxBasic > MaxBasicHoursLimit)
        {
            errors["maxBasicHoursPerDay"] = $"Maximum basic hours per day must be {MaxBasicHoursLimit.ToString("0", CultureInfo.InvariantCulture)} or less.";
        }
        else if (decimal.Round(maxBasic.Value, 2) != maxBasic.Value)
        {
            errors["maxBasicHoursPerDay"] = "Maximum basic hours per day can have at most 2 decimal places.";
        }

        var shift = RequiredText(errors, "shiftDescription", "Shift description", request.ShiftDescription, MaxLabelLength);
        var preparedBy = RequiredText(errors, "preparedByLabel", "Prepared by label", request.PreparedByLabel, MaxLabelLength);
        var approvedBy = RequiredText(errors, "approvedByLabel", "Approved by label", request.ApprovedByLabel, MaxLabelLength);

        return errors.Count == 0
            ? new ValidSettings(companyName, tagline, contactEmail, overtime!.Value, maxBasic!.Value, shift, preparedBy, approvedBy)
            : null;
    }

    private static string RequiredText(Dictionary<string, string> errors, string field, string label, string? value, int maxLength)
    {
        var text = (value ?? "").Trim();
        if (text.Length == 0)
        {
            errors[field] = $"{label} is required.";
        }
        else if (text.Length > maxLength)
        {
            errors[field] = $"{label} must be {maxLength} characters or fewer.";
        }

        return text;
    }

    /// <summary>A deliberately simple check: exactly one <c>@</c>, text on both sides and no whitespace.</summary>
    private static bool LooksLikeAnEmail(string value)
    {
        var at = value.IndexOf('@');
        return at > 0
            && at == value.LastIndexOf('@')
            && at < value.Length - 1
            && !value.Any(char.IsWhiteSpace);
    }

    private static PayrollSettingsResponse ToResponse(PayrollSettings settings) =>
        new(settings.CompanyName, settings.Tagline, settings.ContactEmail, settings.OvertimeRatePerHour,
            settings.MaxBasicHoursPerDay, settings.ShiftDescription, settings.PreparedByLabel, settings.ApprovedByLabel);
}
