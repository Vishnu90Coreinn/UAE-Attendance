using System.Globalization;
using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services.Finance;

/// <summary>Finds a finance record by number, name, reference or exact amount: what an accountant does when someone rings about "EXP-000028" or "the 12,000 to MSK".</summary>
public sealed class FinanceSearchService(AppDbContext db)
{
    private const int PerType = 5;

    public async Task<FinSearchResult> SearchAsync(string? q, CancellationToken ct)
    {
        var text = (q ?? "").Trim();
        if (text.Length is < 2 or > 60) return new([]);
        var joined = text.Replace(" ", "");   // names are matched without their spaces, so "msk" finds "M S K Luxuries"
        // "12,000" and "12000.00" are the same amount. A value that is not a number simply matches no amount.
        decimal? amount = decimal.TryParse(text.Replace(",", ""), NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var v) && v > 0m ? v : null;

        var entries = await db.FinEntries.AsNoTracking()
            .Where(e => (e.Kind == FinEntryKinds.Expense || e.Kind == FinEntryKinds.Income)
                && (e.EntryNo.Contains(text) || e.Party.Replace(" ", "").Contains(joined) || (e.Reference != null && e.Reference.Contains(text)) || (e.Notes != null && e.Notes.Contains(text)) || (amount != null && e.Amount == amount)))
            .OrderByDescending(e => e.EntryDate).ThenByDescending(e => e.Id).Take(PerType * 2)
            .Select(e => new { e.Kind, e.Id, e.EntryNo, e.Party, e.EntryDate, e.Amount, e.Status }).ToListAsync(ct);
        var bills = await db.FinBills.AsNoTracking()
            .Where(b => b.BillNo.Contains(text) || b.SupplierName.Replace(" ", "").Contains(joined) || (b.SupplierRef != null && b.SupplierRef.Contains(text)) || (amount != null && b.Total == amount))
            .OrderByDescending(b => b.BillDate).ThenByDescending(b => b.Id).Take(PerType)
            .Select(b => new { b.Id, b.BillNo, b.SupplierName, b.BillDate, b.Total, b.Status }).ToListAsync(ct);
        var cheques = await db.FinCheques.AsNoTracking()
            .Where(c => c.Serial.Contains(text) || c.PartyName.Replace(" ", "").Contains(joined) || (amount != null && c.Amount == amount))
            .OrderByDescending(c => c.DueDate).ThenByDescending(c => c.Id).Take(PerType)
            .Select(c => new { c.Id, c.Serial, c.PartyName, c.DueDate, c.Amount, c.Status }).ToListAsync(ct);
        var invoices = await db.Invoices.AsNoTracking()
            .Where(i => i.Number != null && (i.Number.Contains(text) || i.ClientName.Replace(" ", "").Contains(joined) || (amount != null && i.Total == amount)))
            .OrderByDescending(i => i.InvoiceDate).ThenByDescending(i => i.Id).Take(PerType)
            .Select(i => new { i.Id, i.Number, i.ClientName, i.InvoiceDate, i.Total, i.Status }).ToListAsync(ct);

        var hits = new List<FinSearchHit>();
        hits.AddRange(entries.Select(e => new FinSearchHit(e.Kind, e.Id, e.EntryNo, e.Party, FinanceRules.Format(e.EntryDate), e.Amount, e.Status)));
        hits.AddRange(bills.Select(b => new FinSearchHit("Bill", b.Id, b.BillNo, b.SupplierName, FinanceRules.Format(b.BillDate), b.Total, b.Status)));
        hits.AddRange(cheques.Select(c => new FinSearchHit("Cheque", c.Id, c.Serial, c.PartyName, FinanceRules.Format(c.DueDate), c.Amount, c.Status)));
        hits.AddRange(invoices.Select(i => new FinSearchHit("Invoice", i.Id, i.Number!, i.ClientName, FinanceRules.Format(i.InvoiceDate), i.Total, i.Status)));
        return new(hits);
    }
}
