using System.Globalization;
using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace HrPayroll.Api.Services.Finance;

/// <summary>
/// Ties a payment on a tax invoice to the money: it adds an income entry in the chosen bank or cash account that clears the receivable
/// (not new revenue: the sale was booked when the invoice was issued), and voids that entry when the payment is removed.
/// It runs inside the invoice's own transaction and saves through the same context.
/// </summary>
public sealed class FinanceInvoiceBridge(AppDbContext db, FinanceLedgerService ledger, FinancePeriodService periods, IAuditLogger audit, IHttpContextAccessor http)
{
    public const string CategoryName = "Invoice payments";

    public sealed record Outcome(FinEntry? Entry, string? Field, string? Message);

    private async Task<FinCategory> CategoryAsync(CancellationToken ct)
    {
        var category = await db.FinCategories.SingleOrDefaultAsync(c => c.Kind == FinEntryKinds.Income && c.Name == CategoryName, ct);
        if (category is not null) return category;
        category = new FinCategory { Kind = FinEntryKinds.Income, Name = CategoryName, IsSystem = true, NoVat = true, LedgerAccountId = await ledger.ReceivablesAccountIdAsync(ct) };   // posts to receivables, so no empty revenue account appears
        db.FinCategories.Add(category);
        await db.SaveChangesAsync(ct);
        return category;
    }

    public async Task<Outcome> RecordAsync(Invoice invoice, DateOnly date, decimal amount, int accountId, string? reference, CancellationToken ct)
    {
        var account = await db.FinAccounts.SingleOrDefaultAsync(a => a.Id == accountId, ct);
        if (account is null || !account.IsActive) return new(null, "accountId", "Choose an active bank or cash account.");
        if (date < account.OpeningDate) return new(null, "paidDate", $"{account.Name} opens on {FinanceRules.Format(account.OpeningDate)}. The date cannot be earlier.");
        if (await periods.LockedMessageAsync(date, ct) is { } locked) return new(null, "paidDate", locked);

        var category = await CategoryAsync(ct);
        await using var command = db.Database.GetDbConnection().CreateCommand();
        command.Transaction = db.Database.CurrentTransaction?.GetDbTransaction();
        command.CommandText = "SELECT NEXT VALUE FOR FinIncomeNo";
        var number = Convert.ToInt32(await command.ExecuteScalarAsync(ct), CultureInfo.InvariantCulture);
        var party = invoice.ClientName.Length > 120 ? invoice.ClientName[..120] : invoice.ClientName;
        var entry = new FinEntry
        {
            Kind = FinEntryKinds.Income, EntryNo = "INC-" + number.ToString("000000", CultureInfo.InvariantCulture), EntryDate = date, CategoryId = category.Id, Party = party,
            AccountId = account.Id, Amount = amount, Reference = reference, Notes = $"Payment for {invoice.Number}", CreatedBy = FinanceRules.Actor(http), CreatedUtc = DateTime.UtcNow, InvoiceId = invoice.Id,
        };
        entry.Lines.Add(new FinEntryLine { CategoryId = category.Id, Amount = amount });
        db.FinEntries.Add(entry);
        await db.SaveChangesAsync(ct);
        return new(entry, null, null);
    }

    /// <summary>Voids the income entry of a removed payment. Returns the sentence to show when it cannot be (its month is locked).</summary>
    public async Task<string?> VoidAsync(int entryId, string invoiceNumber, CancellationToken ct)
    {
        var entry = await db.FinEntries.SingleOrDefaultAsync(e => e.Id == entryId, ct);
        if (entry is null || entry.Status != FinStatuses.Active) return null;
        if (await periods.LockedMessageAsync(entry.EntryDate, ct) is { } locked) return locked;
        entry.Status = FinStatuses.Voided;
        entry.VoidReason = $"Payment removed from {invoiceNumber}";
        entry.VoidedBy = FinanceRules.Actor(http);
        entry.VoidedUtc = DateTime.UtcNow;
        audit.Write("FinIncomeVoided", entityType: nameof(FinEntry), entityId: entry.Id.ToString(), details: new { entry.EntryNo, entry.Amount, reason = entry.VoidReason });
        return null;
    }
}
