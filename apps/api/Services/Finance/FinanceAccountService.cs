using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services.Finance;

/// <summary>Bank and cash accounts. Balances are worked out from the entries and transfers, never stored.</summary>
public sealed class FinanceAccountService(AppDbContext db, IAuditLogger audit, FinanceRedactor redactor, TimeProvider time)
{
    private sealed record Sums(int AccountId, decimal Income, decimal Expense, decimal In, decimal Out, int Count);

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
            result[id] = new Sums(id, e?.Income ?? 0m, e?.Expense ?? 0m, i?.Sum ?? 0m, o?.Sum ?? 0m, (e?.Count ?? 0) + (o?.Count ?? 0) + (i?.Count ?? 0));
        }

        return result;
    }

    private FinAccountResponse ToResponse(FinAccount a, Sums? s) => new(
        a.Id, a.Name, a.Kind, a.BankName, redactor.Number(a.AccountNumber), redactor.Number(a.Iban), a.OpeningBalance,
        FinanceRules.Format(a.OpeningDate), a.IsActive, a.SortOrder,
        FinanceCalculator.Balance(a.OpeningBalance, s?.Income ?? 0m, s?.Expense ?? 0m, s?.In ?? 0m, s?.Out ?? 0m), s?.Count ?? 0);

    public async Task<List<FinAccountResponse>> ListAsync(bool includeInactive, CancellationToken ct)
    {
        var query = db.FinAccounts.AsNoTracking();
        if (!includeInactive) query = query.Where(a => a.IsActive);
        var accounts = await query.OrderBy(a => a.SortOrder).ThenBy(a => a.Name).ToListAsync(ct);
        var sums = await SumsAsync(ct);
        return accounts.Select(a => ToResponse(a, sums.GetValueOrDefault(a.Id))).ToList();
    }

    private async Task<FinAccountResponse> ReloadAsync(FinAccount account, CancellationToken ct)
    {
        var sums = await SumsAsync(ct);
        return ToResponse(account, sums.GetValueOrDefault(account.Id));
    }

    private Dictionary<string, string[]> Validate(FinAccountRequest request, out DateOnly openingDate)
    {
        var errors = new Dictionary<string, string[]>();
        var name = FinanceRules.Clean(request.Name);
        if (name is null) errors["name"] = ["Enter the account name."];
        else if (name.Length > 120) errors["name"] = ["Use 120 characters or fewer."];
        if (request.Kind is null || !FinAccountKinds.All.Contains(request.Kind)) errors["kind"] = ["Choose Bank or Cash."];
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

    public async Task<FinResult<FinAccountResponse>> CreateAsync(FinAccountRequest request, CancellationToken ct)
    {
        var errors = Validate(request, out var openingDate);
        var name = FinanceRules.Clean(request.Name);
        if (errors.Count == 0 && await db.FinAccounts.AnyAsync(a => a.Name == name, ct)) errors["name"] = ["An account with this name already exists."];
        if (errors.Count > 0) return FinResult<FinAccountResponse>.Invalid(errors);

        var now = DateTime.UtcNow;
        var account = new FinAccount
        {
            Name = name!, Kind = request.Kind!, BankName = FinanceRules.Clean(request.BankName), AccountNumber = FinanceRules.Clean(request.AccountNumber),
            Iban = FinanceRules.Clean(request.Iban), OpeningBalance = request.OpeningBalance!.Value, OpeningDate = openingDate,
            SortOrder = request.SortOrder ?? 0, CreatedUtc = now, UpdatedUtc = now,
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

        if (errors.Count > 0) return FinResult<FinAccountResponse>.Invalid(errors);

        var before = new { account.Name, account.Kind, account.BankName, hasNumber = account.AccountNumber is not null, hasIban = account.Iban is not null, account.OpeningBalance, openingDate = FinanceRules.Format(account.OpeningDate), account.SortOrder };
        var numberChanged = account.AccountNumber != FinanceRules.Clean(request.AccountNumber) || account.Iban != FinanceRules.Clean(request.Iban);
        account.Name = name!;
        account.Kind = request.Kind!;
        account.BankName = FinanceRules.Clean(request.BankName);
        account.AccountNumber = FinanceRules.Clean(request.AccountNumber);
        account.Iban = FinanceRules.Clean(request.Iban);
        account.OpeningBalance = request.OpeningBalance!.Value;
        account.OpeningDate = openingDate;
        if (request.SortOrder is { } order) account.SortOrder = order;
        var after = new { account.Name, account.Kind, account.BankName, hasNumber = account.AccountNumber is not null, hasIban = account.Iban is not null, account.OpeningBalance, openingDate = FinanceRules.Format(account.OpeningDate), account.SortOrder };

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
