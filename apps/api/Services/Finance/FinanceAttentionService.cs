using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services.Finance;

/// <summary>The few things an owner or accountant needs to act on today: what is overdue or due this week, what waits for approval, and the next VAT date.</summary>
public sealed class FinanceAttentionService(AppDbContext db, TimeProvider time)
{
    private const int SoonDays = 7;

    public async Task<FinAttention> BuildAsync(CancellationToken ct)
    {
        var today = FinanceRules.Today(time);
        var soon = today.AddDays(SoonDays);

        var bills = (await db.FinBills.AsNoTracking().Where(b => b.Status == FinBillStatuses.Open)
            .Select(b => new { b.DueDate, b.Total, Paid = db.FinEntries.Where(e => e.BillId == b.Id && e.Status == FinStatuses.Active).Sum(e => (decimal?)e.Amount) ?? 0m }).ToListAsync(ct))
            .Select(b => new { b.DueDate, Owed = b.Total - b.Paid }).Where(b => b.Owed > 0m).ToList();

        var cheques = await db.FinCheques.AsNoTracking().Where(c => c.Status == FinChequeStatuses.Issued || c.Status == FinChequeStatuses.Delivered || c.Status == FinChequeStatuses.Received || c.Status == FinChequeStatuses.Deposited)
            .Select(c => new { c.DueDate, c.Amount, c.Direction }).ToListAsync(ct);

        var invoices = (await db.Invoices.AsNoTracking().Where(i => i.Status == InvoiceStatuses.Issued)
            .Select(i => new { i.DueDate, i.Total, Paid = i.Payments.Sum(p => (decimal?)p.Amount) ?? 0m }).ToListAsync(ct))
            .Select(i => new { i.DueDate, Owed = i.Total - i.Paid }).Where(i => i.Owed > 0m).ToList();

        FinAttentionItem Item<T>(IEnumerable<T> rows, Func<T, decimal> amount) { var list = rows.ToList(); return new(list.Count, list.Sum(amount)); }

        var pending = await db.FinEntries.CountAsync(e => e.Status == FinStatuses.Pending, ct);

        // The month that just ended should be locked once the accountant has what they need; flag it from the 6th of the new month.
        var previous = new DateOnly(today.Year, today.Month, 1).AddMonths(-1);
        var hasActivity = await db.FinEntries.AnyAsync(e => e.Status == FinStatuses.Active && e.EntryDate.Year == previous.Year && e.EntryDate.Month == previous.Month, ct);
        var locked = await db.FinMonthLocks.AnyAsync(l => l.Year == previous.Year && l.Month == previous.Month && l.IsLocked, ct);
        string? openMonth = hasActivity && !locked && today.Day >= 6 ? previous.ToString("MMMM yyyy", System.Globalization.CultureInfo.InvariantCulture) : null;

        var taxSettings = await db.PayrollSettings.AsNoTracking().SingleAsync(ct);
        var currentPeriod = FinanceVatPeriods.For(today, taxSettings.VatPeriodMonths, taxSettings.VatPeriodStartMonth);
        var lastQuarterEnd = currentPeriod.From.AddDays(-1);
        var due = lastQuarterEnd.AddDays(28);
        if (due < today) { lastQuarterEnd = currentPeriod.To; due = currentPeriod.To.AddDays(28); }
        var qStart = new DateOnly(lastQuarterEnd.Year, lastQuarterEnd.Month, 1).AddMonths(1 - taxSettings.VatPeriodMonths);

        return new(
            Item(bills.Where(b => b.DueDate < today), b => b.Owed), Item(bills.Where(b => b.DueDate >= today && b.DueDate <= soon), b => b.Owed),
            Item(cheques.Where(c => c.DueDate < today), c => c.Amount), Item(cheques.Where(c => c.DueDate >= today && c.DueDate <= soon), c => c.Amount),
            Item(invoices.Where(i => i.DueDate < today), i => i.Owed), pending, openMonth,
            $"{qStart:d MMM yyyy} to {lastQuarterEnd:d MMM yyyy}", FinanceRules.Format(due), due.DayNumber - today.DayNumber, taxSettings.VatPeriodConfirmed);
    }
}
