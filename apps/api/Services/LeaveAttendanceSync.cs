using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services;

/// <summary>
/// Keeps Daily Attendance in step with approved leave: approving a request marks every day from start to end with the
/// leave type, and removing the approval (reject or delete) clears those days again. Unpaid leave has no attendance
/// status of its own and is recorded as Absent. Runs inside the caller's transaction and does not save.
/// </summary>
public sealed class LeaveAttendanceSync(AppDbContext db, IPayrollPeriodLock periodLock)
{
    public static string AttendanceStatus(string leaveType) => leaveType == "Unpaid Leave" ? "Absent" : leaveType;

    /// <summary>False, with nothing changed, when any day falls in a finalised payroll month.</summary>
    public async Task<bool> ApplyAsync(LeaveRequest leave, string actor, DateTime now, CancellationToken ct)
    {
        if (await TouchesFinalisedMonthAsync(leave, ct)) return false;
        var status = AttendanceStatus(leave.LeaveType);
        var shift = (await db.PayrollSettings.AsNoTracking().SingleAsync(ct)).MaxBasicHoursPerDay;
        var worker = await db.Workers.AsNoTracking().SingleAsync(w => w.Id == leave.WorkerId, ct);
        var records = await db.Attendance.Where(a => a.WorkerId == leave.WorkerId && a.WorkDate >= leave.StartDate && a.WorkDate <= leave.EndDate)
            .ToDictionaryAsync(a => a.WorkDate, ct);
        var givenPaid = new List<DateOnly>();
        for (var day = leave.StartDate; day <= leave.EndDate; day = day.AddDays(1))
        {
            records.TryGetValue(day, out var record);
            var hours = 0m;
            if (LeaveEntitlements.IsLeave(status))
            {
                if (record is not null && record.Status == status) hours = record.BasicHours;
                else if (LeaveEntitlements.Period(status, worker.JoinDate, day) is { } period)
                {
                    var used = await db.Attendance.CountAsync(a => a.WorkerId == worker.Id && a.Status == status && a.BasicHours > 0
                        && a.WorkDate >= period.Start && a.WorkDate <= period.End && a.WorkDate != day
                        && (a.WorkDate < leave.StartDate || a.WorkDate > leave.EndDate), ct)
                        + givenPaid.Count(d => d >= period.Start && d <= period.End);
                    if (used < LeaveEntitlements.Allowance(status)) hours = shift;
                }
                if (hours > 0) givenPaid.Add(day);
            }
            if (record is null)
            {
                record = new Attendance { WorkerId = leave.WorkerId, WorkDate = day };
                db.Attendance.Add(record);
            }
            record.Status = status;
            record.BasicHours = hours;
            record.OvertimeHours = 0;
            record.UpdatedUtc = now;
            record.UpdatedBy = actor;
            record.ApprovalStatus = ApprovalStatuses.Approved;
            record.RejectionReason = null;
            record.DecidedBy = actor;
            record.DecidedUtc = now;
        }
        return true;
    }

    /// <summary>False, with nothing changed, when any day falls in a finalised payroll month.</summary>
    public async Task<bool> ClearAsync(LeaveRequest leave, CancellationToken ct)
    {
        if (await TouchesFinalisedMonthAsync(leave, ct)) return false;
        var status = AttendanceStatus(leave.LeaveType);
        db.Attendance.RemoveRange(await db.Attendance.Where(a => a.WorkerId == leave.WorkerId && a.Status == status
            && a.WorkDate >= leave.StartDate && a.WorkDate <= leave.EndDate).ToListAsync(ct));
        return true;
    }

    private async Task<bool> TouchesFinalisedMonthAsync(LeaveRequest leave, CancellationToken ct)
    {
        for (var month = new DateOnly(leave.StartDate.Year, leave.StartDate.Month, 1); month <= leave.EndDate; month = month.AddMonths(1))
            if (await periodLock.IsFinalisedAsync(db, month, ct)) return true;
        return false;
    }
}
