using System.Globalization;
using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace HrPayroll.Api.Services.Finance;

/// <summary>
/// The double-entry ledger, derived from the finance records. <see cref="SyncAsync"/> makes the journals match the records: it posts what is
/// new, reverses what was voided, and re-posts an opening balance that changed. It is idempotent, so it is safe to run after every write and
/// before every read. Journals are never edited or deleted (except by <see cref="RebuildAsync"/>, which exists only before the books go live).
/// </summary>
public sealed class FinanceLedgerService(AppDbContext db, FinanceAccountService accounts, FinancePartnerService partners, TimeProvider time)
{
    private static readonly SemaphoreSlim Gate = new(1, 1);
    public const string OpeningEquityCode = "3900";
    private const int ListCap = 500;

    // ---- chart of accounts -----------------------------------------------------------------------------------------

    private static (string Type, int Base) Range(string type) => type switch
    {
        LedgerTypes.Asset => (type, 1100), LedgerTypes.Liability => (type, 2100), LedgerTypes.Equity => (type, 3100),
        LedgerTypes.Revenue => (type, 4000), _ => (type, 5000),
    };

    private async Task<LedgerAccount> NewAccountAsync(string type, string name, CancellationToken ct)
    {
        var (_, start) = Range(type);
        var codes = await db.LedgerAccounts.Where(a => a.Type == type).Select(a => a.Code).ToListAsync(ct);
        var next = codes.Select(c => int.TryParse(c, NumberStyles.None, CultureInfo.InvariantCulture, out var n) ? n : 0).Where(n => n >= start && n < start + 900).DefaultIfEmpty(start - 10).Max() + 10;
        var account = new LedgerAccount { Code = next.ToString(CultureInfo.InvariantCulture), Name = name, Type = type, CreatedUtc = DateTime.UtcNow };
        db.LedgerAccounts.Add(account);
        await db.SaveChangesAsync(ct);
        return account;
    }

    private async Task<LedgerAccount> OpeningEquityAsync(CancellationToken ct)
    {
        var existing = await db.LedgerAccounts.SingleOrDefaultAsync(a => a.Code == OpeningEquityCode, ct);
        if (existing is not null) return existing;
        var account = new LedgerAccount { Code = OpeningEquityCode, Name = "Opening balance equity", Type = LedgerTypes.Equity, IsSystem = true, CreatedUtc = DateTime.UtcNow };
        db.LedgerAccounts.Add(account);
        await db.SaveChangesAsync(ct);
        return account;
    }

    /// <summary>Gives every account, category and partner its ledger account, making one where none is set yet.</summary>
    private async Task EnsureMappingAsync(CancellationToken ct)
    {
        foreach (var a in await db.FinAccounts.Where(x => x.LedgerAccountId == null).ToListAsync(ct))
            a.LedgerAccountId = (await NewAccountAsync(LedgerTypes.Asset, a.Name, ct)).Id;
        foreach (var c in await db.FinCategories.Where(x => x.LedgerAccountId == null).ToListAsync(ct))
            c.LedgerAccountId = (await NewAccountAsync(c.Kind == FinEntryKinds.Income ? LedgerTypes.Revenue : LedgerTypes.Expense, c.Name, ct)).Id;
        foreach (var p in await db.FinPartners.Where(x => x.LedgerAccountId == null).ToListAsync(ct))
            p.LedgerAccountId = (await NewAccountAsync(LedgerTypes.Equity, "Capital: " + p.Name, ct)).Id;
        await db.SaveChangesAsync(ct);
    }

    // ---- posting ---------------------------------------------------------------------------------------------------

    private async Task<string> NextNumberAsync(IDbContextTransaction transaction, CancellationToken ct)
    {
        await using var command = db.Database.GetDbConnection().CreateCommand();
        command.Transaction = transaction.GetDbTransaction();
        command.CommandText = "SELECT NEXT VALUE FOR LedgerJournalNo";
        var number = Convert.ToInt32(await command.ExecuteScalarAsync(ct), CultureInfo.InvariantCulture);
        return "JNL-" + number.ToString("000000", CultureInfo.InvariantCulture);
    }

    private sealed record Posting(string Source, int SourceId, int Revision, DateOnly Date, string Description, List<(int Account, decimal Debit, decimal Credit, string? Memo)> Lines);

    private async Task<int> AddAsync(Posting p, IDbContextTransaction transaction, CancellationToken ct)
    {
        var journal = new Journal { Number = await NextNumberAsync(transaction, ct), Date = p.Date, SourceType = p.Source, SourceId = p.SourceId, Revision = p.Revision, Part = "Post", Description = p.Description, CreatedUtc = DateTime.UtcNow };
        foreach (var l in p.Lines.Where(l => l.Debit != 0m || l.Credit != 0m))
            journal.Lines.Add(new JournalLine { LedgerAccountId = l.Account, Debit = l.Debit, Credit = l.Credit, Memo = l.Memo });
        if (journal.Lines.Sum(l => l.Debit) != journal.Lines.Sum(l => l.Credit)) throw new InvalidOperationException($"Journal for {p.Source} {p.SourceId} does not balance.");
        db.Journals.Add(journal);
        await db.SaveChangesAsync(ct);
        return journal.Id;
    }

    private async Task ReverseAsync(Journal original, IDbContextTransaction transaction, CancellationToken ct)
    {
        var journal = new Journal
        {
            Number = await NextNumberAsync(transaction, ct), Date = original.Date, SourceType = original.SourceType, SourceId = original.SourceId, Revision = original.Revision,
            Part = "Reversal", Description = "Reversal of " + original.Number + ": " + original.Description, ReversesJournalId = original.Id, CreatedUtc = DateTime.UtcNow,
        };
        foreach (var l in original.Lines) journal.Lines.Add(new JournalLine { LedgerAccountId = l.LedgerAccountId, Debit = l.Credit, Credit = l.Debit, Memo = l.Memo });
        db.Journals.Add(journal);
        await db.SaveChangesAsync(ct);
    }

    /// <summary>Makes the journals match the finance records. Safe to run any time, from any request.</summary>
    public async Task<LedgerSyncResult> SyncAsync(CancellationToken ct)
    {
        await Gate.WaitAsync(ct);
        try
        {
            await EnsureMappingAsync(ct);
            var equity = await OpeningEquityAsync(ct);
            var posted = 0;
            var reversed = 0;
            await using var transaction = await db.Database.BeginTransactionAsync(ct);

            var journals = await db.Journals.Include(j => j.Lines).ToListAsync(ct);
            Journal? Find(string source, int id, string part) => journals.Where(j => j.SourceType == source && j.SourceId == id && j.Part == part).OrderByDescending(j => j.Revision).FirstOrDefault();

            async Task PostAsync(Posting p)
            {
                var id = await AddAsync(p, transaction, ct);
                journals.Add(await db.Journals.Include(j => j.Lines).SingleAsync(j => j.Id == id, ct));
                posted++;
            }

            async Task UndoAsync(Journal original)
            {
                await ReverseAsync(original, transaction, ct);
                journals.Add(await db.Journals.Include(j => j.Lines).OrderByDescending(j => j.Id).FirstAsync(j => j.ReversesJournalId == original.Id, ct));
                reversed++;
            }

            var finAccounts = await db.FinAccounts.AsNoTracking().ToDictionaryAsync(a => a.Id, ct);
            var partnersById = await db.FinPartners.AsNoTracking().ToDictionaryAsync(p => p.Id, ct);
            var categories = await db.FinCategories.AsNoTracking().ToDictionaryAsync(c => c.Id, ct);

            // Opening balances of accounts: re-posted when the amount or date changed.
            foreach (var a in finAccounts.Values.OrderBy(a => a.Id))
                await SyncOpeningAsync(JournalSources.Opening, a.Id, a.OpeningDate, a.OpeningBalance, a.LedgerAccountId!.Value, equity.Id, "Opening balance of " + a.Name, journals, PostAsync, UndoAsync);

            // Partners' opening capital: it was already inside the accounts' opening balances, so it moves out of "opening balance equity" into the partner's own account.
            var capitalDate = finAccounts.Values.Select(a => a.OpeningDate).DefaultIfEmpty(FinanceRules.Today(time)).Min();
            foreach (var p in partnersById.Values.OrderBy(p => p.Id))
                await SyncOpeningAsync(JournalSources.PartnerOpening, p.Id, capitalDate, -p.OpeningCapital, p.LedgerAccountId!.Value, equity.Id, "Opening capital of " + p.Name, journals, PostAsync, UndoAsync, creditsAccount: true);

            var entries = await db.FinEntries.AsNoTracking().Include(e => e.Lines).Where(e => e.Status != FinStatuses.Pending).OrderBy(e => e.Id).ToListAsync(ct);
            foreach (var e in entries)
            {
                var original = Find(JournalSources.Entry, e.Id, "Post");
                if (e.Status == FinStatuses.Active && original is null)
                {
                    var asset = finAccounts[e.AccountId].LedgerAccountId!.Value;
                    var lines = new List<(int, decimal, decimal, string?)>();
                    switch (e.Kind)
                    {
                        case FinEntryKinds.Expense:
                            foreach (var l in LinesOf(e)) lines.Add((categories[l.CategoryId].LedgerAccountId!.Value, l.Amount, 0m, l.Note));
                            lines.Add((asset, 0m, e.Amount, null));
                            break;
                        case FinEntryKinds.Income:
                            lines.Add((asset, e.Amount, 0m, null));
                            foreach (var l in LinesOf(e)) lines.Add((categories[l.CategoryId].LedgerAccountId!.Value, 0m, l.Amount, l.Note));
                            break;
                        case FinEntryKinds.Capital:
                            lines.Add((asset, e.Amount, 0m, null));
                            lines.Add((partnersById[e.PartnerId!.Value].LedgerAccountId!.Value, 0m, e.Amount, null));
                            break;
                        default:   // CapitalOut
                            lines.Add((partnersById[e.PartnerId!.Value].LedgerAccountId!.Value, e.Amount, 0m, null));
                            lines.Add((asset, 0m, e.Amount, null));
                            break;
                    }

                    await PostAsync(new Posting(JournalSources.Entry, e.Id, 0, e.EntryDate, $"{e.EntryNo} {e.Party}", lines));
                }
                else if (e.Status == FinStatuses.Voided && original is not null && Find(JournalSources.Entry, e.Id, "Reversal") is null)
                    await UndoAsync(original);
            }

            var transfers = await db.FinTransfers.AsNoTracking().OrderBy(t => t.Id).ToListAsync(ct);
            foreach (var t in transfers)
            {
                var original = Find(JournalSources.Transfer, t.Id, "Post");
                if (t.Status == FinStatuses.Active && original is null)
                    await PostAsync(new Posting(JournalSources.Transfer, t.Id, 0, t.TransferDate, $"{t.TransferNo} {finAccounts[t.FromAccountId].Name} to {finAccounts[t.ToAccountId].Name}",
                        [(finAccounts[t.ToAccountId].LedgerAccountId!.Value, t.Amount, 0m, null), (finAccounts[t.FromAccountId].LedgerAccountId!.Value, 0m, t.Amount, null)]));
                else if (t.Status == FinStatuses.Voided && original is not null && Find(JournalSources.Transfer, t.Id, "Reversal") is null)
                    await UndoAsync(original);
            }

            await transaction.CommitAsync(ct);
            return new LedgerSyncResult(posted, reversed);
        }
        finally
        {
            Gate.Release();
        }
    }

    private static IEnumerable<(int CategoryId, decimal Amount, string? Note)> LinesOf(FinEntry e) =>
        e.Lines.Count > 0 ? e.Lines.Select(l => (l.CategoryId, l.Amount, l.Note)) : [(e.CategoryId, e.Amount, (string?)null)];

    /// <summary>
    /// Posts an opening balance, and when it later changes reverses the old posting and posts the new one. For an account the amount is a debit to the
    /// account (credit if negative); for a partner it is a credit to the partner's capital account (<paramref name="amount"/> is negated by the caller).
    /// </summary>
    private async Task SyncOpeningAsync(
        string source, int id, DateOnly date, decimal amount, int target, int equity, string description, List<Journal> journals,
        Func<Posting, Task> post, Func<Journal, Task> undo, bool creditsAccount = false)
    {
        var live = journals.Where(j => j.SourceType == source && j.SourceId == id && j.Part == "Post" && !journals.Any(r => r.ReversesJournalId == j.Id)).OrderByDescending(j => j.Revision).FirstOrDefault();
        decimal Current(Journal j) => j.Lines.Where(l => l.LedgerAccountId == target).Sum(l => creditsAccount ? -l.Credit + l.Debit : l.Debit - l.Credit);
        if (live is not null && live.Date == date && Current(live) == amount) return;
        var revision = journals.Where(j => j.SourceType == source && j.SourceId == id).Select(j => j.Revision).DefaultIfEmpty(-1).Max() + 1;
        if (live is not null) await undo(live);
        if (amount == 0m) return;

        // For an account a positive amount debits it; for a partner the negated amount means a credit to the partner, so the sign flips the same way.
        var debit = amount > 0 ? amount : 0m;
        var credit = amount < 0 ? -amount : 0m;
        await post(new Posting(source, id, revision, date, description,
            [(target, debit, credit, null), (equity, credit, debit, null)]));
    }

    // ---- reading ---------------------------------------------------------------------------------------------------

    private sealed record Totals(int Id, decimal Debit, decimal Credit);

    private async Task<Dictionary<int, Totals>> TotalsAsync(DateOnly? upTo, DateOnly? before, CancellationToken ct)
    {
        var lines = db.JournalLines.AsNoTracking().AsQueryable();
        if (upTo is { } to) lines = lines.Where(l => l.Journal.Date <= to);
        if (before is { } b) lines = lines.Where(l => l.Journal.Date < b);
        var rows = await lines.GroupBy(l => l.LedgerAccountId).Select(g => new { Id = g.Key, Debit = g.Sum(l => l.Debit), Credit = g.Sum(l => l.Credit) }).ToListAsync(ct);
        return rows.ToDictionary(r => r.Id, r => new Totals(r.Id, r.Debit, r.Credit));
    }

    private static decimal Balance(string type, decimal debit, decimal credit) => LedgerTypes.DebitNormal(type) ? debit - credit : credit - debit;

    public async Task<List<LedgerAccountResponse>> ChartAsync(DateOnly? asOf, CancellationToken ct)
    {
        await SyncAsync(ct);
        var totals = await TotalsAsync(asOf, null, ct);
        var accountsList = await db.LedgerAccounts.AsNoTracking().OrderBy(a => a.Code).ToListAsync(ct);
        return accountsList.Select(a => { totals.TryGetValue(a.Id, out var t); return new LedgerAccountResponse(a.Id, a.Code, a.Name, a.Type, a.IsActive, a.IsSystem, t?.Debit ?? 0m, t?.Credit ?? 0m, Balance(a.Type, t?.Debit ?? 0m, t?.Credit ?? 0m)); }).ToList();
    }

    public async Task<LedgerTrialBalance> TrialBalanceAsync(DateOnly? asOf, CancellationToken ct)
    {
        var date = asOf ?? FinanceRules.Today(time);
        var chart = (await ChartAsync(date, ct)).Where(a => a.Debit != 0m || a.Credit != 0m).ToList();
        var debit = chart.Sum(a => a.Debit);
        var credit = chart.Sum(a => a.Credit);
        return new(FinanceRules.Format(date), chart, debit, credit, debit == credit);
    }

    public async Task<FinResult<LedgerAccountStatement>> StatementAsync(int accountId, string? from, string? to, CancellationToken ct)
    {
        await SyncAsync(ct);
        var account = await db.LedgerAccounts.AsNoTracking().SingleOrDefaultAsync(a => a.Id == accountId, ct);
        if (account is null) return FinResult<LedgerAccountStatement>.NotFound("The account was not found.");
        var today = FinanceRules.Today(time);
        var end = FinanceRules.TryParseDate(to, out var e) ? e : today;
        var start = FinanceRules.TryParseDate(from, out var s) ? s : new DateOnly(end.Year, end.Month, 1);
        if (start > end) return FinResult<LedgerAccountStatement>.Invalid("to", "The end date cannot be before the start date.");

        var before = await TotalsAsync(null, start, ct);
        before.TryGetValue(account.Id, out var b);
        var opening = Balance(account.Type, b?.Debit ?? 0m, b?.Credit ?? 0m);
        var rows = await db.JournalLines.AsNoTracking().Where(l => l.LedgerAccountId == account.Id && l.Journal.Date >= start && l.Journal.Date <= end)
            .OrderBy(l => l.Journal.Date).ThenBy(l => l.JournalId).ThenBy(l => l.Id)
            .Select(l => new { l.Journal.Date, l.Journal.Number, l.Journal.Description, l.Journal.Part, l.Memo, l.Debit, l.Credit }).ToListAsync(ct);
        var running = opening;
        var lines = new List<LedgerLineResponse>();
        foreach (var r in rows)
        {
            running += LedgerTypes.DebitNormal(account.Type) ? r.Debit - r.Credit : r.Credit - r.Debit;
            lines.Add(new LedgerLineResponse(FinanceRules.Format(r.Date), r.Number, r.Description, r.Memo, r.Debit, r.Credit, running, r.Part));
        }

        var all = await TotalsAsync(end, null, ct);
        all.TryGetValue(account.Id, out var a);
        var head = new LedgerAccountResponse(account.Id, account.Code, account.Name, account.Type, account.IsActive, account.IsSystem, a?.Debit ?? 0m, a?.Credit ?? 0m, Balance(account.Type, a?.Debit ?? 0m, a?.Credit ?? 0m));
        return FinResult<LedgerAccountStatement>.Ok(new(head, FinanceRules.Format(start), FinanceRules.Format(end), opening, lines, running));
    }

    public async Task<JournalList> JournalsAsync(string? from, string? to, string? source, int? sourceId, CancellationToken ct)
    {
        await SyncAsync(ct);
        var query = db.Journals.AsNoTracking().Include(j => j.Lines).ThenInclude(l => l.LedgerAccount).AsQueryable();
        if (FinanceRules.TryParseDate(from, out var f)) query = query.Where(j => j.Date >= f);
        if (FinanceRules.TryParseDate(to, out var t)) query = query.Where(j => j.Date <= t);
        if (!string.IsNullOrWhiteSpace(source)) query = query.Where(j => j.SourceType == source);
        if (sourceId is { } id) query = query.Where(j => j.SourceId == id);
        var count = await query.CountAsync(ct);
        var rows = await query.OrderByDescending(j => j.Date).ThenByDescending(j => j.Id).Take(ListCap + 1).ToListAsync(ct);
        var truncated = rows.Count > ListCap;
        return new(rows.Take(ListCap).Select(j => new JournalResponse(j.Id, j.Number, FinanceRules.Format(j.Date), j.SourceType, j.SourceId, j.Part, j.Description,
            j.Lines.OrderByDescending(l => l.Debit).ThenBy(l => l.Id).Select(l => new JournalLineResponse(l.LedgerAccount.Code, l.LedgerAccount.Name, l.Debit, l.Credit, l.Memo)).ToList())).ToList(), count, truncated);
    }

    // ---- the safety checks -----------------------------------------------------------------------------------------

    /// <summary>The ledger must say what the finance screens say. Run after every change to posting, and available to the accountant as a report.</summary>
    public async Task<LedgerCheckResult> CheckAsync(CancellationToken ct)
    {
        await SyncAsync(ct);
        var totals = await TotalsAsync(null, null, ct);
        var checks = new List<LedgerCheck>();
        var finAccounts = await db.FinAccounts.AsNoTracking().ToDictionaryAsync(a => a.Id, ct);
        var types = await db.LedgerAccounts.AsNoTracking().ToDictionaryAsync(a => a.Id, a => a.Type, ct);

        foreach (var screen in await accounts.ListAsync(true, ct))
        {
            var mapped = finAccounts[screen.Id].LedgerAccountId!.Value;
            totals.TryGetValue(mapped, out var t);
            var ledger = Balance(types[mapped], t?.Debit ?? 0m, t?.Credit ?? 0m);
            checks.Add(new("Account balance", screen.Name, ledger, screen.Balance, ledger == screen.Balance));
        }

        var partnerAccounts = await db.FinPartners.AsNoTracking().ToDictionaryAsync(p => p.Id, p => p.LedgerAccountId!.Value, ct);
        foreach (var p in (await partners.ListAsync(ct)).Partners)
        {
            totals.TryGetValue(partnerAccounts[p.Id], out var t);
            var ledger = Balance(LedgerTypes.Equity, t?.Debit ?? 0m, t?.Credit ?? 0m);
            checks.Add(new("Partner capital", p.Name, ledger, p.NetCapital, ledger == p.NetCapital));
        }

        var journalSums = await db.JournalLines.AsNoTracking().GroupBy(l => l.JournalId).Select(g => new { g.Key, Debit = g.Sum(l => l.Debit), Credit = g.Sum(l => l.Credit) }).ToListAsync(ct);
        var unbalanced = journalSums.Count(j => j.Debit != j.Credit);
        var debit = journalSums.Sum(j => j.Debit);
        var credit = journalSums.Sum(j => j.Credit);
        checks.Add(new("Journals balance", "Every journal", unbalanced, 0m, unbalanced == 0));
        checks.Add(new("Debits equal credits", "All journals", debit, credit, debit == credit));
        return new(checks.All(c => c.Agrees), checks, journalSums.Count, debit, credit);
    }

    // ---- rebuild (before the books go live) ------------------------------------------------------------------------

    /// <summary>Throws the derived journals away and derives them again, for when the mapping changed before go-live. Refused once a journal falls in a locked month.</summary>
    public async Task<FinResult<LedgerSyncResult>> RebuildAsync(CancellationToken ct)
    {
        if (await db.FinMonthLocks.AnyAsync(l => l.IsLocked, ct)) return FinResult<LedgerSyncResult>.Conflict("A month is locked, so the books are settled and cannot be rebuilt. Unlock every month first.");
        await Gate.WaitAsync(ct);
        try
        {
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            await db.JournalLines.ExecuteDeleteAsync(ct);
            await db.Database.ExecuteSqlRawAsync("UPDATE [Journals] SET [ReversesJournalId] = NULL", ct);
            await db.Journals.ExecuteDeleteAsync(ct);
            await transaction.CommitAsync(ct);
        }
        finally
        {
            Gate.Release();
        }

        return FinResult<LedgerSyncResult>.Ok(await SyncAsync(ct));
    }
}
