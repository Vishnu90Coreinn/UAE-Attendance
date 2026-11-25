using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services.Finance;

// Year-end close. The financial year runs 1 January to 31 December. Closing posts one journal dated 31 December that zeroes every income and
// expense account and puts the result in "Retained earnings", so the next year starts clean. Reopening reverses that journal.
public sealed partial class FinanceLedgerService
{
    private async Task<List<Journal>> ActiveClosesAsync(CancellationToken ct)
    {
        var closes = await db.Journals.AsNoTracking().Include(j => j.Lines).Where(j => j.SourceType == JournalSources.YearEnd && j.Part == "Post").ToListAsync(ct);
        var reversed = (await db.Journals.AsNoTracking().Where(j => j.SourceType == JournalSources.YearEnd && j.ReversesJournalId != null).Select(j => j.ReversesJournalId!.Value).ToListAsync(ct)).ToHashSet();
        return closes.Where(j => !reversed.Contains(j.Id)).ToList();
    }

    private async Task<(decimal Revenue, decimal Expenses, List<(int Account, decimal Balance, string Type)> Rows)> YearResultAsync(int year, CancellationToken ct)
    {
        var from = new DateOnly(year, 1, 1);
        var to = new DateOnly(year, 12, 31);
        var rows = await db.JournalLines.AsNoTracking()
            .Where(l => l.Journal.Date >= from && l.Journal.Date <= to && l.Journal.SourceType != JournalSources.YearEnd && (l.LedgerAccount.Type == LedgerTypes.Revenue || l.LedgerAccount.Type == LedgerTypes.Expense))
            .GroupBy(l => new { l.LedgerAccountId, l.LedgerAccount.Type })
            .Select(g => new { g.Key.LedgerAccountId, g.Key.Type, Debit = g.Sum(l => l.Debit), Credit = g.Sum(l => l.Credit) }).ToListAsync(ct);
        var list = rows.Select(r => (r.LedgerAccountId, Balance(r.Type, r.Debit, r.Credit), r.Type)).Where(r => r.Item2 != 0m).ToList();
        return (list.Where(r => r.Type == LedgerTypes.Revenue).Sum(r => r.Item2), list.Where(r => r.Type == LedgerTypes.Expense).Sum(r => r.Item2), list);
    }

    public async Task<List<FinYearResponse>> YearsAsync(CancellationToken ct)
    {
        await SyncAsync(ct);
        var today = FinanceRules.Today(time);
        var first = await db.Journals.AsNoTracking().Where(j => j.SourceType != JournalSources.YearEnd).Select(j => (DateOnly?)j.Date).MinAsync(ct);
        if (first is null) return [];
        var closes = (await ActiveClosesAsync(ct)).ToDictionary(j => j.SourceId);
        var users = closes.Count == 0 ? [] : await db.AuditLogs.AsNoTracking().Where(a => a.Action == "LedgerYearClosed").ToListAsync(ct);
        var result = new List<FinYearResponse>();
        for (var year = first.Value.Year; year <= today.Year; year++)
        {
            var (revenue, expenses, rows) = await YearResultAsync(year, ct);
            closes.TryGetValue(year, out var close);
            var latestClosed = closes.Keys.DefaultIfEmpty(0).Max();
            string? blocker = close is not null ? null : await BlockerAsync(year, today, closes, rows.Count, ct);
            var closedBy = close is null ? null : users.Where(a => a.EntityId == year.ToString()).OrderByDescending(a => a.TimestampUtc).Select(a => a.ActorUsername).FirstOrDefault();
            result.Add(new(year, close is null ? "Open" : "Closed", revenue, expenses, revenue - expenses, close?.Number, closedBy, close?.CreatedUtc, close is null && blocker is null, close is not null && year == latestClosed, blocker));
        }

        return result;
    }

    private async Task<string?> BlockerAsync(int year, DateOnly today, Dictionary<int, Journal> closes, int activeAccounts, CancellationToken ct)
    {
        if (new DateOnly(year, 12, 31) >= today) return $"{year} is not over yet. It can be closed from 1 January {year + 1}.";
        var first = await db.Journals.AsNoTracking().Where(j => j.SourceType != JournalSources.YearEnd).Select(j => j.Date.Year).MinAsync(ct);
        for (var y = first; y < year; y++)
            if (!closes.ContainsKey(y)) return $"Close {y} first. Years are closed in order.";
        if (closes.Keys.Any(y => y > year)) return "A later year is already closed. Reopen it first.";
        var pending = await db.FinEntries.CountAsync(e => e.Status == FinStatuses.Pending && e.EntryDate.Year == year, ct);
        if (pending > 0) return $"{pending} staff expense{(pending == 1 ? "" : "s")} dated in {year} still wait for approval. Approve or reject them first.";
        if (activeAccounts == 0) return $"There is no income or expense in {year}, so there is nothing to close.";
        return null;
    }

    public async Task<FinResult<FinYearResponse>> CloseYearAsync(int year, CancellationToken ct)
    {
        var years = await YearsAsync(ct);
        var info = years.SingleOrDefault(y => y.Year == year);
        if (info is null) return FinResult<FinYearResponse>.NotFound("That year has no books yet.");
        if (info.Status == "Closed") return FinResult<FinYearResponse>.Conflict($"{year} is already closed.");
        if (info.Blocker is not null) return FinResult<FinYearResponse>.Conflict(info.Blocker);

        // Lock every month first: a closed year takes no more changes.
        for (var m = 1; m <= 12; m++)
        {
            var key = $"{year:0000}-{m:00}";
            if (await periods.LockedMessageAsync(new DateOnly(year, m, 1), ct) is not null) continue;
            var locked = await periods.LockAsync(key, ct);
            if (locked.Status != 200) return FinResult<FinYearResponse>.Conflict(locked.Title ?? $"{key} could not be locked.");
        }

        await Gate.WaitAsync(ct);
        try
        {
            var retained = (await SystemAsync(ct))[RetainedEarningsCode];
            var (revenue, expenses, rows) = await YearResultAsync(year, ct);   // read again under the gate, after the locks
            var lines = new List<(int Account, decimal Debit, decimal Credit, string? Memo)>();
            foreach (var (account, balance, type) in rows)
            {
                var debit = type == LedgerTypes.Revenue;   // income is cleared with a debit, an expense with a credit
                lines.Add((account, debit ? balance : 0m, debit ? 0m : balance, null));
            }

            var net = revenue - expenses;
            lines.Add((retained.Id, net < 0m ? -net : 0m, net > 0m ? net : 0m, net >= 0m ? "Profit for the year" : "Loss for the year"));
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            var revision = await db.Journals.CountAsync(j => j.SourceType == JournalSources.YearEnd && j.SourceId == year && j.Part == "Post", ct);
            var description = $"Year-end close {year}: {(net >= 0m ? "profit" : "loss")} of AED {Math.Abs(net):N2} to retained earnings";
            await AddAsync(new(JournalSources.YearEnd, year, revision, new DateOnly(year, 12, 31), description, lines), transaction, ct);
            audit.Write("LedgerYearClosed", entityType: nameof(Journal), entityId: year.ToString(), details: new { year, revenue, expenses, net });
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        }
        finally
        {
            Gate.Release();
        }

        return FinResult<FinYearResponse>.Ok((await YearsAsync(ct)).Single(y => y.Year == year));
    }

    public async Task<FinResult<FinYearResponse>> ReopenYearAsync(int year, string? reason, CancellationToken ct)
    {
        var text = FinanceRules.Clean(reason);
        if (text is null) return FinResult<FinYearResponse>.Invalid("reason", "Enter the reason for reopening the year. It is kept with the reversal.");
        if (text.Length > 200) return FinResult<FinYearResponse>.Invalid("reason", "Use 200 characters or fewer.");
        var closes = await ActiveClosesAsync(ct);
        var close = closes.SingleOrDefault(j => j.SourceId == year);
        if (close is null) return FinResult<FinYearResponse>.Conflict($"{year} is not closed.");
        if (closes.Any(j => j.SourceId > year)) return FinResult<FinYearResponse>.Conflict("A later year is closed. Reopen the latest closed year first.");

        await Gate.WaitAsync(ct);
        try
        {
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            var original = await db.Journals.Include(j => j.Lines).SingleAsync(j => j.Id == close.Id, ct);
            await ReverseAsync(original, transaction, ct);
            audit.Write("LedgerYearReopened", entityType: nameof(Journal), entityId: year.ToString(), details: new { year, journal = original.Number, reason = text });
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        }
        finally
        {
            Gate.Release();
        }

        return FinResult<FinYearResponse>.Ok((await YearsAsync(ct)).Single(y => y.Year == year));
    }
}
