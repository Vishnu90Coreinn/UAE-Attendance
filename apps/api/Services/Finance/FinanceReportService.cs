using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services.Finance;

/// <summary>
/// The period statement: for each account its balance at the start, income, expense and transfers in the period, and its balance at the end,
/// plus income and expenses by category. Balance arithmetic is <see cref="FinanceCalculator"/>; voided rows are left out everywhere.
/// </summary>
public sealed class FinanceReportService(AppDbContext db, TimeProvider time)
{
    private const int MaxDays = 1830;

    public async Task<FinResult<FinReport>> BuildAsync(string? from, string? to, CancellationToken ct)
    {
        var parsed = Parse(from, to, out var start, out var end);
        if (parsed is not null) return parsed;

        var accounts = await db.FinAccounts.AsNoTracking().Where(a => a.OpeningDate <= end).OrderBy(a => a.SortOrder).ThenBy(a => a.Name).ToListAsync(ct);

        var activeEntries = db.FinEntries.AsNoTracking().Where(e => e.Status == FinStatuses.Active);
        var activeTransfers = db.FinTransfers.AsNoTracking().Where(t => t.Status == FinStatuses.Active);

        Task<List<(int AccountId, string Kind, decimal Sum)>> EntrySums(IQueryable<FinEntry> q) =>
            q.GroupBy(e => new { e.AccountId, e.Kind }).Select(g => new { g.Key.AccountId, g.Key.Kind, Sum = g.Sum(e => e.Amount) })
                .ToListAsync(ct).ContinueWith(t => t.Result.Select(x => (x.AccountId, x.Kind, x.Sum)).ToList(), ct);
        Task<List<(int AccountId, decimal Sum)>> TransferSums(IQueryable<FinTransfer> q, bool incoming) =>
            (incoming ? q.GroupBy(t => t.ToAccountId) : q.GroupBy(t => t.FromAccountId)).Select(g => new { AccountId = g.Key, Sum = g.Sum(t => t.Amount) })
                .ToListAsync(ct).ContinueWith(t => t.Result.Select(x => (x.AccountId, x.Sum)).ToList(), ct);

        var entriesBefore = await EntrySums(activeEntries.Where(e => e.EntryDate < start));
        var entriesIn = await EntrySums(activeEntries.Where(e => e.EntryDate >= start && e.EntryDate <= end));
        var inBefore = await TransferSums(activeTransfers.Where(t => t.TransferDate < start), true);
        var outBefore = await TransferSums(activeTransfers.Where(t => t.TransferDate < start), false);
        var inDuring = await TransferSums(activeTransfers.Where(t => t.TransferDate >= start && t.TransferDate <= end), true);
        var outDuring = await TransferSums(activeTransfers.Where(t => t.TransferDate >= start && t.TransferDate <= end), false);

        static decimal Of(List<(int AccountId, string Kind, decimal Sum)> rows, int id, string kind) => rows.Where(r => r.AccountId == id && r.Kind == kind).Sum(r => r.Sum);
        static decimal Of2(List<(int AccountId, decimal Sum)> rows, int id) => rows.Where(r => r.AccountId == id).Sum(r => r.Sum);

        var lines = new List<FinReportAccount>();
        foreach (var a in accounts)
        {
            var opening = FinanceCalculator.Balance(a.OpeningBalance, Of(entriesBefore, a.Id, FinEntryKinds.Income), Of(entriesBefore, a.Id, FinEntryKinds.Expense), Of2(inBefore, a.Id), Of2(outBefore, a.Id));
            var income = Of(entriesIn, a.Id, FinEntryKinds.Income);
            var expense = Of(entriesIn, a.Id, FinEntryKinds.Expense);
            var tin = Of2(inDuring, a.Id);
            var tout = Of2(outDuring, a.Id);
            var closing = FinanceCalculator.Balance(opening, income, expense, tin, tout);
            // A switched-off account with nothing in it and nothing in the period is only noise.
            if (!a.IsActive && opening == 0m && closing == 0m && income == 0m && expense == 0m && tin == 0m && tout == 0m) continue;
            lines.Add(new FinReportAccount(a.Id, a.Name, a.Kind, a.IsActive, opening, income, expense, tin, tout, closing));
        }

        var totals = new FinReportTotals(lines.Sum(l => l.Opening), lines.Sum(l => l.Income), lines.Sum(l => l.Expense), lines.Sum(l => l.TransfersIn), lines.Sum(l => l.TransfersOut), lines.Sum(l => l.Closing));
        var period = FinanceCalculator.Period([new FinMovement(FinMovementType.Income, totals.Income), new FinMovement(FinMovementType.Expense, totals.Expense)]);

        var categoryRows = await activeEntries.Where(e => e.EntryDate >= start && e.EntryDate <= end)
            .GroupBy(e => new { e.Kind, e.CategoryId, e.Category.Name })
            .Select(g => new { g.Key.Kind, g.Key.CategoryId, g.Key.Name, Sum = g.Sum(e => e.Amount), Count = g.Count() }).ToListAsync(ct);

        List<FinReportCategory> Categories(string kind)
        {
            var rows = categoryRows.Where(r => r.Kind == kind).OrderByDescending(r => r.Sum).ThenBy(r => r.Name).ToList();
            var whole = rows.Sum(r => r.Sum);
            return rows.Select(r => new FinReportCategory(r.CategoryId, r.Name, r.Sum, r.Count, whole > 0 ? (int)Math.Round(r.Sum / whole * 100, MidpointRounding.AwayFromZero) : 0)).ToList();
        }

        return FinResult<FinReport>.Ok(new FinReport(
            FinanceRules.Format(start), FinanceRules.Format(end), lines, totals, new FinPeriodTotals(period.Income, period.Expense, period.Net),
            Categories(FinEntryKinds.Income), Categories(FinEntryKinds.Expense), categoryRows.Sum(r => r.Count)));
    }

    /// <summary>Every active entry of the period, oldest first: the detail behind the statement.</summary>
    public async Task<List<FinReportEntry>> EntriesAsync(string from, string to, CancellationToken ct)
    {
        FinanceRules.TryParseDate(from, out var start);
        FinanceRules.TryParseDate(to, out var end);
        var rows = await db.FinEntries.AsNoTracking().Where(e => e.Status == FinStatuses.Active && e.EntryDate >= start && e.EntryDate <= end)
            .OrderBy(e => e.EntryDate).ThenBy(e => e.Id)
            .Select(e => new { e.EntryDate, e.EntryNo, e.Kind, Category = e.Category.Name, e.Party, Account = e.Account.Name, e.Reference, e.Amount }).ToListAsync(ct);
        return rows.Select(r => new FinReportEntry(FinanceRules.Format(r.EntryDate), r.EntryNo, r.Kind, r.Category, r.Party, r.Account, r.Reference, r.Amount)).ToList();
    }

    private FinResult<FinReport>? Parse(string? from, string? to, out DateOnly start, out DateOnly end)
    {
        var today = FinanceRules.Today(time);
        start = new DateOnly(today.Year, today.Month, 1);
        end = today;
        var errors = new Dictionary<string, string[]>();
        if (!string.IsNullOrWhiteSpace(from) && !FinanceRules.TryParseDate(from, out start)) errors["from"] = ["Use the date form yyyy-MM-dd."];
        if (!string.IsNullOrWhiteSpace(to) && !FinanceRules.TryParseDate(to, out end)) errors["to"] = ["Use the date form yyyy-MM-dd."];
        if (errors.Count == 0)
        {
            if (end > today) errors["to"] = ["The report cannot end in the future."];
            else if (start > end) errors["to"] = ["The end date cannot be before the start date."];
            else if (end.DayNumber - start.DayNumber >= MaxDays) errors["from"] = ["A report covers at most 5 years."];
        }

        return errors.Count > 0 ? FinResult<FinReport>.Invalid(errors) : null;
    }
}
