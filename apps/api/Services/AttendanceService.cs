using System.Data;
using System.Globalization;
using HrPayroll.Api.Auth;
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
            var onLeave = await ApprovedLeaveAsync(day, ids, ct);
            var manager = IsManager;
            var actor = httpContext.HttpContext?.User.Identity?.Name ?? "";
            var now = time.GetUtcNow().UtcDateTime;
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
                if (onLeave.TryGetValue(row.WorkerId, out var covering) && row.Status != LeaveAttendanceSync.AttendanceStatus(covering))
                    Error("status", $"This worker is on approved {covering}. Change the leave request instead.");
                if (row.Status is not (null or "Present" or "Absent") && !LeaveEntitlements.IsLeave(row.Status)) Error("status", "Choose Present, Absent, Annual Leave, Sick Leave, Emergency Leave or Not recorded.");
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
                if (!manager && !onLeave.ContainsKey(row.WorkerId) && existing.TryGetValue(row.WorkerId, out var approvedRecord) && approvedRecord.ApprovalStatus == ApprovalStatuses.Approved
                    && ChangesRecord(approvedRecord, row))
                    Error("status", "This entry is already approved. Ask a Manager to change it.");
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
                var basic = row.Status == "Present" ? row.BasicHours!.Value
                    : LeaveEntitlements.IsLeave(row.Status) ? await PaidLeaveHoursAsync(workers[row.WorkerId], row.Status!, day, record, settings.MaxBasicHoursPerDay, ct)
                    : 0m;
                var overtime = row.Status == "Present" ? row.OvertimeHours!.Value : 0m;
                var sameValues = record is not null && record.Status == row.Status && record.BasicHours == basic && record.OvertimeHours == overtime;
                // A supervisor re-saving a rejected entry unchanged is resubmitting it for approval.
                var resubmit = sameValues && !manager && record!.ApprovalStatus == ApprovalStatuses.Rejected;
                if (sameValues && !resubmit) continue;
                if (record is null) { record = new Attendance { WorkerId = row.WorkerId, WorkDate = day }; db.Attendance.Add(record); }
                record.Status = row.Status;
                record.BasicHours = basic;
                record.OvertimeHours = overtime;
                record.UpdatedUtc = now;
                record.UpdatedBy = actor;
                // Supervisors submit for approval; managers and administrators edit directly, which counts as approved.
                record.ApprovalStatus = manager ? ApprovalStatuses.Approved : ApprovalStatuses.Submitted;
                record.RejectionReason = null;
                record.DecidedBy = manager ? actor : null;
                record.DecidedUtc = manager ? now : null;
                changed.Add(row.WorkerId);
            }
            if (changed.Count > 0) audit.Write(manager ? "AttendanceSaved" : "AttendanceSubmitted", entityType: nameof(Attendance), entityId: date,
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

    /// <summary>Leave type of the approved leave request covering <paramref name="day"/>, per worker (all workers when none given).</summary>
    private async Task<Dictionary<int, string>> ApprovedLeaveAsync(DateOnly day, int[]? workerIds, CancellationToken ct)
    {
        var query = db.LeaveRequests.AsNoTracking().Where(l => l.Status == "Approved" && l.StartDate <= day && l.EndDate >= day);
        if (workerIds is not null) query = query.Where(l => workerIds.Contains(l.WorkerId));
        return (await query.Select(l => new { l.WorkerId, l.LeaveType }).ToListAsync(ct)).ToDictionary(l => l.WorkerId, l => l.LeaveType);
    }

    private async Task<AttendanceDayResponse> ReadAsync(DateOnly date, CancellationToken ct)
    {
        var day = await ReadRowsAsync(date, ct);
        var onLeave = await ApprovedLeaveAsync(date, null, ct);
        return onLeave.Count == 0 ? day : day with
        {
            Rows = day.Rows.Select(r => onLeave.TryGetValue(r.Worker.Id, out var type) ? r with { ApprovedLeave = type } : r).ToList(),
        };
    }

    private async Task<AttendanceDayResponse> ReadRowsAsync(DateOnly date, CancellationToken ct)
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
            var record = a is null ? null : new AttendanceRecordResponse(a.Status, a.BasicHours, a.OvertimeHours, a.ApprovalStatus, a.RejectionReason);
            if (!finalised)
                return new AttendanceRowResponse(new(w.Id, w.WorkerCode, w.FullName, w.Designation, w.HourlyRate, w.OvertimeRate, w.OvertimeRate ?? settings.OvertimeRatePerHour, w.IsActive),
                    record, PayrollCalculator.DailyPay(a?.Status, a?.BasicHours ?? 0, a?.OvertimeHours ?? 0, w.HourlyRate, settings.OvertimeRatePerHour, w.OvertimeRate));
            // No snapshot row: never invent pay from live rates; keep the record visible with zero pay.
            if (!frozen.TryGetValue(w.Id, out var snap))
                return new AttendanceRowResponse(new(w.Id, w.WorkerCode, w.FullName, w.Designation, w.HourlyRate, w.OvertimeRate, w.OvertimeRate ?? settings.OvertimeRatePerHour, w.IsActive),
                    record, PayrollCalculator.DailyPay(null, 0, 0, 0, 0));
            return new AttendanceRowResponse(new(w.Id, w.WorkerCode, w.FullName, w.Designation, snap.HourlyRate, snap.OvertimeRate, snap.OvertimeRate, w.IsActive),
                record, PayrollCalculator.DailyPay(a?.Status, a?.BasicHours ?? 0, a?.OvertimeHours ?? 0, snap.HourlyRate, snap.OvertimeRate));
        }).ToList(), records.Values.Count(r => r.ApprovalStatus == ApprovalStatuses.Submitted));
    }

    /// <summary>
    /// A leave day is paid at the standard shift while the worker still has allowance in their current year; otherwise it is
    /// kept as leave but unpaid (0 hours). Re-saving the same leave status keeps the hours the day was first given.
    /// </summary>
    private async Task<decimal> PaidLeaveHoursAsync(Worker worker, string type, DateOnly day, Attendance? record, decimal standardShift, CancellationToken ct)
    {
        if (record is not null && record.Status == type) return record.BasicHours;
        if (LeaveEntitlements.Period(type, worker.JoinDate, day) is not { } period) return 0m;
        var used = await db.Attendance.CountAsync(a => a.WorkerId == worker.Id && a.Status == type && a.BasicHours > 0
            && a.WorkDate >= period.Start && a.WorkDate <= period.End && a.WorkDate != day, ct);
        return used < LeaveEntitlements.Allowance(type) ? standardShift : 0m;
    }

    private bool IsManager => httpContext.HttpContext?.User is { } user
        && (user.IsInRole(Roles.Manager) || user.IsInRole(Roles.Administrator));

    private static bool ChangesRecord(Attendance record, AttendanceRequest row)
    {
        if (row.Status is null) return true;
        if (LeaveEntitlements.IsLeave(row.Status)) return record.Status != row.Status;
        var basic = row.Status != "Present" ? 0m : row.BasicHours ?? 0m;
        var overtime = row.Status != "Present" ? 0m : row.OvertimeHours ?? 0m;
        return record.Status != row.Status || record.BasicHours != basic || record.OvertimeHours != overtime;
    }

    /// <summary>Approves submitted entries for a date (all of them, or only the given workers). Manager/Administrator only.</summary>
    public async Task<AttendanceResult> ApproveAsync(string date, IReadOnlyCollection<int>? workerIds, CancellationToken ct)
    {
        if (!TryDate(date, out var day)) return Invalid("date", "Choose a valid date in YYYY-MM-DD format that is not in the future.");
        return await DecideAsync(day, workerIds, ApprovalStatuses.Approved, null, ct);
    }

    /// <summary>Sends submitted entries back to the supervisor with a reason. Manager/Administrator only.</summary>
    public async Task<AttendanceResult> RejectAsync(string date, IReadOnlyCollection<int>? workerIds, string? reason, CancellationToken ct)
    {
        if (!TryDate(date, out var day)) return Invalid("date", "Choose a valid date in YYYY-MM-DD format that is not in the future.");
        reason = reason?.Trim();
        var errors = new Dictionary<string, string[]>();
        if (workerIds is null || workerIds.Count == 0) errors["workerIds"] = ["Choose at least one entry to reject."];
        if (string.IsNullOrEmpty(reason) || reason.Length > 200) errors["reason"] = ["Enter a reason of 1 to 200 characters."];
        if (errors.Count > 0) return new(400, Errors: errors);
        return await DecideAsync(day, workerIds, ApprovalStatuses.Rejected, reason, ct);
    }

    private async Task<AttendanceResult> DecideAsync(DateOnly day, IReadOnlyCollection<int>? workerIds, string decision, string? reason, CancellationToken ct)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        try
        {
            if (await periodLock.IsFinalisedAsync(db, day, ct)) return new(409);
            var filter = workerIds is { Count: > 0 } ? workerIds.ToArray() : null;
            var submitted = await db.Attendance.Where(a => a.WorkDate == day && a.ApprovalStatus == ApprovalStatuses.Submitted
                && (filter == null || filter.Contains(a.WorkerId))).ToListAsync(ct);
            if (filter is not null && submitted.Count != filter.Distinct().Count())
                return Invalid("workerIds", "Some of the chosen entries are not waiting for approval. Reload and try again.");
            var actor = httpContext.HttpContext?.User.Identity?.Name ?? "";
            var now = time.GetUtcNow().UtcDateTime;
            foreach (var record in submitted)
            {
                record.ApprovalStatus = decision;
                record.RejectionReason = decision == ApprovalStatuses.Rejected ? reason : null;
                record.DecidedBy = actor;
                record.DecidedUtc = now;
            }
            var dateText = day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            if (submitted.Count > 0)
                audit.Write(decision == ApprovalStatuses.Approved ? "AttendanceApproved" : "AttendanceRejected",
                    entityType: nameof(Attendance), entityId: dateText,
                    details: new { date = dateText, workerIds = submitted.Select(r => r.WorkerId).ToArray(), reason });
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            return new(200, await ReadAsync(day, ct));
        }
        catch (DbUpdateConcurrencyException) { return new(409); }
        catch (Exception ex) when (IsWriteConflict(ex) || PayrollPeriodLock.IsConflict(ex)) { return new(409); }
    }

    /// <summary>Entries waiting for the manager, and entries sent back that the supervisor must correct, grouped by date.</summary>
    public async Task<AttendanceSummaryResponse> SummaryAsync(CancellationToken ct)
    {
        var counts = await db.Attendance.AsNoTracking()
            .Where(a => a.ApprovalStatus != ApprovalStatuses.Approved)
            .GroupBy(a => new { a.WorkDate, a.ApprovalStatus })
            .Select(g => new { g.Key.WorkDate, g.Key.ApprovalStatus, Count = g.Count() }).ToListAsync(ct);
        List<AttendanceDayCount> Days(string status) => counts.Where(c => c.ApprovalStatus == status)
            .OrderByDescending(c => c.WorkDate).Select(c => new AttendanceDayCount(c.WorkDate, c.Count)).ToList();
        var submitted = Days(ApprovalStatuses.Submitted);
        var rejected = Days(ApprovalStatuses.Rejected);
        return new(submitted.Sum(d => d.Count), submitted, rejected.Sum(d => d.Count), rejected);
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
