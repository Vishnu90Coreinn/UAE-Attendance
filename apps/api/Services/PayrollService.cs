using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using HrPayroll.Api.Data;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services;

public sealed class PayrollService(AppDbContext db)
{
    public static bool TryMonth(string? value, out DateOnly start)
    {
        start = default;
        return value is { Length: 7 } && value[4] == '-' && value.Where((_, i) => i != 4).All(char.IsAsciiDigit)
            && DateOnly.TryParseExact(value + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out start);
    }

    public async Task<PayrollResponse> ReadAsync(DateOnly start, CancellationToken ct)
    {
        // Serializable keeps settings, current worker rates and attendance in one coherent read.
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var end = new DateOnly(start.Year, start.Month, DateTime.DaysInMonth(start.Year, start.Month));
        var settings = await db.PayrollSettings.AsNoTracking().SingleAsync(ct);
        // Match attendance writes: settings -> workers -> attendance, to avoid opposite lock ordering.
        var allWorkers = await db.Workers.AsNoTracking().OrderBy(w => w.WorkerCode).ToListAsync(ct);
        var attendance = await db.Attendance.AsNoTracking().Where(a => a.WorkDate >= start && a.WorkDate <= end).ToListAsync(ct);
        var ids = attendance.Select(a => a.WorkerId).Distinct().ToArray();
        var workers = allWorkers.Where(w => w.IsActive || ids.Contains(w.Id));
        var byWorker = attendance.ToLookup(a => a.WorkerId);
        var lines = workers.Select(w =>
        {
            var records = byWorker[w.Id].ToArray();
            var summary = PayrollCalculator.MonthSummary(records.Select(a => PayrollCalculator.DailyPay(a.Status, a.BasicHours,
                a.OvertimeHours, w.HourlyRate, settings.OvertimeRatePerHour, w.OvertimeRate)),
                records.Where(a => a.Status == "Present").Select(a => (a.BasicHours, a.OvertimeHours)));
            return new PayrollLine(w.Id, w.WorkerCode, w.FullName, w.Designation, w.HourlyRate,
                w.OvertimeRate ?? settings.OvertimeRatePerHour, summary.DaysWorked, summary.BasicHours,
                summary.OvertimeHours, summary.BasicPay, summary.OvertimePay, summary.TotalPay);
        }).ToArray();
        var report = new PayrollResponse(start.ToString("yyyy-MM", CultureInfo.InvariantCulture), "Draft",
            new(settings.CompanyName, settings.Tagline, settings.ContactEmail, settings.PreparedByLabel, settings.ApprovedByLabel),
            lines, PayrollCalculator.GrandTotals(lines), "");
        await transaction.CommitAsync(ct);
        return report with { Revision = Convert.ToHexStringLower(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(report))) };
    }
}
