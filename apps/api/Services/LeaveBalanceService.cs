using System.Globalization;
using HrPayroll.Api.Data;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services;

/// <summary>Paid-leave balances per active worker, counted from the paid leave days recorded in attendance.</summary>
public sealed class LeaveBalanceService(AppDbContext db, TimeProvider time)
{
    private static readonly TimeZoneInfo CompanyTimeZone = TimeZoneInfo.FindSystemTimeZoneById("Asia/Dubai");

    public async Task<List<WorkerLeaveBalance>> ListAsync(CancellationToken ct)
    {
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(time.GetUtcNow(), CompanyTimeZone).DateTime);
        var workers = await db.Workers.AsNoTracking().Where(w => w.IsActive).OrderBy(w => w.WorkerCode).ToListAsync(ct);
        var ids = workers.Select(w => w.Id).ToArray();
        var paidDays = (await db.Attendance.AsNoTracking()
            .Where(a => ids.Contains(a.WorkerId) && a.BasicHours > 0 && LeaveEntitlements.Types.Contains(a.Status))
            .Select(a => new { a.WorkerId, a.Status, a.WorkDate }).ToListAsync(ct))
            .ToLookup(a => (a.WorkerId, a.Status), a => a.WorkDate);
        return workers.Select(w => new WorkerLeaveBalance(w.Id, w.WorkerCode, w.FullName, Text(w.JoinDate),
            LeaveEntitlements.Types.Select(type =>
            {
                var allowance = LeaveEntitlements.Allowance(type);
                var eligibleFrom = LeaveEntitlements.EligibleFrom(type, w.JoinDate);
                if (LeaveEntitlements.Period(type, w.JoinDate, today) is not { } period)
                    return new LeaveTypeBalance(type, allowance, 0, 0, false, Text(eligibleFrom), null, null);
                var used = paidDays[(w.Id, type)].Count(d => d >= period.Start && d <= period.End);
                return new LeaveTypeBalance(type, allowance, used, Math.Max(0, allowance - used), true,
                    Text(eligibleFrom), Text(period.Start), Text(period.End));
            }).ToList())).ToList();
    }

    private static string? Text(DateOnly? date) => date?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
}
