using System.Data;
using System.Globalization;
using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services;

public sealed record DeductionResult(int StatusCode, object? Body = null, Dictionary<string, string[]>? Errors = null, string? Message = null);

/// <summary>
/// Deductions a company takes from a worker's pay for one month (advances, loans, others). They are editable until the
/// month is finalised, after which the payroll snapshot is the only record. Only managers and administrators use this.
/// </summary>
public sealed class DeductionService(AppDbContext db, IAuditLogger audit, TimeProvider time, IHttpContextAccessor httpContext)
{
    public const int MaxNameLength = 40;
    public const int MaxNoteLength = 200;
    public const decimal MaxAmount = 9_999_999.99m;
    private static readonly TimeZoneInfo CompanyTimeZone = TimeZoneInfo.FindSystemTimeZoneById("Asia/Dubai");

    public async Task<IReadOnlyList<DeductionTypeResponse>> ListTypesAsync(CancellationToken ct) =>
        await db.DeductionTypes.AsNoTracking().OrderBy(t => t.Name).Select(t => new DeductionTypeResponse(t.Id, t.Name, t.IsActive)).ToListAsync(ct);

    public async Task<DeductionResult> CreateTypeAsync(DeductionTypeRequest request, CancellationToken ct)
    {
        var name = Clean(request.Name);
        var errors = ValidateName(name);
        if (errors.Count > 0) return new(400, Errors: errors);
        if (await db.DeductionTypes.AnyAsync(t => t.Name == name, ct)) return Duplicate();
        var type = new DeductionType { Name = name, IsActive = true };
        db.DeductionTypes.Add(type);
        audit.Write("DeductionTypeCreated", entityType: nameof(DeductionType), entityId: "new", details: new { name });
        await db.SaveChangesAsync(ct);
        return new(201, new DeductionTypeResponse(type.Id, type.Name, type.IsActive));
    }

    public async Task<DeductionResult> UpdateTypeAsync(int id, DeductionTypeRequest request, CancellationToken ct)
    {
        var type = await db.DeductionTypes.SingleOrDefaultAsync(t => t.Id == id, ct);
        if (type is null) return new(404);
        var name = Clean(request.Name);
        var errors = ValidateName(name);
        if (request.IsActive is null) errors["isActive"] = ["Say whether the deduction type is active."];
        if (errors.Count > 0) return new(400, Errors: errors);
        if (await db.DeductionTypes.AnyAsync(t => t.Id != id && t.Name == name, ct)) return Duplicate();
        var changes = new Dictionary<string, FieldChange>();
        if (type.Name != name) { changes["name"] = new FieldChange(type.Name, name); type.Name = name; }
        if (type.IsActive != request.IsActive!.Value) { changes["isActive"] = new FieldChange(type.IsActive, request.IsActive.Value); type.IsActive = request.IsActive.Value; }
        if (changes.Count > 0)
        {
            audit.Write("DeductionTypeUpdated", entityType: nameof(DeductionType), entityId: id.ToString(CultureInfo.InvariantCulture), details: changes);
            await db.SaveChangesAsync(ct);
        }
        return new(200, new DeductionTypeResponse(type.Id, type.Name, type.IsActive));
    }

    public async Task<DeductionResult> GetMonthAsync(DateOnly month, CancellationToken ct)
    {
        var types = await ListTypesAsync(ct);
        var workers = await db.Workers.AsNoTracking().OrderBy(w => w.WorkerCode).ToListAsync(ct);
        var entries = (await db.WorkerDeductions.AsNoTracking()
            .Where(d => d.Year == month.Year && d.Month == month.Month).ToListAsync(ct)).ToLookup(d => d.WorkerId);
        var finalised = await IsFinalisedAsync(month, ct);
        var rows = workers.Where(w => w.IsActive || entries[w.Id].Any()).Select(w => new MonthDeductionWorker(w.Id, w.WorkerCode, w.FullName, w.IsActive,
            entries[w.Id].OrderBy(e => e.DeductionTypeId)
                .Select(e => new DeductionEntry(e.DeductionTypeId, e.Amount, e.Note)).ToArray())).ToArray();
        return new(200, new MonthDeductionsResponse(Label(month), finalised, types, rows));
    }

    public async Task<DeductionResult> SaveMonthAsync(DateOnly month, MonthDeductionsSaveRequest request, CancellationToken ct)
    {
        var errors = new Dictionary<string, string[]>();
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(time.GetUtcNow(), CompanyTimeZone).DateTime);
        if (month > new DateOnly(today.Year, today.Month, 1)) return new(400, Errors: new() { ["month"] = ["Deductions cannot be entered for a future month."] });
        var rows = request.Workers?.Where(r => r is not null).Cast<MonthDeductionWorkerRequest>().ToList() ?? [];
        if (rows.Select(r => r.WorkerId).Distinct().Count() != rows.Count)
            errors["workers"] = ["Each worker may appear only once."];

        var workerIds = rows.Select(r => r.WorkerId).ToArray();
        var workers = await db.Workers.AsNoTracking().Where(w => workerIds.Contains(w.Id)).Select(w => w.Id).ToListAsync(ct);
        var typeIds = await db.DeductionTypes.AsNoTracking().Where(t => t.IsActive).Select(t => t.Id).ToListAsync(ct);

        for (var i = 0; i < rows.Count; i++)
        {
            var row = rows[i];
            if (!workers.Contains(row.WorkerId)) { errors[$"workers[{i}].workerId"] = ["Worker does not exist."]; continue; }
            var entries = row.Entries ?? [];
            if (entries.Select(e => e.DeductionTypeId).Distinct().Count() != entries.Count)
                errors[$"workers[{i}].entries"] = ["Each deduction type may appear only once per worker."];
            for (var j = 0; j < entries.Count; j++)
            {
                var entry = entries[j];
                var prefix = $"workers[{i}].entries[{j}]";
                if (!typeIds.Contains(entry.DeductionTypeId)) errors[$"{prefix}.deductionTypeId"] = ["Choose an active deduction type."];
                if (entry.Amount is null || entry.Amount <= 0 || entry.Amount > MaxAmount || decimal.Round(entry.Amount.Value, 2) != entry.Amount.Value)
                    errors[$"{prefix}.amount"] = ["Enter an amount above 0 with at most 2 decimal places."];
                var note = Clean(entry.Note);
                if (note.Length == 0) errors[$"{prefix}.note"] = ["Enter the reason for this deduction."];
                else if (note.Length > MaxNoteLength) errors[$"{prefix}.note"] = [$"Reason must be {MaxNoteLength} characters or fewer."];
            }
        }
        if (errors.Count > 0) return new(400, Errors: errors);

        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        try
        {
            if (await IsFinalisedAsync(month, ct)) return new(409, Message: "This month is finalised. Its deductions are locked.");
            var existing = await db.WorkerDeductions.Where(d => d.Year == month.Year && d.Month == month.Month && workerIds.Contains(d.WorkerId)).ToListAsync(ct);
            var actor = httpContext.HttpContext?.User.Identity?.Name ?? "";
            var now = time.GetUtcNow().UtcDateTime;
            var changed = new List<int>();
            foreach (var row in rows)
            {
                var current = existing.Where(d => d.WorkerId == row.WorkerId).ToList();
                var wanted = (row.Entries ?? []).ToDictionary(e => e.DeductionTypeId);
                foreach (var old in current.Where(d => !wanted.ContainsKey(d.DeductionTypeId)).ToList())
                {
                    db.WorkerDeductions.Remove(old);
                    existing.Remove(old);
                    changed.Add(row.WorkerId);
                }
                foreach (var (typeId, entry) in wanted)
                {
                    var note = Clean(entry.Note);
                    var record = current.SingleOrDefault(d => d.DeductionTypeId == typeId);
                    if (record is null)
                    {
                        record = new WorkerDeduction { WorkerId = row.WorkerId, Year = month.Year, Month = month.Month, DeductionTypeId = typeId };
                        db.WorkerDeductions.Add(record);
                        changed.Add(row.WorkerId);
                    }
                    else if (record.Amount == entry.Amount && record.Note == note)
                    {
                        continue;
                    }
                    else changed.Add(row.WorkerId);
                    record.Amount = entry.Amount!.Value;
                    record.Note = note;
                    record.UpdatedBy = actor;
                    record.UpdatedUtc = now;
                }
            }
            if (changed.Count > 0)
                audit.Write("DeductionsSaved", entityType: nameof(WorkerDeduction), entityId: Label(month),
                    details: new { month = Label(month), workersChanged = changed.Distinct().OrderBy(i => i).ToArray() });
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        }
        catch (Exception ex) when (ex is DbUpdateConcurrencyException || ex is Microsoft.EntityFrameworkCore.DbUpdateException)
        {
            return new(409, Message: "The deductions changed while you were saving. Reload and try again.");
        }
        return await GetMonthAsync(month, ct);
    }

    private async Task<bool> IsFinalisedAsync(DateOnly month, CancellationToken ct) =>
        await db.PayrollPeriods.AnyAsync(p => p.Year == month.Year && p.Month == month.Month, ct);

    private static string Clean(string? value) => (value ?? "").Trim();

    private static Dictionary<string, string[]> ValidateName(string name)
    {
        var errors = new Dictionary<string, string[]>();
        if (name.Length == 0) errors["name"] = ["Enter a name for the deduction type."];
        else if (name.Length > MaxNameLength) errors["name"] = [$"Name must be {MaxNameLength} characters or fewer."];
        return errors;
    }

    private static DeductionResult Duplicate() =>
        new(400, Errors: new() { ["name"] = ["A deduction type with this name already exists."] });

    public static string Label(DateOnly month) => month.ToString("yyyy-MM", CultureInfo.InvariantCulture);
}
