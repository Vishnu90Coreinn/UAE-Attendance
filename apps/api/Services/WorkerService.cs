using System.Globalization;
using System.Text.RegularExpressions;
using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services;

public enum WorkerOutcome
{
    Success,
    NotFound,
    /// <summary>One or more fields were rejected; see <see cref="WorkerResult.Errors"/>.</summary>
    Invalid,
    /// <summary>The worker is referenced by other records and cannot be deleted.</summary>
    InUse,
}

/// <summary>
/// Result of a worker operation. <see cref="Worker"/> is set for creates, updates and status changes;
/// <see cref="Errors"/> maps a camelCase field name to a user-readable message for <see cref="WorkerOutcome.Invalid"/>.
/// </summary>
public sealed record WorkerResult(
    WorkerOutcome Outcome, WorkerResponse? Worker = null, IReadOnlyDictionary<string, string>? Errors = null)
{
    public bool Succeeded => Outcome == WorkerOutcome.Success;
}

public partial class WorkerService(AppDbContext db, IAuditLogger audit, TimeProvider time)
{
    public const string DuplicateCodeMessage = "Worker ID already exists.";
    public const string InUseMessage = "This worker has records and cannot be deleted. Deactivate the worker instead.";

    public const int MaxCodeLength = 20;
    public const int MaxNameLength = 120;
    public const int MaxDesignationLength = 80;
    public const decimal MaxHourlyRate = 999.99m;
    public const decimal MaxOvertimeRate = 999.99m;
    public const int MaxDepartmentLength = 80;
    public const int MaxEmiratesIdLength = 25;
    public const int MaxPassportLength = 20;
    public const int MaxPhoneLength = 25;
    public const int MaxEmailLength = 120;
    public const int MaxEmergencyContactLength = 150;
    public const int MaxWorkLocationLength = 120;
    public const int MaxNotesLength = 1000;

    private const string CodePrefix = "EMP-";
    private const int MinCodeDigits = 3;

    // SQL Server error numbers: unique index / unique constraint violation, and foreign key (or check) violation.
    private const int UniqueIndexViolation = 2601;
    private const int UniqueConstraintViolation = 2627;
    private const int ConstraintViolation = 547;

    [GeneratedRegex(@"^[A-Za-z0-9_-]+\z")]
    private static partial Regex CodePattern();

    [GeneratedRegex(@"^[^@\s]+@[^@\s]+\.[^@\s]+\z")]
    private static partial Regex EmailPattern();

    [GeneratedRegex(@"^EMP-([0-9]+)\z", RegexOptions.IgnoreCase)]
    private static partial Regex GeneratedCodePattern();

    // --- reads ---------------------------------------------------------------------------------------------

    public async Task<List<WorkerResponse>> ListAsync(bool includeInactive, CancellationToken cancellationToken = default)
    {
        var query = db.Workers.AsNoTracking();
        if (!includeInactive)
        {
            query = query.Where(w => w.IsActive);
        }

        var workers = await query.OrderBy(w => w.WorkerCode).ToListAsync(cancellationToken);
        var companyRate = await CompanyOvertimeRateAsync(cancellationToken);
        var withPhoto = (await db.WorkerPhotos.AsNoTracking().Select(p => p.WorkerId).ToListAsync(cancellationToken)).ToHashSet();
        return workers.Select(w => ToResponse(w, companyRate, withPhoto.Contains(w.Id))).ToList();
    }

    public async Task<WorkerResponse?> GetAsync(int id, CancellationToken cancellationToken = default)
    {
        var worker = await db.Workers.AsNoTracking().SingleOrDefaultAsync(w => w.Id == id, cancellationToken);
        return worker is null ? null : await RespondAsync(worker, cancellationToken);
    }

    /// <summary>The worker's stored portrait (JPEG), or null when there is none.</summary>
    public Task<byte[]?> GetPhotoAsync(int id, CancellationToken cancellationToken = default) =>
        db.WorkerPhotos.AsNoTracking().Where(p => p.WorkerId == id).Select(p => (byte[]?)p.Data).SingleOrDefaultAsync(cancellationToken);

    private async Task<WorkerResponse> RespondAsync(Worker worker, CancellationToken cancellationToken) =>
        ToResponse(worker, await CompanyOvertimeRateAsync(cancellationToken),
            await db.WorkerPhotos.AsNoTracking().AnyAsync(p => p.WorkerId == worker.Id, cancellationToken));

    /// <summary>
    /// <c>EMP-</c> plus one more than the highest number among codes shaped <c>EMP-</c>digits, padded to at least three
    /// digits. Inactive workers count, other code shapes are ignored, and the result is never an existing code.
    /// </summary>
    public async Task<string> NextCodeAsync(CancellationToken cancellationToken = default)
    {
        var codes = await db.Workers.AsNoTracking()
            .Where(w => w.WorkerCode.StartsWith(CodePrefix))
            .Select(w => w.WorkerCode)
            .ToListAsync(cancellationToken);

        // At most 16 digits fit in a 20-character code, so the number always fits in a long.
        var highest = codes
            .Select(code => GeneratedCodePattern().Match(code))
            .Where(match => match.Success)
            .Select(match => long.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture))
            .DefaultIfEmpty(0)
            .Max();

        var existing = new HashSet<string>(codes, StringComparer.OrdinalIgnoreCase);
        string next;
        do
        {
            highest++;
            next = CodePrefix + highest.ToString($"D{MinCodeDigits}", CultureInfo.InvariantCulture);
        }
        while (existing.Contains(next));

        return next;
    }

    // --- writes --------------------------------------------------------------------------------------------

    public async Task<WorkerResult> CreateAsync(WorkerRequest request, CancellationToken cancellationToken = default)
    {
        var input = Validate(request, out var errors);
        if (input is null)
        {
            return new WorkerResult(WorkerOutcome.Invalid, Errors: errors);
        }

        if (await db.Workers.AnyAsync(w => w.WorkerCode == input.Code, cancellationToken))
        {
            return DuplicateCode();
        }

        var now = time.GetUtcNow().UtcDateTime;
        var worker = new Worker
        {
            WorkerCode = input.Code,
            FullName = input.FullName,
            Designation = input.Designation,
            HourlyRate = input.HourlyRate,
            OvertimeRate = input.OvertimeRate,
            JoinDate = request.JoinDate,
            Department = input.Department,
            EmiratesId = input.EmiratesId,
            PassportNumber = input.PassportNumber,
            Phone = input.Phone,
            Email = input.Email,
            EmergencyContact = input.EmergencyContact,
            WorkLocation = input.WorkLocation,
            Notes = input.Notes,
            ContractSigned = request.ContractSigned ?? false,
            VisaMedicalCleared = request.VisaMedicalCleared ?? false,
            SafetyGearIssued = request.SafetyGearIssued ?? false,
            SiteOrientationDone = request.SiteOrientationDone ?? false,
            WpsRegistered = request.WpsRegistered ?? false,
            BadgeIssued = request.BadgeIssued ?? false,
            IsActive = true,
            CreatedUtc = now,
            UpdatedUtc = now,
        };

        // The audit row needs the new id, which exists only after the insert, so both saves share one transaction.
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        db.Workers.Add(worker);
        PhotoUpload.TryDecode(request.PhotoBase64, out var photo);
        if (photo is not null)
        {
            db.WorkerPhotos.Add(new WorkerPhoto { Worker = worker, Data = photo, UpdatedUtc = now });
        }

        if (await TrySaveAsync(cancellationToken) == SaveOutcome.DuplicateCode)
        {
            return DuplicateCode();
        }

        // Only an explicit overtime rate is worth recording; a worker created on the company rate has nothing to add.
        object? details = worker.OvertimeRate is null
            ? null
            : new Dictionary<string, FieldChange> { ["overtimeRate"] = new(null, worker.OvertimeRate) };
        audit.Write("WorkerCreated", entityType: nameof(Worker), entityId: worker.Id.ToString(CultureInfo.InvariantCulture), details: details);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new WorkerResult(WorkerOutcome.Success, ToResponse(worker, await CompanyOvertimeRateAsync(cancellationToken), photo is not null));
    }

    public async Task<WorkerResult> UpdateAsync(int id, WorkerRequest request, CancellationToken cancellationToken = default)
    {
        var worker = await db.Workers.SingleOrDefaultAsync(w => w.Id == id, cancellationToken);
        if (worker is null)
        {
            return new WorkerResult(WorkerOutcome.NotFound);
        }

        var input = Validate(request, out var errors);
        if (input is null)
        {
            return new WorkerResult(WorkerOutcome.Invalid, Errors: errors);
        }

        if (await db.Workers.AnyAsync(w => w.Id != id && w.WorkerCode == input.Code, cancellationToken))
        {
            return DuplicateCode();
        }

        var changes = new Dictionary<string, FieldChange>();
        if (!string.Equals(worker.WorkerCode, input.Code, StringComparison.Ordinal))
        {
            changes["workerCode"] = new FieldChange(worker.WorkerCode, input.Code);
            worker.WorkerCode = input.Code;
        }

        if (!string.Equals(worker.FullName, input.FullName, StringComparison.Ordinal))
        {
            changes["fullName"] = new FieldChange(worker.FullName, input.FullName);
            worker.FullName = input.FullName;
        }

        if (!string.Equals(worker.Designation, input.Designation, StringComparison.Ordinal))
        {
            changes["designation"] = new FieldChange(worker.Designation, input.Designation);
            worker.Designation = input.Designation;
        }

        if (worker.HourlyRate != input.HourlyRate)
        {
            changes["hourlyRate"] = new FieldChange(worker.HourlyRate, input.HourlyRate);
            worker.HourlyRate = input.HourlyRate;
        }

        if (worker.JoinDate != request.JoinDate)
        {
            changes["joinDate"] = new FieldChange(worker.JoinDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                request.JoinDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
            worker.JoinDate = request.JoinDate;
        }

        if (worker.OvertimeRate != input.OvertimeRate)
        {
            changes["overtimeRate"] = new FieldChange(worker.OvertimeRate, input.OvertimeRate);
            worker.OvertimeRate = input.OvertimeRate;
        }

        if (worker.Department != input.Department)
        {
            changes["department"] = new FieldChange(worker.Department, input.Department);
            worker.Department = input.Department;
        }

        if (worker.EmiratesId != input.EmiratesId)
        {
            changes["emiratesId"] = new FieldChange(worker.EmiratesId, input.EmiratesId);
            worker.EmiratesId = input.EmiratesId;
        }

        if (worker.PassportNumber != input.PassportNumber)
        {
            changes["passportNumber"] = new FieldChange(worker.PassportNumber, input.PassportNumber);
            worker.PassportNumber = input.PassportNumber;
        }

        if (worker.Phone != input.Phone)
        {
            changes["phone"] = new FieldChange(worker.Phone, input.Phone);
            worker.Phone = input.Phone;
        }

        if (worker.Email != input.Email)
        {
            changes["email"] = new FieldChange(worker.Email, input.Email);
            worker.Email = input.Email;
        }

        if (worker.EmergencyContact != input.EmergencyContact)
        {
            changes["emergencyContact"] = new FieldChange(worker.EmergencyContact, input.EmergencyContact);
            worker.EmergencyContact = input.EmergencyContact;
        }

        if (worker.WorkLocation != input.WorkLocation)
        {
            changes["workLocation"] = new FieldChange(worker.WorkLocation, input.WorkLocation);
            worker.WorkLocation = input.WorkLocation;
        }

        if (worker.Notes != input.Notes)
        {
            changes["notes"] = new FieldChange(worker.Notes, input.Notes);
            worker.Notes = input.Notes;
        }

        // A checklist item missing from the request is left as it is.
        void Check(string key, bool current, bool? requested, Action<bool> set)
        {
            if (requested is { } value && value != current)
            {
                changes[key] = new FieldChange(current, value);
                set(value);
            }
        }

        Check("contractSigned", worker.ContractSigned, request.ContractSigned, v => worker.ContractSigned = v);
        Check("visaMedicalCleared", worker.VisaMedicalCleared, request.VisaMedicalCleared, v => worker.VisaMedicalCleared = v);
        Check("safetyGearIssued", worker.SafetyGearIssued, request.SafetyGearIssued, v => worker.SafetyGearIssued = v);
        Check("siteOrientationDone", worker.SiteOrientationDone, request.SiteOrientationDone, v => worker.SiteOrientationDone = v);
        Check("wpsRegistered", worker.WpsRegistered, request.WpsRegistered, v => worker.WpsRegistered = v);
        Check("badgeIssued", worker.BadgeIssued, request.BadgeIssued, v => worker.BadgeIssued = v);

        // A new photo replaces the old one; RemovePhoto clears it. The image itself is never written to the audit log.
        var stored = await db.WorkerPhotos.SingleOrDefaultAsync(p => p.WorkerId == id, cancellationToken);
        PhotoUpload.TryDecode(request.PhotoBase64, out var photo);
        var now = time.GetUtcNow().UtcDateTime;
        if (photo is not null)
        {
            if (stored is null) db.WorkerPhotos.Add(new WorkerPhoto { WorkerId = id, Data = photo, UpdatedUtc = now });
            else { stored.Data = photo; stored.UpdatedUtc = now; }
            changes["photo"] = new FieldChange(stored is null ? null : "photo", "photo");
        }
        else if (request.RemovePhoto == true && stored is not null)
        {
            db.WorkerPhotos.Remove(stored);
            stored = null;
            changes["photo"] = new FieldChange("photo", null);
        }

        if (changes.Count == 0)
        {
            return new WorkerResult(WorkerOutcome.Success, await RespondAsync(worker, cancellationToken));
        }

        worker.UpdatedUtc = time.GetUtcNow().UtcDateTime;
        audit.Write("WorkerUpdated", entityType: nameof(Worker), entityId: IdText(worker), details: changes);
        return await SaveChangeAsync(worker, cancellationToken);
    }

    /// <summary>Deactivates or reactivates a worker. Asking for the state the worker is already in changes and audits nothing.</summary>
    public async Task<WorkerResult> SetActiveAsync(int id, bool active, CancellationToken cancellationToken = default)
    {
        var worker = await db.Workers.SingleOrDefaultAsync(w => w.Id == id, cancellationToken);
        if (worker is null)
        {
            return new WorkerResult(WorkerOutcome.NotFound);
        }

        if (worker.IsActive == active)
        {
            return new WorkerResult(WorkerOutcome.Success, await RespondAsync(worker, cancellationToken));
        }

        worker.IsActive = active;
        worker.UpdatedUtc = time.GetUtcNow().UtcDateTime;
        audit.Write(active ? "WorkerActivated" : "WorkerDeactivated", entityType: nameof(Worker), entityId: IdText(worker));
        return await SaveChangeAsync(worker, cancellationToken);
    }

    public async Task<WorkerResult> DeleteAsync(int id, CancellationToken cancellationToken = default)
    {
        var worker = await db.Workers.SingleOrDefaultAsync(w => w.Id == id, cancellationToken);
        if (worker is null)
        {
            return new WorkerResult(WorkerOutcome.NotFound);
        }

        db.Workers.Remove(worker);
        audit.Write("WorkerDeleted", entityType: nameof(Worker), entityId: IdText(worker),
            details: new { workerCode = worker.WorkerCode, fullName = worker.FullName });

        return await TrySaveAsync(cancellationToken, deleting: true) switch
        {
            SaveOutcome.Saved => new WorkerResult(WorkerOutcome.Success),
            SaveOutcome.InUse => new WorkerResult(WorkerOutcome.InUse),
            _ => new WorkerResult(WorkerOutcome.NotFound), // removed by someone else in the meantime
        };
    }

    // --- helpers -------------------------------------------------------------------------------------------

    private sealed record ValidWorker(
        string Code, string FullName, string Designation, decimal HourlyRate, decimal? OvertimeRate,
        string? Department, string? EmiratesId, string? PassportNumber, string? Phone,
        string? Email, string? EmergencyContact, string? WorkLocation, string? Notes);

    /// <summary>Trims an optional text field; blank becomes null and too-long text records an error under <paramref name="key"/>.</summary>
    private static string? OptionalText(string? value, int maxLength, string key, string label, Dictionary<string, string> errors)
    {
        var text = (value ?? "").Trim();
        if (text.Length == 0)
        {
            return null;
        }

        if (text.Length > maxLength)
        {
            errors[key] = $"{label} must be {maxLength} characters or fewer.";
        }

        return text;
    }

    /// <summary>Returns the cleaned-up values, or null with <paramref name="errors"/> filled in (one message per field).</summary>
    private static ValidWorker? Validate(WorkerRequest request, out Dictionary<string, string> errors)
    {
        errors = [];

        var code = request.WorkerCode ?? "";
        if (code.Length == 0)
        {
            errors["workerCode"] = "Worker ID is required.";
        }
        else if (code.Length > MaxCodeLength)
        {
            errors["workerCode"] = $"Worker ID must be {MaxCodeLength} characters or fewer.";
        }
        else if (!CodePattern().IsMatch(code))
        {
            errors["workerCode"] = "Worker ID can contain only letters, numbers, hyphens and underscores.";
        }

        var fullName = (request.FullName ?? "").Trim();
        if (fullName.Length == 0)
        {
            errors["fullName"] = "Full name is required.";
        }
        else if (fullName.Length > MaxNameLength)
        {
            errors["fullName"] = $"Full name must be {MaxNameLength} characters or fewer.";
        }

        var designation = (request.Designation ?? "").Trim();
        if (designation.Length == 0)
        {
            errors["designation"] = "Designation is required.";
        }
        else if (designation.Length > MaxDesignationLength)
        {
            errors["designation"] = $"Designation must be {MaxDesignationLength} characters or fewer.";
        }

        var rate = request.HourlyRate;
        if (rate is null)
        {
            errors["hourlyRate"] = "Hourly rate is required.";
        }
        else if (rate <= 0)
        {
            errors["hourlyRate"] = "Hourly rate must be greater than 0.";
        }
        else if (rate > MaxHourlyRate)
        {
            errors["hourlyRate"] = $"Hourly rate must be {MaxHourlyRate.ToString("0.00", CultureInfo.InvariantCulture)} or less.";
        }
        else if (decimal.Round(rate.Value, 2) != rate.Value)
        {
            errors["hourlyRate"] = "Hourly rate can have at most 2 decimal places.";
        }

        // Optional: null (or missing) means "use the company rate". 0 is a real value (no overtime pay).
        var overtime = request.OvertimeRate;
        if (overtime is < 0)
        {
            errors["overtimeRate"] = "Overtime rate cannot be negative.";
        }
        else if (overtime > MaxOvertimeRate)
        {
            errors["overtimeRate"] = $"Overtime rate must be {MaxOvertimeRate.ToString("0.00", CultureInfo.InvariantCulture)} or less.";
        }
        else if (overtime is not null && decimal.Round(overtime.Value, 2) != overtime.Value)
        {
            errors["overtimeRate"] = "Overtime rate can have at most 2 decimal places.";
        }

        var department = OptionalText(request.Department, MaxDepartmentLength, "department", "Department", errors);
        var emiratesId = OptionalText(request.EmiratesId, MaxEmiratesIdLength, "emiratesId", "Emirates ID", errors);
        var passport = OptionalText(request.PassportNumber, MaxPassportLength, "passportNumber", "Passport number", errors);
        var phone = OptionalText(request.Phone, MaxPhoneLength, "phone", "Phone", errors);
        var email = OptionalText(request.Email, MaxEmailLength, "email", "Email", errors);
        if (email is not null && !errors.ContainsKey("email") && !EmailPattern().IsMatch(email))
        {
            errors["email"] = "Enter a valid email address.";
        }

        var emergency = OptionalText(request.EmergencyContact, MaxEmergencyContactLength, "emergencyContact", "Emergency contact", errors);
        var location = OptionalText(request.WorkLocation, MaxWorkLocationLength, "workLocation", "Work location", errors);
        var notes = OptionalText(request.Notes, MaxNotesLength, "notes", "Notes", errors);
        if (!PhotoUpload.TryDecode(request.PhotoBase64, out _))
        {
            errors["photo"] = "The photo must be a JPEG image of at most 3 MB.";
        }

        return errors.Count == 0
            ? new ValidWorker(code, fullName, designation, rate!.Value, overtime,
                department, emiratesId, passport, phone, email, emergency, location, notes)
            : null;
    }

    private enum SaveOutcome
    {
        Saved,
        DuplicateCode,
        /// <summary>A foreign key stopped a delete.</summary>
        InUse,
        /// <summary>The row was deleted by someone else after it was loaded.</summary>
        Gone,
    }

    private async Task<SaveOutcome> TrySaveAsync(CancellationToken cancellationToken, bool deleting = false)
    {
        try
        {
            await db.SaveChangesAsync(cancellationToken);
            return SaveOutcome.Saved;
        }
        catch (DbUpdateConcurrencyException)
        {
            return SaveOutcome.Gone;
        }
        catch (DbUpdateException exception) when (
            exception.InnerException is SqlException { Number: UniqueIndexViolation or UniqueConstraintViolation })
        {
            // Two requests can pass the existence check together; the unique index is what really decides.
            return SaveOutcome.DuplicateCode;
        }
        catch (DbUpdateException exception) when (
            deleting && exception.InnerException is SqlException { Number: ConstraintViolation })
        {
            return SaveOutcome.InUse;
        }
    }

    private async Task<WorkerResult> SaveChangeAsync(Worker worker, CancellationToken cancellationToken) =>
        await TrySaveAsync(cancellationToken) switch
        {
            SaveOutcome.Saved => new WorkerResult(WorkerOutcome.Success, await RespondAsync(worker, cancellationToken)),
            SaveOutcome.DuplicateCode => DuplicateCode(),
            _ => new WorkerResult(WorkerOutcome.NotFound),
        };

    private static WorkerResult DuplicateCode() =>
        new(WorkerOutcome.Invalid, Errors: new Dictionary<string, string> { ["workerCode"] = DuplicateCodeMessage });

    private static string IdText(Worker worker) => worker.Id.ToString(CultureInfo.InvariantCulture);

    private Task<decimal> CompanyOvertimeRateAsync(CancellationToken cancellationToken) =>
        db.PayrollSettings.AsNoTracking()
            .Where(s => s.Id == PayrollSettings.SingletonId)
            .Select(s => s.OvertimeRatePerHour)
            .SingleAsync(cancellationToken);

    private static WorkerResponse ToResponse(Worker worker, decimal companyOvertimeRate, bool hasPhoto) =>
        new(worker.Id, worker.WorkerCode, worker.FullName, worker.Designation, worker.HourlyRate,
            worker.OvertimeRate, worker.OvertimeRate ?? companyOvertimeRate, worker.IsActive, worker.JoinDate,
            worker.Department, worker.EmiratesId, worker.PassportNumber, worker.Phone,
            worker.Email, worker.EmergencyContact, worker.WorkLocation, worker.Notes,
            worker.ContractSigned, worker.VisaMedicalCleared, worker.SafetyGearIssued,
            worker.SiteOrientationDone, worker.WpsRegistered, worker.BadgeIssued, hasPhoto);
}
