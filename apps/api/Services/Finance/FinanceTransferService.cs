using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services.Finance;

/// <summary>Money moved between two of the company's own accounts. Not an expense and not income.</summary>
public sealed class FinanceTransferService(AppDbContext db, IAuditLogger audit, IHttpContextAccessor http, TimeProvider time)
{
    private static FinTransferResponse ToResponse(FinTransfer t) => new(
        t.Id, t.TransferNo, FinanceRules.Format(t.TransferDate), t.FromAccountId, t.FromAccount.Name, t.ToAccountId, t.ToAccount.Name,
        t.Amount, t.Reference, t.Notes, t.Status, t.VoidReason, t.CreatedBy, t.CreatedUtc);

    public async Task<List<FinTransferResponse>> ListAsync(string? from, string? to, int? accountId, bool includeVoided, CancellationToken ct)
    {
        var query = db.FinTransfers.AsNoTracking().Include(t => t.FromAccount).Include(t => t.ToAccount).AsQueryable();
        if (FinanceRules.TryParseDate(from, out var fromDate)) query = query.Where(t => t.TransferDate >= fromDate);
        if (FinanceRules.TryParseDate(to, out var toDate)) query = query.Where(t => t.TransferDate <= toDate);
        if (accountId is { } id) query = query.Where(t => t.FromAccountId == id || t.ToAccountId == id);
        if (!includeVoided) query = query.Where(t => t.Status == FinStatuses.Active);
        var rows = await query.OrderByDescending(t => t.TransferDate).ThenByDescending(t => t.Id).ToListAsync(ct);
        return rows.Select(ToResponse).ToList();
    }

    public async Task<FinResult<FinTransferResponse>> CreateAsync(FinTransferRequest request, CancellationToken ct)
    {
        var errors = new Dictionary<string, string[]>();
        if (FinanceRules.AmountError(request.Amount) is { } amountError) errors["amount"] = [amountError];
        if (request.FromAccountId is null) errors["fromAccountId"] = ["Choose the account the money leaves."];
        if (request.ToAccountId is null) errors["toAccountId"] = ["Choose the account the money goes to."];
        else if (request.FromAccountId == request.ToAccountId) errors["toAccountId"] = ["Choose two different accounts."];
        if (FinanceRules.Clean(request.Reference)?.Length > 60) errors["reference"] = ["Use 60 characters or fewer."];
        if (FinanceRules.Clean(request.Notes)?.Length > 2000) errors["notes"] = ["Use 2,000 characters or fewer."];

        DateOnly date = default;
        if (!FinanceRules.TryParseDate(request.TransferDate, out date)) errors["transferDate"] = ["Enter the transfer date."];
        else if (date > FinanceRules.Today(time)) errors["transferDate"] = ["The date cannot be in the future."];

        FinAccount? from = null, to = null;
        if (request.FromAccountId is { } fromId && !errors.ContainsKey("fromAccountId"))
        {
            from = await db.FinAccounts.SingleOrDefaultAsync(a => a.Id == fromId, ct);
            if (from is null || !from.IsActive) errors["fromAccountId"] = ["Choose an active account."];
        }

        if (request.ToAccountId is { } toId && !errors.ContainsKey("toAccountId"))
        {
            to = await db.FinAccounts.SingleOrDefaultAsync(a => a.Id == toId, ct);
            if (to is null || !to.IsActive) errors["toAccountId"] = ["Choose an active account."];
        }

        if (!errors.ContainsKey("transferDate"))
        {
            var latestOpening = new[] { from?.OpeningDate, to?.OpeningDate }.Where(d => d is not null).Max();
            if (latestOpening is { } opening && date < opening)
                errors["transferDate"] = [$"An account opens on {FinanceRules.Format(opening)}. The date cannot be earlier."];
        }

        if (errors.Count > 0) return FinResult<FinTransferResponse>.Invalid(errors);

        var transfer = new FinTransfer
        {
            TransferNo = "TMP-" + Guid.NewGuid().ToString("N")[..16], TransferDate = date, FromAccountId = from!.Id, ToAccountId = to!.Id,
            Amount = request.Amount!.Value, Reference = FinanceRules.Clean(request.Reference), Notes = FinanceRules.Clean(request.Notes),
            CreatedBy = FinanceRules.Actor(http), CreatedUtc = DateTime.UtcNow,
        };
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        db.FinTransfers.Add(transfer);
        await db.SaveChangesAsync(ct);
        transfer.TransferNo = "TRF-" + transfer.Id.ToString("000000");
        audit.Write("FinTransferCreated", entityType: nameof(FinTransfer), entityId: transfer.Id.ToString(),
            details: new { transfer.TransferNo, from = from.Name, to = to.Name, transfer.Amount, date = FinanceRules.Format(date) });
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);

        transfer.FromAccount = from;
        transfer.ToAccount = to;
        return FinResult<FinTransferResponse>.Created(ToResponse(transfer));
    }
}
