using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services.Finance;

// Receivables aging: the issued tax invoices still unpaid at a date, grouped by how late they are.
public sealed partial class FinanceLedgerService
{
    private static readonly string[] BucketNames = ["Not yet due", "1 to 30 days", "31 to 60 days", "61 to 90 days", "Over 90 days"];

    private static string BucketOf(int daysOverdue) => daysOverdue switch { <= 0 => BucketNames[0], <= 30 => BucketNames[1], <= 60 => BucketNames[2], <= 90 => BucketNames[3], _ => BucketNames[4] };

    public async Task<ReceivablesReport> ReceivablesAsync(string? asOf, CancellationToken ct)
    {
        await SyncAsync(ct);
        var date = FinanceRules.TryParseDate(asOf, out var d) ? d : FinanceRules.Today(time);
        var invoices = await db.Invoices.AsNoTracking().Include(i => i.Payments)
            .Where(i => i.Status == InvoiceStatuses.Issued && i.InvoiceDate <= date).ToListAsync(ct);
        var rows = invoices
            .Select(i => new { Invoice = i, Paid = i.Payments.Where(p => p.PaidDate <= date).Sum(p => p.Amount) })
            .Where(x => x.Invoice.Total - x.Paid > 0m)
            .Select(x =>
            {
                var late = Math.Max(0, date.DayNumber - x.Invoice.DueDate.DayNumber);
                return new ReceivableRow(x.Invoice.Id, x.Invoice.Number ?? "", x.Invoice.ClientName, FinanceRules.Format(x.Invoice.InvoiceDate), FinanceRules.Format(x.Invoice.DueDate),
                    x.Invoice.Total, x.Paid, x.Invoice.Total - x.Paid, late, BucketOf(late));
            })
            .OrderBy(r => r.Client, StringComparer.OrdinalIgnoreCase).ThenBy(r => r.InvoiceDate).ThenBy(r => r.Number, StringComparer.Ordinal).ToList();
        var buckets = BucketNames.Select(n => new ReceivableBucket(n, rows.Count(r => r.Bucket == n), rows.Where(r => r.Bucket == n).Sum(r => r.Balance))).ToList();
        var unrecorded = await db.InvoicePayments.CountAsync(p => p.FinEntryId == null && p.Invoice.Status == InvoiceStatuses.Issued, ct);
        return new(FinanceRules.Format(date), rows, buckets, rows.Sum(r => r.Balance), unrecorded);
    }
}

// Payables aging: the supplier bills still unpaid at a date, grouped by how late they are.
public sealed partial class FinanceLedgerService
{
    public async Task<PayablesReport> PayablesAsync(string? asOf, CancellationToken ct)
    {
        await SyncAsync(ct);
        var date = FinanceRules.TryParseDate(asOf, out var d) ? d : FinanceRules.Today(time);
        var bills = await db.FinBills.AsNoTracking().Where(b => b.Status == FinBillStatuses.Open && b.BillDate <= date).ToListAsync(ct);
        var ids = bills.Select(b => b.Id).ToList();
        var paidBy = (await db.FinEntries.AsNoTracking().Where(e => e.BillId != null && ids.Contains(e.BillId.Value) && e.Status == FinStatuses.Active && e.EntryDate <= date)
            .GroupBy(e => e.BillId!.Value).Select(g => new { Id = g.Key, Paid = g.Sum(e => e.Amount) }).ToListAsync(ct)).ToDictionary(x => x.Id, x => x.Paid);
        var rows = bills
            .Select(b => (Bill: b, Paid: paidBy.GetValueOrDefault(b.Id)))
            .Where(x => x.Bill.Total - x.Paid > 0m)
            .Select(x =>
            {
                var late = Math.Max(0, date.DayNumber - x.Bill.DueDate.DayNumber);
                return new PayableRow(x.Bill.Id, x.Bill.BillNo, x.Bill.SupplierName, x.Bill.SupplierRef, FinanceRules.Format(x.Bill.BillDate), FinanceRules.Format(x.Bill.DueDate), x.Bill.Total, x.Paid, x.Bill.Total - x.Paid, late, BucketOf(late));
            })
            .OrderBy(r => r.Supplier, StringComparer.OrdinalIgnoreCase).ThenBy(r => r.DueDate).ThenBy(r => r.BillNo, StringComparer.Ordinal).ToList();
        var buckets = BucketNames.Select(n => new ReceivableBucket(n, rows.Count(r => r.Bucket == n), rows.Where(r => r.Bucket == n).Sum(r => r.Balance))).ToList();
        return new(FinanceRules.Format(date), rows, buckets, rows.Sum(r => r.Balance));
    }
}
