using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services.Finance;

/// <summary>The VAT return figures for a period: what was charged on sales, what was paid on purchases, and the difference.</summary>
public sealed class FinanceVatService(AppDbContext db, TimeProvider time)
{
    public async Task<FinResult<FinVatReport>> BuildAsync(string? from, string? to, CancellationToken ct)
    {
        var today = FinanceRules.Today(time);
        var errors = new Dictionary<string, string[]>();
        var end = today;
        var start = new DateOnly(today.Year, today.Month, 1);
        if (!string.IsNullOrWhiteSpace(from) && !FinanceRules.TryParseDate(from, out start)) errors["from"] = ["Use the date form yyyy-MM-dd."];
        if (!string.IsNullOrWhiteSpace(to) && !FinanceRules.TryParseDate(to, out end)) errors["to"] = ["Use the date form yyyy-MM-dd."];
        if (errors.Count == 0)
        {
            if (end > today) errors["to"] = ["The report cannot end in the future."];
            else if (start > end) errors["to"] = ["The end date cannot be before the start date."];
            else if (end.DayNumber - start.DayNumber >= 1830) errors["from"] = ["A report covers at most 5 years."];
        }

        if (errors.Count > 0) return FinResult<FinVatReport>.Invalid(errors);

        var entries = await db.FinEntries.AsNoTracking()
            .Where(e => e.Status == FinStatuses.Active && e.InvoiceId == null && e.BillId == null && (e.Kind == FinEntryKinds.Expense || e.Kind == FinEntryKinds.Income) && e.EntryDate >= start && e.EntryDate <= end)
            .Select(e => new { e.Kind, e.TaxTypeId, e.Amount, e.TaxAmount }).ToListAsync(ct);
        var list = entries.Select(e => new { e.Kind, e.TaxTypeId, e.Amount, e.TaxAmount }).ToList();
        // Tax invoices carry their VAT from the day they are issued (the tax point), whether or not they have been paid. A payment on one adds nothing here.
        var standard = await db.FinTaxTypes.AsNoTracking().Where(t => t.Treatment == FinTaxTreatments.Standard).OrderBy(t => t.SortOrder).Select(t => (int?)t.Id).FirstOrDefaultAsync(ct);
        foreach (var i in await db.Invoices.AsNoTracking().Where(i => i.Status == InvoiceStatuses.Issued && i.InvoiceDate >= start && i.InvoiceDate <= end).Select(i => new { i.Total, i.VatTotal }).ToListAsync(ct))
            list.Add(new { Kind = FinEntryKinds.Income, TaxTypeId = i.VatTotal > 0m ? standard : null, Amount = i.Total, TaxAmount = i.VatTotal });
        // Supplier bills carry their VAT from the bill date, whether or not they have been paid. A payment on one adds nothing here.
        foreach (var b in await db.FinBills.AsNoTracking().Where(b => b.Status == FinBillStatuses.Open && b.BillDate >= start && b.BillDate <= end).Select(b => new { b.TaxTypeId, b.Total, b.TaxAmount }).ToListAsync(ct))
            list.Add(new { Kind = FinEntryKinds.Expense, b.TaxTypeId, Amount = b.Total, b.TaxAmount });
        entries = list;
        var types = await db.FinTaxTypes.AsNoTracking().OrderBy(t => t.SortOrder).ToListAsync(ct);

        List<FinVatRow> Rows(string kind) => types
            .Select(t =>
            {
                var mine = entries.Where(e => e.Kind == kind && e.TaxTypeId == t.Id).ToList();
                // Standard VAT sits inside the amount, so the net is the amount less the VAT. Every other type carries the amount as it is.
                var net = mine.Sum(e => t.Treatment == FinTaxTreatments.Standard ? e.Amount - e.TaxAmount : e.Amount);
                return new FinVatRow(t.Id, t.Name, t.Treatment, t.Rate, mine.Count, net, mine.Sum(e => e.TaxAmount));
            })
            .Where(r => r.Count > 0).ToList();

        FinVatUnrecorded Unrecorded(string kind) { var m = entries.Where(e => e.Kind == kind && e.TaxTypeId == null).ToList(); return new(m.Count, m.Sum(e => e.Amount)); }

        var sales = Rows(FinEntryKinds.Income);
        var purchases = Rows(FinEntryKinds.Expense);
        var reverse = purchases.Where(r => r.Treatment == FinTaxTreatments.ReverseCharge).Sum(r => r.Vat);
        var output = sales.Where(r => r.Treatment == FinTaxTreatments.Standard).Sum(r => r.Vat) + reverse;
        var input = purchases.Where(r => r.Treatment == FinTaxTreatments.Standard).Sum(r => r.Vat) + reverse;
        return FinResult<FinVatReport>.Ok(new(FinanceRules.Format(start), FinanceRules.Format(end), sales, purchases, output, input, output - input, Unrecorded(FinEntryKinds.Income), Unrecorded(FinEntryKinds.Expense)));
    }
}
