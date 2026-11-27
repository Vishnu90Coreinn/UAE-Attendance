using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services.Finance;

// The two statements an accountant signs: Profit & Loss for a period and the Balance Sheet at a date. Both come from the journals alone.
public sealed partial class FinanceLedgerService
{
    private sealed record Row(string Code, string Name, string Type, decimal Debit, decimal Credit);

    private async Task<List<Row>> RowsAsync(DateOnly? from, DateOnly? to, CancellationToken ct, bool withoutClosing = false)
    {
        var lines = db.JournalLines.AsNoTracking().AsQueryable();
        if (from is { } f) lines = lines.Where(l => l.Journal.Date >= f);
        if (to is { } t) lines = lines.Where(l => l.Journal.Date <= t);
        if (withoutClosing) lines = lines.Where(l => l.Journal.SourceType != JournalSources.YearEnd);   // a closed year's Profit & Loss still shows its income and expenses
        var grouped = await lines.GroupBy(l => new { l.LedgerAccount.Code, l.LedgerAccount.Name, l.LedgerAccount.Type })
            .Select(g => new { g.Key.Code, g.Key.Name, g.Key.Type, Debit = g.Sum(l => l.Debit), Credit = g.Sum(l => l.Credit) }).ToListAsync(ct);
        return grouped.Select(g => new Row(g.Code, g.Name, g.Type, g.Debit, g.Credit)).OrderBy(r => r.Code, StringComparer.Ordinal).ToList();
    }

    private static List<StatementLine> Section(IEnumerable<Row> rows, string type) =>
        rows.Where(r => r.Type == type).Select(r => new StatementLine(r.Code, r.Name, Balance(type, r.Debit, r.Credit))).Where(l => l.Amount != 0m).ToList();

    public async Task<FinResult<ProfitAndLoss>> ProfitAndLossAsync(string? from, string? to, CancellationToken ct)
    {
        var today = FinanceRules.Today(time);
        var end = FinanceRules.TryParseDate(to, out var e) ? e : today;
        var start = FinanceRules.TryParseDate(from, out var s) ? s : new DateOnly(end.Year, end.Month, 1);
        var errors = new Dictionary<string, string[]>();
        if (!string.IsNullOrWhiteSpace(from) && !FinanceRules.TryParseDate(from, out _)) errors["from"] = ["Use the date form yyyy-MM-dd."];
        if (!string.IsNullOrWhiteSpace(to) && !FinanceRules.TryParseDate(to, out _)) errors["to"] = ["Use the date form yyyy-MM-dd."];
        if (errors.Count == 0 && start > end) errors["to"] = ["The end date cannot be before the start date."];
        if (errors.Count > 0) return FinResult<ProfitAndLoss>.Invalid(errors);

        var rows = await RowsAsync(start, end, ct, withoutClosing: true);
        var revenue = Section(rows, LedgerTypes.Revenue);
        var expenses = Section(rows, LedgerTypes.Expense);
        var manual = await db.Journals.AsNoTracking().CountAsync(j => j.SourceType == JournalSources.Manual && j.Part == "Post" && j.Date >= start && j.Date <= end, ct);
        var totalRevenue = revenue.Sum(l => l.Amount);
        var totalExpenses = expenses.Sum(l => l.Amount);
        return FinResult<ProfitAndLoss>.Ok(new(FinanceRules.Format(start), FinanceRules.Format(end), revenue, totalRevenue, expenses, totalExpenses, totalRevenue - totalExpenses, manual));
    }

    public async Task<BalanceSheet> BalanceSheetAsync(string? asOf, CancellationToken ct)
    {
        var date = FinanceRules.TryParseDate(asOf, out var d) ? d : FinanceRules.Today(time);
        var rows = await RowsAsync(null, date, ct);
        var assets = Section(rows, LedgerTypes.Asset);
        var liabilities = Section(rows, LedgerTypes.Liability);
        var equity = Section(rows, LedgerTypes.Equity);
        var retained = Section(rows, LedgerTypes.Revenue).Sum(l => l.Amount) - Section(rows, LedgerTypes.Expense).Sum(l => l.Amount);
        var totalAssets = assets.Sum(l => l.Amount);
        var totalLiabilities = liabilities.Sum(l => l.Amount);
        var totalEquity = equity.Sum(l => l.Amount) + retained;
        return new(FinanceRules.Format(date), assets, totalAssets, liabilities, totalLiabilities, equity, retained, totalEquity, totalLiabilities + totalEquity, totalAssets == totalLiabilities + totalEquity);
    }
}
