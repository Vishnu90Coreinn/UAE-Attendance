using System.Text.RegularExpressions;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services.Finance;

// The accountant's tools: editing the chart of accounts, choosing which ledger account each record posts to, and posting journals by hand.
public sealed partial class FinanceLedgerService
{
    private static readonly Regex CodePattern = new("^[A-Za-z0-9][A-Za-z0-9.-]{0,19}$", RegexOptions.Compiled);

    // ---- chart of accounts -----------------------------------------------------------------------------------------

    private async Task<Dictionary<string, string[]>> CheckAccountAsync(string? code, string? name, string? type, int? ownId, CancellationToken ct)
    {
        await OpeningEquityAsync(ct);   // the system's own account exists before anyone can claim its code
        var errors = new Dictionary<string, string[]>();
        if (code is null) errors["code"] = ["Enter the account code."];
        else if (!CodePattern.IsMatch(code)) errors["code"] = ["Use letters, digits, dots or dashes, up to 20 characters."];
        if (name is null) errors["name"] = ["Enter the account name."];
        else if (name.Length > 120) errors["name"] = ["Use 120 characters or fewer."];
        if (type is null || !LedgerTypes.All.Contains(type)) errors["type"] = ["Choose Asset, Liability, Equity, Revenue or Expense."];
        if (errors.Count == 0 && await db.LedgerAccounts.AnyAsync(a => a.Code == code && a.Id != ownId, ct)) errors["code"] = ["That code is already used."];
        return errors;
    }

    public async Task<FinResult<LedgerAccountResponse>> CreateAccountAsync(LedgerAccountRequest request, CancellationToken ct)
    {
        var code = FinanceRules.Clean(request.Code);
        var name = FinanceRules.Clean(request.Name);
        var errors = await CheckAccountAsync(code, name, request.Type, null, ct);
        if (errors.Count > 0) return FinResult<LedgerAccountResponse>.Invalid(errors);

        var account = new LedgerAccount { Code = code!, Name = name!, Type = request.Type!, CreatedUtc = DateTime.UtcNow };
        db.LedgerAccounts.Add(account);
        audit.Write("LedgerAccountCreated", entityType: nameof(LedgerAccount), entityId: "new", details: new { account.Code, account.Name, account.Type });
        await db.SaveChangesAsync(ct);
        return FinResult<LedgerAccountResponse>.Created(new(account.Id, account.Code, account.Name, account.Type, true, false, 0m, 0m, 0m));
    }

    /// <summary>Renames or recodes an account, or switches it off. Its type cannot change once it has postings, and an account in use cannot be switched off.</summary>
    public async Task<FinResult<LedgerAccountResponse>> UpdateAccountAsync(int id, LedgerAccountRequest request, CancellationToken ct)
    {
        var account = await db.LedgerAccounts.SingleOrDefaultAsync(a => a.Id == id, ct);
        if (account is null) return FinResult<LedgerAccountResponse>.NotFound("The account was not found.");
        var code = FinanceRules.Clean(request.Code) ?? account.Code;
        var name = FinanceRules.Clean(request.Name) ?? account.Name;
        var type = request.Type ?? account.Type;
        var errors = await CheckAccountAsync(code, name, type, id, ct);
        var hasLines = await db.JournalLines.AnyAsync(l => l.LedgerAccountId == id, ct);
        if (type != account.Type && hasLines) errors["type"] = ["The type cannot change once the account has postings."];
        if (account.IsSystem && code != account.Code) errors["code"] = ["This account is needed by the system and keeps its code."];
        var active = request.IsActive ?? account.IsActive;
        if (!active && account.IsActive)
        {
            if (account.IsSystem) errors["isActive"] = ["This account is needed by the system and cannot be switched off."];
            else if (await UsedByAsync(id, ct) is { } use) errors["isActive"] = [$"It is still where {use} posts. Choose another account for it first."];
        }

        if (errors.Count > 0) return FinResult<LedgerAccountResponse>.Invalid(errors);
        var before = new { account.Code, account.Name, account.Type, account.IsActive };
        account.Code = code;
        account.Name = name;
        account.Type = type;
        account.IsActive = active;
        audit.Write("LedgerAccountUpdated", entityType: nameof(LedgerAccount), entityId: id.ToString(), details: new { before, after = new { account.Code, account.Name, account.Type, account.IsActive } });
        await db.SaveChangesAsync(ct);
        var totals = await TotalsAsync(null, null, ct);
        totals.TryGetValue(id, out var t);
        return FinResult<LedgerAccountResponse>.Ok(new(account.Id, account.Code, account.Name, account.Type, account.IsActive, account.IsSystem, t?.Debit ?? 0m, t?.Credit ?? 0m, Balance(account.Type, t?.Debit ?? 0m, t?.Credit ?? 0m)));
    }

    private async Task<string?> UsedByAsync(int ledgerId, CancellationToken ct)
    {
        if (await db.FinCategories.Where(c => c.LedgerAccountId == ledgerId).Select(c => c.Name).FirstOrDefaultAsync(ct) is { } category) return $"the category \"{category}\"";
        if (await db.FinAccounts.Where(a => a.LedgerAccountId == ledgerId).Select(a => a.Name).FirstOrDefaultAsync(ct) is { } account) return $"the account \"{account}\"";
        if (await db.FinPartners.Where(p => p.LedgerAccountId == ledgerId).Select(p => p.Name).FirstOrDefaultAsync(ct) is { } partner) return $"the partner \"{partner}\"";
        return null;
    }

    // ---- mapping ---------------------------------------------------------------------------------------------------

    public async Task<List<LedgerMapping>> MappingsAsync(CancellationToken ct)
    {
        await SyncAsync(ct);
        var result = new List<LedgerMapping>();
        result.AddRange((await db.FinAccounts.AsNoTracking().OrderBy(a => a.SortOrder).ThenBy(a => a.Name).ToListAsync(ct)).Select(a => new LedgerMapping("Account", a.Id, a.Name, a.Kind, a.LedgerAccountId!.Value)));
        result.AddRange((await db.FinPartners.AsNoTracking().OrderBy(p => p.SortOrder).ThenBy(p => p.Name).ToListAsync(ct)).Select(p => new LedgerMapping("Partner", p.Id, p.Name, null, p.LedgerAccountId!.Value)));
        result.AddRange((await db.FinCategories.AsNoTracking().Where(c => c.Kind == FinEntryKinds.Expense || c.Kind == FinEntryKinds.Income).OrderBy(c => c.Kind).ThenBy(c => c.Name).ToListAsync(ct))
            .Select(c => new LedgerMapping("Category", c.Id, c.Name, c.Kind, c.LedgerAccountId!.Value)));
        return result;
    }

    /// <summary>
    /// Points a category, a bank or cash account, or a partner at another ledger account, then derives the books again so the past follows.
    /// Refused once a month is locked, because the books are then settled.
    /// </summary>
    public async Task<FinResult<LedgerMapping>> SetMappingAsync(string kind, int id, LedgerMappingRequest request, CancellationToken ct)
    {
        if (request.LedgerAccountId is not { } targetId) return FinResult<LedgerMapping>.Invalid("ledgerAccountId", "Choose the ledger account.");
        var target = await db.LedgerAccounts.AsNoTracking().SingleOrDefaultAsync(a => a.Id == targetId, ct);
        if (target is null || !target.IsActive) return FinResult<LedgerMapping>.Invalid("ledgerAccountId", "Choose an active ledger account.");
        if (await db.FinMonthLocks.AnyAsync(l => l.IsLocked, ct)) return FinResult<LedgerMapping>.Conflict("A month is locked, so the books are settled. Unlock every month before changing where records post.");

        string name;
        int previous;
        switch (kind)
        {
            case "Category":
                var category = await db.FinCategories.SingleOrDefaultAsync(c => c.Id == id && (c.Kind == FinEntryKinds.Expense || c.Kind == FinEntryKinds.Income), ct);
                if (category is null) return FinResult<LedgerMapping>.NotFound("The category was not found.");
                (name, previous, category.LedgerAccountId) = (category.Name, category.LedgerAccountId ?? 0, targetId);
                break;
            case "Account":
                var account = await db.FinAccounts.SingleOrDefaultAsync(a => a.Id == id, ct);
                if (account is null) return FinResult<LedgerMapping>.NotFound("The account was not found.");
                if (target.Type is not (LedgerTypes.Asset or LedgerTypes.Liability)) return FinResult<LedgerMapping>.Invalid("ledgerAccountId", "A bank, cash or petty-cash account posts to an asset (or liability) account.");
                if (await db.FinAccounts.AnyAsync(a => a.Id != id && a.LedgerAccountId == targetId, ct)) return FinResult<LedgerMapping>.Invalid("ledgerAccountId", "Another account already posts there. Each one needs its own ledger account.");
                (name, previous, account.LedgerAccountId) = (account.Name, account.LedgerAccountId ?? 0, targetId);
                break;
            case "Partner":
                var partner = await db.FinPartners.SingleOrDefaultAsync(p => p.Id == id, ct);
                if (partner is null) return FinResult<LedgerMapping>.NotFound("The partner was not found.");
                if (target.Type is not (LedgerTypes.Equity or LedgerTypes.Liability)) return FinResult<LedgerMapping>.Invalid("ledgerAccountId", "A partner's capital posts to an equity (or liability) account.");
                if (await db.FinPartners.AnyAsync(p => p.Id != id && p.LedgerAccountId == targetId, ct)) return FinResult<LedgerMapping>.Invalid("ledgerAccountId", "Another partner already posts there. Each one needs their own ledger account.");
                (name, previous, partner.LedgerAccountId) = (partner.Name, partner.LedgerAccountId ?? 0, targetId);
                break;
            default:
                return FinResult<LedgerMapping>.NotFound("Choose Category, Account or Partner.");
        }

        audit.Write("LedgerMappingChanged", entityType: kind, entityId: id.ToString(), details: new { name, from = previous, to = targetId });
        await db.SaveChangesAsync(ct);
        var rebuilt = await RebuildAsync(ct);
        if (rebuilt.Status != 200) return FinResult<LedgerMapping>.Conflict(rebuilt.Title ?? "The books could not be rebuilt.");
        return FinResult<LedgerMapping>.Ok((await MappingsAsync(ct)).Single(m => m.Kind == kind && m.Id == id));
    }

    // ---- manual journals -------------------------------------------------------------------------------------------

    public async Task<FinResult<JournalResponse>> PostManualAsync(ManualJournalRequest request, CancellationToken ct)
    {
        var errors = new Dictionary<string, string[]>();
        var description = FinanceRules.Clean(request.Description);
        if (description is null) errors["description"] = ["Enter what this journal is for."];
        else if (description.Length > 280) errors["description"] = ["Use 280 characters or fewer."];

        DateOnly date = default;
        if (!FinanceRules.TryParseDate(request.Date, out date)) errors["date"] = ["Enter the date."];
        else if (date > FinanceRules.Today(time)) errors["date"] = ["The date cannot be in the future."];

        var lines = request.Lines ?? [];
        if (lines.Count < 2) errors["lines"] = ["A journal needs at least two lines."];
        else if (lines.Count > 50) errors["lines"] = ["Use at most 50 lines."];
        var accountIds = lines.Where(l => l.AccountId is not null).Select(l => l.AccountId!.Value).Distinct().ToList();
        var known = await db.LedgerAccounts.AsNoTracking().Where(a => accountIds.Contains(a.Id)).ToDictionaryAsync(a => a.Id, ct);
        var rows = new List<(int Account, decimal Debit, decimal Credit, string? Memo)>();
        if (!errors.ContainsKey("lines"))
        {
            foreach (var l in lines)
            {
                if (l.AccountId is not { } a || !known.TryGetValue(a, out var acc) || !acc.IsActive) { errors["lines"] = ["Every line needs an active account."]; break; }
                var debit = l.Debit ?? 0m;
                var credit = l.Credit ?? 0m;
                if (debit < 0m || credit < 0m || (debit > 0m) == (credit > 0m)) { errors["lines"] = ["Every line is either a debit or a credit, above zero."]; break; }
                if (!FinanceCalculator.IsMoney(debit) || !FinanceCalculator.IsMoney(credit) || debit > FinanceRules.MaxAmount || credit > FinanceRules.MaxAmount) { errors["lines"] = ["Use at most 2 decimal places, and a smaller amount."]; break; }
                if (FinanceRules.Clean(l.Memo)?.Length > 200) { errors["lines"] = ["A line note takes 200 characters or fewer."]; break; }
                rows.Add((a, debit, credit, FinanceRules.Clean(l.Memo)));
            }

            if (!errors.ContainsKey("lines") && rows.Sum(r => r.Debit) != rows.Sum(r => r.Credit))
                errors["lines"] = [$"The journal does not balance: debits are {rows.Sum(r => r.Debit):N2} and credits are {rows.Sum(r => r.Credit):N2}."];
        }

        if (errors.Count > 0) return FinResult<JournalResponse>.Invalid(errors);
        if (await periods.LockedMessageAsync(date, ct) is { } locked) return FinResult<JournalResponse>.Conflict(locked);

        int sourceId;
        await Gate.WaitAsync(ct);
        try
        {
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            sourceId = (await db.Journals.Where(j => j.SourceType == JournalSources.Manual).Select(j => (int?)j.SourceId).MaxAsync(ct) ?? 0) + 1;
            var journal = new Journal
            {
                Number = await NextNumberAsync(transaction, ct), Date = date, SourceType = JournalSources.Manual, SourceId = sourceId, Revision = 0, Part = "Post",
                Description = description!, CreatedBy = FinanceRules.Actor(http), CreatedUtc = DateTime.UtcNow,
            };
            foreach (var r in rows) journal.Lines.Add(new JournalLine { LedgerAccountId = r.Account, Debit = r.Debit, Credit = r.Credit, Memo = r.Memo });
            db.Journals.Add(journal);
            audit.Write("LedgerManualJournalPosted", entityType: nameof(Journal), entityId: journal.Number, details: new { journal.Number, date = FinanceRules.Format(date), description, debit = rows.Sum(r => r.Debit), lines = rows.Count });
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        }
        finally
        {
            Gate.Release();   // the read below syncs, which takes the same gate
        }

        return FinResult<JournalResponse>.Created((await JournalsAsync(null, null, JournalSources.Manual, sourceId, ct)).Items.First(j => j.Part == "Post"));
    }

    /// <summary>Undoes a manual journal with a reversing one, dated today. Journals made from the records are not reversed here: void the record instead.</summary>
    public async Task<FinResult<JournalResponse>> ReverseManualAsync(int id, string? reason, CancellationToken ct)
    {
        var text = FinanceRules.Clean(reason);
        if (text is null) return FinResult<JournalResponse>.Invalid("reason", "Enter the reason. It is kept with the reversal.");
        if (text.Length > 200) return FinResult<JournalResponse>.Invalid("reason", "Use 200 characters or fewer.");
        var original = await db.Journals.Include(j => j.Lines).SingleOrDefaultAsync(j => j.Id == id, ct);
        if (original is null) return FinResult<JournalResponse>.NotFound("The journal was not found.");
        if (original.SourceType != JournalSources.Manual || original.Part != "Post") return FinResult<JournalResponse>.Conflict("Only a journal posted by hand can be reversed here. A journal made from an entry or transfer follows that record: void the record instead.");
        if (await db.Journals.AnyAsync(j => j.ReversesJournalId == id, ct)) return FinResult<JournalResponse>.Conflict($"{original.Number} has already been reversed.");
        var today = FinanceRules.Today(time);
        if (await periods.LockedMessageAsync(today, ct) is { } locked) return FinResult<JournalResponse>.Conflict(locked);

        await Gate.WaitAsync(ct);
        try
        {
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            var reversal = new Journal
            {
                Number = await NextNumberAsync(transaction, ct), Date = today, SourceType = JournalSources.Manual, SourceId = original.SourceId, Revision = original.Revision, Part = "Reversal",
                Description = $"Reversal of {original.Number}: {text}", ReversesJournalId = original.Id, CreatedBy = FinanceRules.Actor(http), CreatedUtc = DateTime.UtcNow,
            };
            foreach (var l in original.Lines) reversal.Lines.Add(new JournalLine { LedgerAccountId = l.LedgerAccountId, Debit = l.Credit, Credit = l.Debit, Memo = l.Memo });
            db.Journals.Add(reversal);
            audit.Write("LedgerManualJournalReversed", entityType: nameof(Journal), entityId: original.Number, details: new { original = original.Number, reversal = reversal.Number, reason = text });
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        }
        finally
        {
            Gate.Release();
        }

        return FinResult<JournalResponse>.Ok((await JournalsAsync(null, null, JournalSources.Manual, original.SourceId, ct)).Items.First(j => j.Part == "Reversal"));
    }
}
