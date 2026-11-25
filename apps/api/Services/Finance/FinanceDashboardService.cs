using System.Globalization;
using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services.Finance;

/// <summary>The finance overview: balances now, income and expense for the last 7, 30 or 365 days against the days before, spending by category and the latest entries.</summary>
public sealed class FinanceDashboardService(AppDbContext db, TimeProvider time, FinanceAccountService accounts)
{
    public static readonly int[] Windows = [7, 30, 365];
    private const int TopCategories = 6;

    private sealed record Row(DateOnly Date, string Kind, decimal Amount, int CategoryId, string Category);

    public async Task<FinDashboardResponse> GetAsync(int? requestedDays, CancellationToken ct)
    {
        var days = requestedDays is { } d && Windows.Contains(d) ? d : 30;
        var to = FinanceRules.Today(time);
        var from = to.AddDays(-(days - 1));
        var previousFrom = from.AddDays(-days);

        var rows = await db.FinEntries.AsNoTracking()
            .Where(e => e.Status == FinStatuses.Active && (e.Kind == FinEntryKinds.Income || e.Kind == FinEntryKinds.Expense) && e.EntryDate >= previousFrom && e.EntryDate <= to)
            .Select(e => new Row(e.EntryDate, e.Kind, e.Amount, e.CategoryId, e.Category.Name))
            .ToListAsync(ct);

        var current = rows.Where(r => r.Date >= from).ToList();
        var previous = rows.Where(r => r.Date < from).ToList();

        var accountList = await accounts.ListAsync(false, ct);
        var total = accountList.Sum(a => a.Balance);

        var spend = current.Where(r => r.Kind == FinEntryKinds.Expense)
            .GroupBy(r => (r.CategoryId, r.Category))
            .Select(g => (g.Key.CategoryId, Name: g.Key.Category, Amount: g.Sum(r => r.Amount)))
            .OrderByDescending(x => x.Amount).ThenBy(x => x.Name).ToList();
        var spendTotal = spend.Sum(x => x.Amount);
        var spending = spend.Take(TopCategories)
            .Select(x => new FinDashboardCategory(x.CategoryId, x.Name, x.Amount, Share(x.Amount, spendTotal))).ToList();
        if (spend.Count > TopCategories)
        {
            var rest = spend.Skip(TopCategories).Sum(x => x.Amount);
            spending.Add(new FinDashboardCategory(null, spend.Count - TopCategories == 1 ? "1 other category" : $"{spend.Count - TopCategories} other categories", rest, Share(rest, spendTotal)));
        }

        var latest = await db.FinEntries.AsNoTracking()
            .Where(e => e.Status == FinStatuses.Active && (e.Kind == FinEntryKinds.Income || e.Kind == FinEntryKinds.Expense))
            .OrderByDescending(e => e.EntryDate).ThenByDescending(e => e.Id).Take(8)
            .Select(e => new { e.Id, e.Kind, e.EntryNo, e.EntryDate, Category = e.Category.Name, e.Party, Account = e.Account.Name, e.Amount })
            .ToListAsync(ct);

        return new FinDashboardResponse(
            days, FinanceRules.Format(from), FinanceRules.Format(to), total, accountList, Totals(current), Totals(previous),
            days <= 30 ? "day" : "month", Buckets(current, from, to, days <= 30), spending,
            latest.Select(e => new FinDashboardEntry(e.Id, e.Kind, e.EntryNo, FinanceRules.Format(e.EntryDate), e.Category, e.Party, e.Account, e.Amount)).ToList());
    }

    private static int Share(decimal part, decimal whole) => whole > 0 ? (int)Math.Round(part / whole * 100, MidpointRounding.AwayFromZero) : 0;

    private static FinPeriodTotals Totals(IEnumerable<Row> rows)
    {
        var list = rows.Select(r => new FinMovement(r.Kind == FinEntryKinds.Income ? FinMovementType.Income : FinMovementType.Expense, r.Amount)).ToList();
        var (income, expense, net) = FinanceCalculator.Period(list);
        return new FinPeriodTotals(income, expense, net);
    }

    private static List<FinDashboardBucket> Buckets(List<Row> rows, DateOnly from, DateOnly to, bool daily)
    {
        var result = new List<FinDashboardBucket>();
        if (daily)
        {
            for (var day = from; day <= to; day = day.AddDays(1))
                result.Add(Bucket(rows.Where(r => r.Date == day), FinanceRules.Format(day), day.ToString("d MMM", CultureInfo.InvariantCulture)));
            return result;
        }

        for (var month = new DateOnly(from.Year, from.Month, 1); month <= to; month = month.AddMonths(1))
        {
            var m = month;
            result.Add(Bucket(rows.Where(r => r.Date.Year == m.Year && r.Date.Month == m.Month), FinanceRules.Format(m), m.ToString("MMM", CultureInfo.InvariantCulture)));
        }

        return result;
    }

    private static FinDashboardBucket Bucket(IEnumerable<Row> rows, string start, string label)
    {
        var t = Totals(rows);
        return new FinDashboardBucket(start, label, t.Income, t.Expense);
    }
}
