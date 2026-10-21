using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services;

public sealed record PayrollMutationResult(int StatusCode, PayrollResponse? Report = null, string? Message = null);

public sealed class PayrollService(AppDbContext db, IAuditLogger? audit = null, TimeProvider? time = null, IHttpContextAccessor? httpContext = null)
{
    private static readonly TimeZoneInfo CompanyTimeZone = TimeZoneInfo.FindSystemTimeZoneById("Asia/Dubai");

    public static bool TryMonth(string? value, out DateOnly start)
    {
        start = default;
        return value is { Length: 7 } && value[4] == '-' && value.Where((_, i) => i != 4).All(char.IsAsciiDigit)
            && DateOnly.TryParseExact(value + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out start);
    }

    public bool IsFutureMonth(DateOnly start)
    {
        var today = TimeZoneInfo.ConvertTime((time ?? TimeProvider.System).GetUtcNow(), CompanyTimeZone);
        return start.Year > today.Year || start.Year == today.Year && start.Month > today.Month;
    }

    public async Task<PayrollResponse> ReadAsync(DateOnly start, CancellationToken ct)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        await PayrollPeriodLock.AcquireAsync(db, start, false, ct);
        var period = await FrozenPeriodAsync(start, ct);
        var report = period is null ? await BuildDraftAsync(start, ct) : FrozenReport(period);
        await transaction.CommitAsync(ct);
        return report;
    }

    public async Task<PayrollMutationResult> FinaliseAsync(DateOnly start, string revision, CancellationToken ct)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        await PayrollPeriodLock.AcquireAsync(db, start, true, ct);
        if (await db.PayrollPeriods.AnyAsync(p => p.Year == start.Year && p.Month == start.Month, ct)) return new(409);
        var rate = await db.PayrollSettings.AsNoTracking().Select(p => p.OvertimeRatePerHour).SingleAsync(ct);
        var draft = await BuildDraftAsync(start, ct);
        var overdrawn = draft.Lines.FirstOrDefault(l => l.NetPay < 0);
        if (overdrawn is not null)
            return new(409, Message: $"Deductions for {overdrawn.WorkerName} are more than the amount earned. Reduce them before finalising the month.");
        if (draft.PendingApprovalCount > 0)
            return new(409, Message: $"{draft.PendingApprovalCount} attendance {(draft.PendingApprovalCount == 1 ? "entry is" : "entries are")} still waiting for approval. Approve or reject them before finalising the month.");
        if (!string.Equals(revision, draft.Revision, StringComparison.Ordinal)) return new(409);
        var period = new PayrollPeriod
        {
            Year = start.Year, Month = start.Month, OvertimeRateApplied = rate,
            FinalisedUtc = (time ?? TimeProvider.System).GetUtcNow().UtcDateTime,
            FinalisedBy = httpContext?.HttpContext?.User.Identity?.Name ?? "",
            CompanyName = draft.Company.CompanyName, Tagline = draft.Company.Tagline, ContactEmail = draft.Company.ContactEmail,
            PreparedByLabel = draft.Company.PreparedByLabel, ApprovedByLabel = draft.Company.ApprovedByLabel,
            Details = draft.Lines.Select(l => new PayrollDetail
            {
                WorkerId = l.WorkerId, WorkerCode = l.WorkerCode, WorkerName = l.WorkerName, Designation = l.Designation,
                HourlyRate = l.HourlyRate, OvertimeRate = l.OvertimeRate, DaysWorked = l.DaysWorked,
                BasicHours = l.BasicHours, OvertimeHours = l.OvertimeHours, BasicPay = l.BasicPay,
                OvertimePay = l.OvertimePay, TotalPay = l.TotalPay, TotalDeductions = l.TotalDeductions,
                Deductions = (l.Deductions ?? []).Select(d => new PayrollDeductionLine
                {
                    DeductionTypeName = d.Name, Amount = d.Amount, Note = d.Note
                }).ToList(),
            }).ToList()
        };
        db.PayrollPeriods.Add(period);
        var report = FrozenReport(period);
        Audit().Write("PayrollFinalised", entityType: nameof(PayrollPeriod), entityId: draft.Period,
            details: new { period = report.Period, totals = report.Totals, finalisedBy = report.FinalisedBy, finalisedUtc = report.FinalisedUtc, overtimeRateApplied = rate, company = report.Company, revision = report.Revision });
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return new(200, report);
    }

    public async Task<PayrollMutationResult> ReopenAsync(DateOnly start, string reason, CancellationToken ct)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        await PayrollPeriodLock.AcquireAsync(db, start, true, ct);
        var period = await FrozenPeriodAsync(start, ct);
        if (period is null) return new(409);
        var previous = FrozenReport(period);
        // Read the refreshed draft in the same transaction, following month -> settings -> workers -> attendance.
        var draft = await BuildDraftAsync(start, ct);
        db.PayrollPeriods.Remove(period);
        Audit().Write("PayrollReopened", entityType: nameof(PayrollPeriod), entityId: previous.Period,
            details: new { reason = reason.Trim(), previous = new { period = previous.Period, totals = previous.Totals,
                finalisedBy = previous.FinalisedBy, finalisedUtc = previous.FinalisedUtc, overtimeRateApplied = period.OvertimeRateApplied,
                company = previous.Company, revision = previous.Revision } });
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return new(200, draft);
    }

    private IAuditLogger Audit() => audit ?? new AuditLogger(db, httpContext ?? new HttpContextAccessor());

    private Task<PayrollPeriod?> FrozenPeriodAsync(DateOnly start, CancellationToken ct) =>
        db.PayrollPeriods.Include(p => p.Details).ThenInclude(d => d.Deductions).SingleOrDefaultAsync(p => p.Year == start.Year && p.Month == start.Month, ct);

    private static PayrollResponse FrozenReport(PayrollPeriod period)
    {
        var lines = period.Details.OrderBy(l => l.WorkerCode, StringComparer.Ordinal).Select(l => new PayrollLine(l.WorkerId,
            l.WorkerCode, l.WorkerName, l.Designation, Money(l.HourlyRate), Money(l.OvertimeRate), l.DaysWorked, Money(l.BasicHours),
            Money(l.OvertimeHours), Money(l.BasicPay), Money(l.OvertimePay), Money(l.TotalPay),
            Money(l.TotalDeductions), Money(l.TotalPay - l.TotalDeductions),
            l.Deductions.OrderBy(d => d.DeductionTypeName, StringComparer.Ordinal)
                .Select(d => new PayrollDeductionItem(d.DeductionTypeName, d.Amount, d.Note)).ToArray())).ToArray();
        return WithRevision(new(new DateOnly(period.Year, period.Month, 1).ToString("yyyy-MM", CultureInfo.InvariantCulture), "Finalised",
            new(period.CompanyName, period.Tagline, period.ContactEmail, period.PreparedByLabel, period.ApprovedByLabel),
            lines, PayrollCalculator.GrandTotals(lines), "", period.FinalisedBy, DateTime.SpecifyKind(period.FinalisedUtc, DateTimeKind.Utc)));
    }

    private async Task<PayrollResponse> BuildDraftAsync(DateOnly start, CancellationToken ct)
    {
        var end = new DateOnly(start.Year, start.Month, DateTime.DaysInMonth(start.Year, start.Month));
        var settings = await db.PayrollSettings.AsNoTracking().SingleAsync(ct);
        var allWorkers = await db.Workers.AsNoTracking().OrderBy(w => w.WorkerCode).ToListAsync(ct);
        var inMonth = db.Attendance.AsNoTracking().Where(a => a.WorkDate >= start && a.WorkDate <= end);
        // Only manager-approved entries are payable; submitted entries are counted so the manager can see what is waiting.
        var attendance = await inMonth.Where(a => a.ApprovalStatus == ApprovalStatuses.Approved).ToListAsync(ct);
        var pending = await inMonth.CountAsync(a => a.ApprovalStatus == ApprovalStatuses.Submitted, ct);
        var ids = attendance.Select(a => a.WorkerId).Distinct().ToArray();
        var workers = allWorkers.Where(w => w.IsActive || ids.Contains(w.Id));
        var byWorker = attendance.ToLookup(a => a.WorkerId);
        var deductions = (await db.WorkerDeductions.AsNoTracking().Include(d => d.DeductionType)
            .Where(d => d.Year == start.Year && d.Month == start.Month).ToListAsync(ct)).ToLookup(d => d.WorkerId);
        var lines = workers.Select(w =>
        {
            var records = byWorker[w.Id].ToArray();
            var summary = PayrollCalculator.MonthSummary(records.Select(a => PayrollCalculator.DailyPay(a.Status, a.BasicHours,
                a.OvertimeHours, w.HourlyRate, settings.OvertimeRatePerHour, w.OvertimeRate)),
                records.Where(a => a.Status == "Present").Select(a => (a.BasicHours, a.OvertimeHours)));
            var items = deductions[w.Id].OrderBy(d => d.DeductionType.Name, StringComparer.Ordinal)
                .Select(d => new PayrollDeductionItem(d.DeductionType.Name, Money(d.Amount), d.Note)).ToArray();
            var totalDeductions = Money(items.Sum(i => i.Amount));
            return new PayrollLine(w.Id, w.WorkerCode, w.FullName, w.Designation, w.HourlyRate,
                w.OvertimeRate ?? settings.OvertimeRatePerHour, summary.DaysWorked, summary.BasicHours,
                summary.OvertimeHours, summary.BasicPay, summary.OvertimePay, summary.TotalPay,
                totalDeductions, Money(summary.TotalPay - totalDeductions), items);
        }).ToArray();
        return WithRevision(new(start.ToString("yyyy-MM", CultureInfo.InvariantCulture), "Draft",
            new(settings.CompanyName, settings.Tagline, settings.ContactEmail, settings.PreparedByLabel, settings.ApprovedByLabel),
            lines, PayrollCalculator.GrandTotals(lines), "", PendingApprovalCount: pending));
    }

    // SQL decimal materialization fixes scale to 2; use that same representation before and after persistence.
    private static decimal Money(decimal value) => decimal.Parse(value.ToString("F2", CultureInfo.InvariantCulture), CultureInfo.InvariantCulture);

    private static PayrollResponse WithRevision(PayrollResponse report) => report with
    { Revision = Convert.ToHexStringLower(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(report))) };
}
