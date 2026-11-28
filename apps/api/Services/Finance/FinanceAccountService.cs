using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services.Finance;

/// <summary>Bank and cash accounts. Balances are worked out from the entries and transfers, never stored.</summary>
public sealed class FinanceAccountService(AppDbContext db, IAuditLogger audit, FinanceRedactor redactor, TimeProvider time, FinancePeriodService periods)
{
    private sealed record Sums(int AccountId, decimal Income, decimal Expense, decimal In, decimal Out, int Count, decimal Capital = 0m);

    /// <summary>Per account: active income, expense, transfers in and out, and how many rows exist (voided included).</summary>
    private async Task<Dictionary<int, Sums>> SumsAsync(CancellationToken ct)
    {
        var entries = await db.FinEntries.AsNoTracking()
            .GroupBy(e => e.AccountId)
            .Select(g => new
            {
                AccountId = g.Key,
                Income = g.Where(e => e.Status == FinStatuses.Active && e.Kind == FinEntryKinds.Income).Sum(e => (decimal?)e.Amount) ?? 0m,
                Expense = g.Where(e => e.Status == FinStatuses.Active && e.Kind == FinEntryKinds.Expense).Sum(e => (decimal?)e.Amount) ?? 0m,
                Capital = (g.Where(e => e.Status == FinStatuses.Active && e.Kind == FinEntryKinds.Capital).Sum(e => (decimal?)e.Amount) ?? 0m)
                    - (g.Where(e => e.Status == FinStatuses.Active && e.Kind == FinEntryKinds.CapitalOut).Sum(e => (decimal?)e.Amount) ?? 0m),
                Count = g.Count(),
            }).ToListAsync(ct);
        var outgoing = await db.FinTransfers.AsNoTracking().GroupBy(t => t.FromAccountId)
            .Select(g => new { AccountId = g.Key, Sum = g.Where(t => t.Status == FinStatuses.Active).Sum(t => (decimal?)t.Amount) ?? 0m, Count = g.Count() }).ToListAsync(ct);
        var incoming = await db.FinTransfers.AsNoTracking().GroupBy(t => t.ToAccountId)
            .Select(g => new { AccountId = g.Key, Sum = g.Where(t => t.Status == FinStatuses.Active).Sum(t => (decimal?)t.Amount) ?? 0m, Count = g.Count() }).ToListAsync(ct);

        var result = new Dictionary<int, Sums>();
        foreach (var id in entries.Select(e => e.AccountId).Concat(outgoing.Select(o => o.AccountId)).Concat(incoming.Select(i => i.AccountId)).Distinct())
        {
            var e = entries.SingleOrDefault(x => x.AccountId == id);
            var o = outgoing.SingleOrDefault(x => x.AccountId == id);
            var i = incoming.SingleOrDefault(x => x.AccountId == id);
            result[id] = new Sums(id, e?.Income ?? 0m, e?.Expense ?? 0m, i?.Sum ?? 0m, o?.Sum ?? 0m, (e?.Count ?? 0) + (o?.Count ?? 0) + (i?.Count ?? 0), e?.Capital ?? 0m);
        }

        return result;
    }

    private FinAccountResponse ToResponse(FinAccount a, Sums? s, IReadOnlyDictionary<int, string>? holders = null, decimal uncleared = 0m) => new(
        a.Id, a.Name, a.Kind, a.BankName, redactor.Number(a.AccountNumber), redactor.Number(a.Iban), a.OpeningBalance,
        FinanceRules.Format(a.OpeningDate), a.IsActive, a.SortOrder,
        FinanceCalculator.Balance(a.OpeningBalance, s?.Income ?? 0m, s?.Expense ?? 0m, s?.In ?? 0m, s?.Out ?? 0m, s?.Capital ?? 0m), s?.Count ?? 0, a.StaffCanUse, a.HolderUserId, a.HolderUserId is { } h ? holders?.GetValueOrDefault(h) : null,
        uncleared, FinanceCalculator.Balance(a.OpeningBalance, s?.Income ?? 0m, s?.Expense ?? 0m, s?.In ?? 0m, s?.Out ?? 0m, s?.Capital ?? 0m) + uncleared);

    public async Task<List<FinAccountResponse>> ListAsync(bool includeInactive, CancellationToken ct)
    {
        var query = db.FinAccounts.AsNoTracking();
        if (!includeInactive) query = query.Where(a => a.IsActive);
        var accounts = await query.OrderBy(a => a.SortOrder).ThenBy(a => a.Name).ToListAsync(ct);
        var sums = await SumsAsync(ct);
        var holders = await HolderNamesAsync(ct);
        var uncleared = await UnclearedAsync(ct);
        return accounts.Select(a => ToResponse(a, sums.GetValueOrDefault(a.Id), holders, uncleared.GetValueOrDefault(a.Id))).ToList();
    }

    /// <summary>
    /// Per account: cheques recorded in the books that the bank has not paid or received yet. A cheque written is already an expense here, but the money is still in the
    /// bank (so it adds back); a cheque received is already income here, but the money is not in the bank yet (so it takes off). The bank statement agrees with the balance plus this.
    /// </summary>
    private async Task<Dictionary<int, decimal>> UnclearedAsync(CancellationToken ct)
    {
        var rows = await db.FinCheques.AsNoTracking()
            .Where(c => c.EntryId != null && (c.Status == FinChequeStatuses.Issued || c.Status == FinChequeStatuses.Delivered || c.Status == FinChequeStatuses.Received || c.Status == FinChequeStatuses.Deposited)
                && db.FinEntries.Any(e => e.Id == c.EntryId && e.Status == FinStatuses.Active))
            .Select(c => new { c.AccountId, c.Direction, c.Amount }).ToListAsync(ct);
        return rows.GroupBy(r => r.AccountId).ToDictionary(g => g.Key, g => g.Sum(r => r.Direction == FinChequeDirections.Issued ? r.Amount : -r.Amount));
    }

    private async Task<Dictionary<int, string>> HolderNamesAsync(CancellationToken ct)
    {
        var ids = await db.FinAccounts.AsNoTracking().Where(a => a.HolderUserId != null).Select(a => a.HolderUserId!.Value).ToListAsync(ct);
        return await db.Users.AsNoTracking().Where(u => ids.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.Username, ct);
    }

    private async Task<FinAccountResponse> ReloadAsync(FinAccount account, CancellationToken ct)
    {
        var sums = await SumsAsync(ct);
        return ToResponse(account, sums.GetValueOrDefault(account.Id), await HolderNamesAsync(ct), (await UnclearedAsync(ct)).GetValueOrDefault(account.Id));
    }

    private Dictionary<string, string[]> Validate(FinAccountRequest request, out DateOnly openingDate)
    {
        var errors = new Dictionary<string, string[]>();
        var name = FinanceRules.Clean(request.Name);
        if (name is null) errors["name"] = ["Enter the account name."];
        else if (name.Length > 120) errors["name"] = ["Use 120 characters or fewer."];
        if (request.Kind is null || !FinAccountKinds.All.Contains(request.Kind)) errors["kind"] = ["Choose Bank, Cash or Custody (petty cash held by a staff member)."];
        if (FinanceRules.Clean(request.BankName)?.Length > 80) errors["bankName"] = ["Use 80 characters or fewer."];
        if (FinanceRules.Clean(request.AccountNumber)?.Length > 40) errors["accountNumber"] = ["Use 40 characters or fewer."];
        if (FinanceRules.Clean(request.Iban)?.Length > 40) errors["iban"] = ["Use 40 characters or fewer."];

        if (request.OpeningBalance is null) errors["openingBalance"] = ["Enter the opening balance (0 if none)."];
        else if (!FinanceCalculator.IsMoney(request.OpeningBalance.Value)) errors["openingBalance"] = ["Use at most 2 decimal places."];
        else if (Math.Abs(request.OpeningBalance.Value) > FinanceRules.MaxAmount) errors["openingBalance"] = ["That amount is too large."];

        openingDate = default;
        if (!FinanceRules.TryParseDate(request.OpeningDate, out openingDate)) errors["openingDate"] = ["Enter the date the opening balance holds."];
        else if (openingDate > FinanceRules.Today(time)) errors["openingDate"] = ["The opening date cannot be in the future."];
        return errors;
    }

    /// <summary>A Custody account needs the one staff member who holds it; no other account has a holder.</summary>
    private async Task<int?> CheckHolderAsync(FinAccountRequest request, int? ownId, Dictionary<string, string[]> errors, CancellationToken ct)
    {
        if (request.Kind != FinAccountKinds.Custody) return null;
        if (request.HolderUserId is not { } holderId) { errors["holderUserId"] = ["Choose the staff member who holds the cash."]; return null; }
        var staffRoles = new[] { HrPayroll.Api.Auth.Roles.Employee, HrPayroll.Api.Auth.Roles.Supervisor, HrPayroll.Api.Auth.Roles.HR };
        if (!await db.Users.AnyAsync(u => u.Id == holderId && u.IsActive && staffRoles.Contains(u.Role), ct)) { errors["holderUserId"] = ["Choose an active office staff login."]; return null; }
        if (await db.FinAccounts.AnyAsync(a => a.HolderUserId == holderId && a.Id != ownId, ct)) { errors["holderUserId"] = ["That person already has a petty-cash account."]; return null; }
        return holderId;
    }

    public async Task<FinResult<FinAccountResponse>> CreateAsync(FinAccountRequest request, CancellationToken ct)
    {
        var errors = Validate(request, out var openingDate);
        var holder = errors.ContainsKey("kind") ? null : await CheckHolderAsync(request, null, errors, ct);
        var name = FinanceRules.Clean(request.Name);
        if (errors.Count == 0 && await db.FinAccounts.AnyAsync(a => a.Name == name, ct)) errors["name"] = ["An account with this name already exists."];
        if (errors.Count > 0) return FinResult<FinAccountResponse>.Invalid(errors);

        var now = DateTime.UtcNow;
        var account = new FinAccount
        {
            Name = name!, Kind = request.Kind!, BankName = FinanceRules.Clean(request.BankName), AccountNumber = FinanceRules.Clean(request.AccountNumber),
            Iban = FinanceRules.Clean(request.Iban), OpeningBalance = request.OpeningBalance!.Value, OpeningDate = openingDate,
            SortOrder = request.SortOrder ?? 0, StaffCanUse = request.StaffCanUse ?? false, HolderUserId = holder, CreatedUtc = now, UpdatedUtc = now,
        };
        db.FinAccounts.Add(account);
        try
        {
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            await db.SaveChangesAsync(ct);
            audit.Write("FinAccountCreated", entityType: nameof(FinAccount), entityId: account.Id.ToString(),
                details: new { account.Name, account.Kind, account.OpeningBalance, openingDate = FinanceRules.Format(account.OpeningDate) });
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        }
        catch (DbUpdateException ex) when (FinanceRules.IsDuplicate(ex))
        {
            return FinResult<FinAccountResponse>.Invalid("name", "An account with this name already exists.");
        }

        return FinResult<FinAccountResponse>.Created(await ReloadAsync(account, ct));
    }

    public async Task<FinResult<FinAccountResponse>> UpdateAsync(int id, FinAccountRequest request, CancellationToken ct)
    {
        var account = await db.FinAccounts.SingleOrDefaultAsync(a => a.Id == id, ct);
        if (account is null) return FinResult<FinAccountResponse>.NotFound("Account not found.");

        var errors = Validate(request, out var openingDate);
        var holder = errors.ContainsKey("kind") ? null : await CheckHolderAsync(request, id, errors, ct);
        var name = FinanceRules.Clean(request.Name);
        if (errors.Count == 0 && await db.FinAccounts.AnyAsync(a => a.Name == name && a.Id != id, ct)) errors["name"] = ["An account with this name already exists."];
        if (errors.Count == 0 && openingDate > account.OpeningDate)
        {
            var firstEntry = await db.FinEntries.Where(e => e.AccountId == id).MinAsync(e => (DateOnly?)e.EntryDate, ct);
            var firstTransfer = await db.FinTransfers.Where(t => t.FromAccountId == id || t.ToAccountId == id).MinAsync(t => (DateOnly?)t.TransferDate, ct);
            var first = new[] { firstEntry, firstTransfer }.Where(d => d is not null).Min();
            if (first is { } date && openingDate > date)
                errors["openingDate"] = [$"An entry is dated {FinanceRules.Format(date)}. The opening date cannot be after it."];
        }

        if (errors.Count == 0 && (request.OpeningBalance != account.OpeningBalance || openingDate != account.OpeningDate) && await periods.AnyLockedAsync(ct))
            errors["openingBalance"] = ["A month has been locked, so opening balances are settled. Unlock every month first to change this."];
        if (errors.Count > 0) return FinResult<FinAccountResponse>.Invalid(errors);

        var before = new { account.Name, account.Kind, account.BankName, hasNumber = account.AccountNumber is not null, hasIban = account.Iban is not null, account.OpeningBalance, openingDate = FinanceRules.Format(account.OpeningDate), account.SortOrder, account.StaffCanUse };
        var numberChanged = account.AccountNumber != FinanceRules.Clean(request.AccountNumber) || account.Iban != FinanceRules.Clean(request.Iban);
        account.Name = name!;
        account.Kind = request.Kind!;
        account.BankName = FinanceRules.Clean(request.BankName);
        account.AccountNumber = FinanceRules.Clean(request.AccountNumber);
        account.Iban = FinanceRules.Clean(request.Iban);
        account.OpeningBalance = request.OpeningBalance!.Value;
        account.OpeningDate = openingDate;
        if (request.SortOrder is { } order) account.SortOrder = order;
        if (request.StaffCanUse is { } staffCanUse) account.StaffCanUse = staffCanUse;
        account.HolderUserId = holder;
        var after = new { account.Name, account.Kind, account.BankName, hasNumber = account.AccountNumber is not null, hasIban = account.Iban is not null, account.OpeningBalance, openingDate = FinanceRules.Format(account.OpeningDate), account.SortOrder, account.StaffCanUse };

        if (!before.Equals(after) || numberChanged)
        {
            account.UpdatedUtc = DateTime.UtcNow;
            audit.Write("FinAccountUpdated", entityType: nameof(FinAccount), entityId: account.Id.ToString(), details: new { before, after, numberChanged });
            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException ex) when (FinanceRules.IsDuplicate(ex))
            {
                return FinResult<FinAccountResponse>.Invalid("name", "An account with this name already exists.");
            }
        }

        return FinResult<FinAccountResponse>.Ok(await ReloadAsync(account, ct));
    }

    public async Task<FinResult<FinAccountResponse>> SetActiveAsync(int id, bool active, CancellationToken ct)
    {
        var account = await db.FinAccounts.SingleOrDefaultAsync(a => a.Id == id, ct);
        if (account is null) return FinResult<FinAccountResponse>.NotFound("Account not found.");
        if (account.IsActive == active) return FinResult<FinAccountResponse>.Ok(await ReloadAsync(account, ct));

        if (!active)
        {
            var balance = (await ReloadAsync(account, ct)).Balance;
            if (balance != 0m)
                return FinResult<FinAccountResponse>.Conflict($"This account still holds AED {balance:N2}. Transfer or record the remaining amount first.");
        }

        account.IsActive = active;
        account.UpdatedUtc = DateTime.UtcNow;
        audit.Write(active ? "FinAccountActivated" : "FinAccountDeactivated", entityType: nameof(FinAccount), entityId: account.Id.ToString(), details: new { account.Name });
        await db.SaveChangesAsync(ct);
        return FinResult<FinAccountResponse>.Ok(await ReloadAsync(account, ct));
    }
}
