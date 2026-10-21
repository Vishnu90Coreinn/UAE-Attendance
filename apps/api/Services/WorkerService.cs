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

    private const string CodePrefix = "EMP-";
    private const int MinCodeDigits = 3;

    // SQL Server error numbers: unique index / unique constraint violation, and foreign key (or check) violation.
    private const int UniqueIndexViolation = 2601;
    private const int UniqueConstraintViolation = 2627;
    private const int ConstraintViolation = 547;

    [GeneratedRegex(@"^[A-Za-z0-9_-]+\z")]
    private static partial Regex CodePattern();

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
        return workers.Select(w => ToResponse(w, companyRate)).ToList();
    }

    public async Task<WorkerResponse?> GetAsync(int id, CancellationToken cancellationToken = default)
    {
        var worker = await db.Workers.AsNoTracking().SingleOrDefaultAsync(w => w.Id == id, cancellationToken);
        return worker is null ? null : ToResponse(worker, await CompanyOvertimeRateAsync(cancellationToken));
    }

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
            IsActive = true,
            CreatedUtc = now,
            UpdatedUtc = now,
        };

        // The audit row needs the new id, which exists only after the insert, so both saves share one transaction.
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        db.Workers.Add(worker);
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
        return new WorkerResult(WorkerOutcome.Success, ToResponse(worker, await CompanyOvertimeRateAsync(cancellationToken)));
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

        if (changes.Count == 0)
        {
            return new WorkerResult(WorkerOutcome.Success, ToResponse(worker, await CompanyOvertimeRateAsync(cancellationToken)));
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
            return new WorkerResult(WorkerOutcome.Success, ToResponse(worker, await CompanyOvertimeRateAsync(cancellationToken)));
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

    private sealed record ValidWorker(string Code, string FullName, string Designation, decimal HourlyRate, decimal? OvertimeRate);

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

        return errors.Count == 0 ? new ValidWorker(code, fullName, designation, rate!.Value, overtime) : null;
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
            SaveOutcome.Saved => new WorkerResult(WorkerOutcome.Success, ToResponse(worker, await CompanyOvertimeRateAsync(cancellationToken))),
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

    private static WorkerResponse ToResponse(Worker worker, decimal companyOvertimeRate) =>
        new(worker.Id, worker.WorkerCode, worker.FullName, worker.Designation, worker.HourlyRate,
            worker.OvertimeRate, worker.OvertimeRate ?? companyOvertimeRate, worker.IsActive, worker.JoinDate);
}
