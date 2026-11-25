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
            var opening = FinanceCalculator.Balance(a.OpeningBalance, Of(entriesBefore, a.Id, FinEntryKinds.Income), Of(entriesBefore, a.Id, FinEntryKinds.Expense), Of2(inBefore, a.Id), Of2(outBefore, a.Id),
                Of(entriesBefore, a.Id, FinEntryKinds.Capital) - Of(entriesBefore, a.Id, FinEntryKinds.CapitalOut));
            var income = Of(entriesIn, a.Id, FinEntryKinds.Income);
            var capital = Of(entriesIn, a.Id, FinEntryKinds.Capital) - Of(entriesIn, a.Id, FinEntryKinds.CapitalOut);
            var expense = Of(entriesIn, a.Id, FinEntryKinds.Expense);
            var tin = Of2(inDuring, a.Id);
            var tout = Of2(outDuring, a.Id);
            var closing = FinanceCalculator.Balance(opening, income, expense, tin, tout, capital);
            // A switched-off account with nothing in it and nothing in the period is only noise.
            if (!a.IsActive && opening == 0m && closing == 0m && income == 0m && expense == 0m && tin == 0m && tout == 0m && capital == 0m) continue;
            lines.Add(new FinReportAccount(a.Id, a.Name, a.Kind, a.IsActive, opening, income, expense, tin, tout, closing, capital));
        }

        var totals = new FinReportTotals(lines.Sum(l => l.Opening), lines.Sum(l => l.Income), lines.Sum(l => l.Expense), lines.Sum(l => l.TransfersIn), lines.Sum(l => l.TransfersOut), lines.Sum(l => l.Closing), lines.Sum(l => l.Capital));
        var period = FinanceCalculator.Period([new FinMovement(FinMovementType.Income, totals.Income), new FinMovement(FinMovementType.Expense, totals.Expense)]);

        var partnerRows = await PartnersAsync(start, end, ct);
        var monthRows = await MonthsAsync(start, end, ct);

        var categoryRows = await activeEntries.Where(e => e.EntryDate >= start && e.EntryDate <= end && (e.Kind == FinEntryKinds.Income || e.Kind == FinEntryKinds.Expense))
            .GroupBy(e => new { e.Kind, e.CategoryId, e.Category.Name })
            .Select(g => new { g.Key.Kind, g.Key.CategoryId, g.Key.Name, Sum = g.Sum(e => e.Amount), Count = g.Count() }).ToListAsync(ct);

        List<FinReportCategory> Categories(string kind)
        {
            var rows = categoryRows.Where(r => r.Kind == kind).OrderByDescending(r => r.Sum).ThenBy(r => r.Name).ToList();
            var shares = FinanceCalculator.Shares(rows.Select(r => r.Sum).ToList(), 1);
            return rows.Select((r, i) => new FinReportCategory(r.CategoryId, r.Name, r.Sum, r.Count, shares[i])).ToList();
        }

        return FinResult<FinReport>.Ok(new FinReport(
            FinanceRules.Format(start), FinanceRules.Format(end), lines, totals, new FinPeriodTotals(period.Income, period.Expense, period.Net),
            Categories(FinEntryKinds.Income), Categories(FinEntryKinds.Expense), categoryRows.Sum(r => r.Count), partnerRows, monthRows));
    }

    /// <summary>Every calendar month the period touches, with its own totals. The first and last month hold only the days inside the period.</summary>
    private async Task<List<FinReportMonth>> MonthsAsync(DateOnly start, DateOnly end, CancellationToken ct)
    {
        var rows = await db.FinEntries.AsNoTracking().Where(e => e.Status == FinStatuses.Active && e.EntryDate >= start && e.EntryDate <= end)
            .GroupBy(e => new { e.EntryDate.Year, e.EntryDate.Month, e.Kind })
            .Select(g => new { g.Key.Year, g.Key.Month, g.Key.Kind, Sum = g.Sum(e => e.Amount), Count = g.Count() }).ToListAsync(ct);
        var locks = await db.FinMonthLocks.AsNoTracking().Where(l => l.IsLocked).ToListAsync(ct);

        var result = new List<FinReportMonth>();
        for (var month = new DateOnly(start.Year, start.Month, 1); month <= end; month = month.AddMonths(1))
        {
            var m = month;
            decimal Sum(string kind) => rows.Where(r => r.Year == m.Year && r.Month == m.Month && r.Kind == kind).Sum(r => r.Sum);
            var entries = rows.Where(r => r.Year == m.Year && r.Month == m.Month && (r.Kind == FinEntryKinds.Income || r.Kind == FinEntryKinds.Expense)).Sum(r => r.Count);
            var period = FinanceCalculator.Period([new FinMovement(FinMovementType.Income, Sum(FinEntryKinds.Income)), new FinMovement(FinMovementType.Expense, Sum(FinEntryKinds.Expense))]);
            var l = locks.SingleOrDefault(x => x.Year == m.Year && x.Month == m.Month);
            result.Add(new FinReportMonth(m.ToString("yyyy-MM", System.Globalization.CultureInfo.InvariantCulture), entries, period.Income, period.Expense, period.Net,
                Sum(FinEntryKinds.Capital) - Sum(FinEntryKinds.CapitalOut), l is not null, l?.LockedBy, l?.LockedUtc));
        }

        return result;
    }

    private async Task<List<FinReportPartner>> PartnersAsync(DateOnly start, DateOnly end, CancellationToken ct)
    {
        var partners = await db.FinPartners.AsNoTracking().OrderBy(p => p.SortOrder).ThenBy(p => p.Name).ToListAsync(ct);
        var rows = await db.FinEntries.AsNoTracking()
            .Where(e => e.Status == FinStatuses.Active && e.PartnerId != null && e.EntryDate <= end)
            .Select(e => new { PartnerId = e.PartnerId!.Value, e.Kind, e.Amount, Before = e.EntryDate < start }).ToListAsync(ct);

        decimal Sum(int id, string kind, bool before) => rows.Where(r => r.PartnerId == id && r.Kind == kind && r.Before == before).Sum(r => r.Amount);
        var lines = partners.Select(p =>
        {
            var opening = p.OpeningCapital + Sum(p.Id, FinEntryKinds.Capital, true) - Sum(p.Id, FinEntryKinds.CapitalOut, true);
            var added = Sum(p.Id, FinEntryKinds.Capital, false);
            var returned = Sum(p.Id, FinEntryKinds.CapitalOut, false);
            return (p, opening, added, returned, closing: opening + added - returned);
        }).ToList();
        var shares = FinanceCalculator.Shares(lines.Select(l => l.closing).ToList());
        // A partner with no capital and no movement in the period is only noise.
        return lines.Select((l, i) => new FinReportPartner(l.p.Id, l.p.Name, l.opening, l.added, l.returned, l.closing, shares[i]))
            .Where(l => l.Opening != 0m || l.Added != 0m || l.Returned != 0m || l.Closing != 0m).ToList();
    }

    /// <summary>Every active entry of the period, oldest first: the detail behind the statement.</summary>
    public async Task<List<FinReportEntry>> EntriesAsync(string from, string to, CancellationToken ct)
    {
        FinanceRules.TryParseDate(from, out var start);
        FinanceRules.TryParseDate(to, out var end);
        var rows = await db.FinEntries.AsNoTracking().Where(e => e.Status == FinStatuses.Active && (e.Kind == FinEntryKinds.Income || e.Kind == FinEntryKinds.Expense) && e.EntryDate >= start && e.EntryDate <= end)
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
