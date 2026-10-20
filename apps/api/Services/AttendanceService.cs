using System.Data;
using System.Globalization;
using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services;

public sealed record AttendanceResult(int StatusCode, AttendanceDayResponse? Day = null,
    Dictionary<string, string[]>? Errors = null);

public sealed class AttendanceService(AppDbContext db, IAuditLogger audit, TimeProvider time,
    IPayrollPeriodLock periodLock, IHttpContextAccessor httpContext)
{
    public async Task<AttendanceResult> GetAsync(string? date, CancellationToken ct)
    {
        if (!TryDate(date, out var day)) return Invalid("date", "Choose a valid date in YYYY-MM-DD format that is not in the future.");
        return new(200, await ReadAsync(day, ct));
    }

    public async Task<AttendanceResult> SaveAsync(string date, IReadOnlyList<AttendanceRequest?> requests, CancellationToken ct)
    {
        if (!TryDate(date, out var day)) return Invalid("date", "Choose a valid date in YYYY-MM-DD format that is not in the future.");
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        try
        {
            if (await periodLock.IsFinalisedAsync(db, day, ct)) return new(409);
            var settings = await db.PayrollSettings.AsNoTracking().SingleAsync(ct);
            var ids = requests.Where(r => r is not null).Select(r => r!.WorkerId).ToArray();
            var workers = await db.Workers.Where(w => ids.Contains(w.Id)).ToDictionaryAsync(w => w.Id, ct);
            var existing = await db.Attendance.Where(a => a.WorkDate == day && ids.Contains(a.WorkerId)).ToDictionaryAsync(a => a.WorkerId, ct);
            var errors = new Dictionary<string, string[]>();
            var seen = new HashSet<int>();
            for (var i = 0; i < requests.Count; i++)
            {
                var row = requests[i];
                void Error(string field, string message) => errors[$"rows[{i}].{field}"] = [message];
                if (row is null) { Error("workerId", "A row is required."); continue; }
                if (!seen.Add(row.WorkerId)) Error("workerId", "Each worker may appear only once.");
                if (!workers.TryGetValue(row.WorkerId, out var worker)) Error("workerId", "Worker does not exist.");
                else if (!worker.IsActive && !existing.ContainsKey(row.WorkerId)) Error("workerId", "Inactive workers can only edit an existing record for this date.");
                if (row.Status is not (null or "Present" or "Absent")) Error("status", "Choose Present, Absent or Not recorded.");
                ValidateHours(row.BasicHours, "basicHours");
                ValidateHours(row.OvertimeHours, "overtimeHours");
                void ValidateHours(decimal? hours, string field)
                {
                    if (hours is null or < 0 or > 24 || decimal.Round(hours.Value, 2) != hours.Value)
                        Error(field, "Hours must be between 0 and 24 with at most 2 decimal places.");
                }
                if (row.Status == "Present")
                {
                    if (row.BasicHours <= 0 || row.BasicHours > settings.MaxBasicHoursPerDay) Error("basicHours", $"Present requires basic hours greater than 0 and no more than {settings.MaxBasicHoursPerDay}.");
                    if (row.BasicHours + row.OvertimeHours > 24) Error("overtimeHours", "Total hours cannot exceed 24.");
                }
                if (row.Status is null && (row.BasicHours != 0 || row.OvertimeHours != 0)) Error("status", "Not recorded requires zero hours.");
            }
            if (errors.Count > 0) return new(400, Errors: errors);
            var changed = new List<int>();
            foreach (var input in requests)
            {
                var row = input!;
                existing.TryGetValue(row.WorkerId, out var record);
                if (row.Status is null)
                {
                    if (record is not null) { db.Attendance.Remove(record); changed.Add(row.WorkerId); }
                    continue;
                }
                var basic = row.Status == "Absent" ? 0m : row.BasicHours!.Value;
                var overtime = row.Status == "Absent" ? 0m : row.OvertimeHours!.Value;
                if (record is not null && record.Status == row.Status && record.BasicHours == basic && record.OvertimeHours == overtime) continue;
                if (record is null) { record = new Attendance { WorkerId = row.WorkerId, WorkDate = day }; db.Attendance.Add(record); }
                record.Status = row.Status;
                record.BasicHours = basic;
                record.OvertimeHours = overtime;
                record.UpdatedUtc = time.GetUtcNow().UtcDateTime;
                record.UpdatedBy = httpContext.HttpContext?.User.Identity?.Name ?? "";
                changed.Add(row.WorkerId);
            }
            if (changed.Count > 0) audit.Write("AttendanceSaved", entityType: nameof(Attendance), entityId: date,
                details: new { date, numberOfRows = requests.Count, workersChanged = changed });
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            return new(200, await ReadAsync(day, ct));
        }
        catch (DbUpdateConcurrencyException) { return new(409); }
        catch (Exception ex) when (IsWriteConflict(ex) || PayrollPeriodLock.IsConflict(ex)) { return new(409); }
    }

    public async Task<AttendanceResult> DeleteAsync(string date, int workerId, CancellationToken ct)
    {
        // The same atomic validation and month guard cover both write routes.
        var result = await SaveAsync(date, [new AttendanceRequest { WorkerId = workerId, Status = null, BasicHours = 0, OvertimeHours = 0 }], ct);
        return result.StatusCode == 200 ? new(204) : result;
    }

    private async Task<AttendanceDayResponse> ReadAsync(DateOnly date, CancellationToken ct)
    {
        var settings = await db.PayrollSettings.AsNoTracking().SingleAsync(ct);
        var records = await db.Attendance.AsNoTracking().Where(a => a.WorkDate == date).ToDictionaryAsync(a => a.WorkerId, ct);
        var ids = records.Keys.ToArray();
        var workers = await db.Workers.AsNoTracking().Where(w => w.IsActive || ids.Contains(w.Id)).OrderBy(w => w.WorkerCode).ToListAsync(ct);
        var finalised = await periodLock.IsFinalisedAsync(db, date, ct);
        // R9: a finalised month's figures come only from the payroll snapshot (frozen per-worker rates).
        var frozen = finalised
            ? await db.PayrollDetails.AsNoTracking().Where(d => d.Period.Year == date.Year && d.Period.Month == date.Month)
                .ToDictionaryAsync(d => d.WorkerId, ct)
            : [];
        return new(date, finalised, workers.Select(w =>
        {
            records.TryGetValue(w.Id, out var a);
            var record = a is null ? null : new AttendanceRecordResponse(a.Status, a.BasicHours, a.OvertimeHours);
            if (!finalised)
                return new AttendanceRowResponse(new(w.Id, w.WorkerCode, w.FullName, w.Designation, w.HourlyRate, w.OvertimeRate, w.OvertimeRate ?? settings.OvertimeRatePerHour, w.IsActive),
                    record, PayrollCalculator.DailyPay(a?.Status, a?.BasicHours ?? 0, a?.OvertimeHours ?? 0, w.HourlyRate, settings.OvertimeRatePerHour, w.OvertimeRate));
            // No snapshot row: never invent pay from live rates; keep the record visible with zero pay.
            if (!frozen.TryGetValue(w.Id, out var snap))
                return new AttendanceRowResponse(new(w.Id, w.WorkerCode, w.FullName, w.Designation, w.HourlyRate, w.OvertimeRate, w.OvertimeRate ?? settings.OvertimeRatePerHour, w.IsActive),
                    record, PayrollCalculator.DailyPay(null, 0, 0, 0, 0));
            return new AttendanceRowResponse(new(w.Id, w.WorkerCode, w.FullName, w.Designation, snap.HourlyRate, snap.OvertimeRate, snap.OvertimeRate, w.IsActive),
                record, PayrollCalculator.DailyPay(a?.Status, a?.BasicHours ?? 0, a?.OvertimeHours ?? 0, snap.HourlyRate, snap.OvertimeRate));
        }).ToList());
    }

    private bool TryDate(string? text, out DateOnly date) =>
        DateOnly.TryParseExact(text, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out date)
        && date <= DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(time.GetUtcNow(), CompanyTimeZone).DateTime);
    private static readonly TimeZoneInfo CompanyTimeZone = TimeZoneInfo.FindSystemTimeZoneById("Asia/Dubai");

    // EF's SQL Server execution strategy wraps transient deadlocks in InvalidOperationException,
    // so inspect the chain for the actual SQL error instead of relying on the outer exception type.
    private static bool IsWriteConflict(Exception exception)
    {
        for (Exception? current = exception; current is not null; current = current.InnerException)
            if (current is SqlException { Number: 2601 or 2627 or 1205 }) return true;
        return false;
    }
    private static AttendanceResult Invalid(string field, string message) => new(400, Errors: new() { [field] = [message] });
}
