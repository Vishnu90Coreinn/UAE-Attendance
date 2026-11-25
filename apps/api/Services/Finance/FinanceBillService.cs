using System.Data;
using System.Globalization;
using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace HrPayroll.Api.Services.Finance;

/// <summary>
/// Supplier bills. Entering one books the cost (and VAT) and the debt to the supplier; paying it adds an expense entry from a bank or cash account that
/// clears the debt (not a second cost). A bill is voided, never deleted, and only while nothing has been paid on it.
/// </summary>
public sealed class FinanceBillService(AppDbContext db, FinanceLedgerService ledger, FinancePeriodService periods, IAuditLogger audit, IHttpContextAccessor http, TimeProvider time)
{
    public const string PaymentCategoryName = "Supplier bill payments";
    private const int MaxLines = 50;

    private DateOnly Today => FinanceRules.Today(time);

    // ---- reading ---------------------------------------------------------------------------------------------------

    private static string Display(FinBill b, decimal paid, DateOnly today) =>
        b.Status == FinBillStatuses.Voided ? "Voided" : paid >= b.Total ? "Paid" : b.DueDate < today ? "Overdue" : paid > 0m ? "PartPaid" : "Open";

    private async Task<List<FinBillResponse>> ToResponsesAsync(List<FinBill> bills, CancellationToken ct)
    {
        var ids = bills.Select(b => b.Id).ToList();
        var payments = await db.FinEntries.AsNoTracking().Include(e => e.Account)
            .Where(e => e.BillId != null && ids.Contains(e.BillId.Value) && e.Status == FinStatuses.Active).OrderBy(e => e.EntryDate).ThenBy(e => e.Id).ToListAsync(ct);
        var types = await db.FinTaxTypes.AsNoTracking().ToDictionaryAsync(t => t.Id, t => t.Name, ct);
        var today = Today;
        return bills.Select(b =>
        {
            var mine = payments.Where(p => p.BillId == b.Id).ToList();
            var paid = mine.Sum(p => p.Amount);
            return new FinBillResponse(b.Id, b.BillNo, b.SupplierName, b.PayeeId, b.SupplierRef, FinanceRules.Format(b.BillDate), FinanceRules.Format(b.DueDate), b.Notes, b.Status, Display(b, paid, today),
                b.TaxTypeId, b.TaxTypeId is { } t ? types.GetValueOrDefault(t) : null, b.TaxAmount, b.Net, b.Total, paid, b.Status == FinBillStatuses.Voided ? 0m : b.Total - paid,
                b.Lines.OrderBy(l => l.Id).Select(l => new FinBillLineResponse(l.CategoryId, l.Category.Name, l.Amount, l.Note)).ToList(),
                mine.Select(p => new FinBillPaymentResponse(p.Id, p.EntryNo, FinanceRules.Format(p.EntryDate), p.Amount, p.Account.Name, p.Reference)).ToList(), b.VoidReason, b.CreatedBy);
        }).ToList();
    }

    private IQueryable<FinBill> Query() => db.FinBills.AsNoTracking().Include(b => b.Lines).ThenInclude(l => l.Category);

    public async Task<List<FinBillResponse>> ListAsync(string? status, string? q, CancellationToken ct)
    {
        var query = Query();
        if (!string.IsNullOrWhiteSpace(q))
        {
            var text = q.Trim();
            query = query.Where(b => b.SupplierName.Contains(text) || b.BillNo.Contains(text) || (b.SupplierRef != null && b.SupplierRef.Contains(text)));
        }

        var all = await ToResponsesAsync(await query.OrderByDescending(b => b.BillDate).ThenByDescending(b => b.Id).Take(500).ToListAsync(ct), ct);
        return (status ?? "all").ToLowerInvariant() switch
        {
            "unpaid" => all.Where(b => b.Display is "Open" or "PartPaid" or "Overdue").ToList(),
            "overdue" => all.Where(b => b.Display == "Overdue").ToList(),
            "paid" => all.Where(b => b.Display == "Paid").ToList(),
            "voided" => all.Where(b => b.Display == "Voided").ToList(),
            _ => all,
        };
    }

    public async Task<FinResult<FinBillResponse>> GetAsync(int id, CancellationToken ct)
    {
        var bill = await Query().SingleOrDefaultAsync(b => b.Id == id, ct);
        return bill is null ? FinResult<FinBillResponse>.NotFound("The bill was not found.") : FinResult<FinBillResponse>.Ok((await ToResponsesAsync([bill], ct))[0]);
    }

    // ---- entering a bill -------------------------------------------------------------------------------------------

    public async Task<FinResult<FinBillResponse>> CreateAsync(FinBillRequest request, CancellationToken ct)
    {
        var errors = new Dictionary<string, string[]>();
        var supplier = FinanceRules.Clean(request.SupplierName);
        FinPayee? payee = null;
        if (request.PayeeId is { } payeeId)
        {
            payee = await db.FinPayees.AsNoTracking().SingleOrDefaultAsync(p => p.Id == payeeId, ct);
            if (payee is null || !payee.IsActive || payee.Kind != FinEntryKinds.Expense) errors["payeeId"] = ["Choose an active supplier from the list."];
            else supplier ??= payee.Name;
        }

        if (supplier is null) errors["supplierName"] = ["Enter the supplier."];
        else if (supplier.Length > 120) errors["supplierName"] = ["Use 120 characters or fewer."];
        var reference = FinanceRules.Clean(request.SupplierRef);
        if (reference?.Length > 60) errors["supplierRef"] = ["Use 60 characters or fewer."];
        var notes = FinanceRules.Clean(request.Notes);
        if (notes?.Length > 2000) errors["notes"] = ["Use 2000 characters or fewer."];

        DateOnly billDate = default, dueDate = default;
        if (!FinanceRules.TryParseDate(request.BillDate, out billDate)) errors["billDate"] = ["Enter the bill date."];
        else if (billDate > Today) errors["billDate"] = ["The bill date cannot be in the future."];
        if (!FinanceRules.TryParseDate(request.DueDate, out dueDate)) errors["dueDate"] = ["Enter the due date."];
        else if (!errors.ContainsKey("billDate") && dueDate < billDate) errors["dueDate"] = ["The due date cannot be before the bill date."];
        else if (dueDate > billDate.AddYears(2)) errors["dueDate"] = ["The due date is too far away."];

        var lines = request.Lines ?? [];
        var categories = new Dictionary<int, FinCategory>();
        if (lines.Count == 0) errors["lines"] = ["Add at least one line."];
        else if (lines.Count > MaxLines) errors["lines"] = [$"Use at most {MaxLines} lines."];
        else
        {
            var wanted = lines.Where(l => l.CategoryId is not null).Select(l => l.CategoryId!.Value).Distinct().ToList();
            categories = await db.FinCategories.AsNoTracking().Where(c => wanted.Contains(c.Id)).ToDictionaryAsync(c => c.Id, ct);
            foreach (var l in lines)
            {
                if (l.CategoryId is not { } c || !categories.TryGetValue(c, out var cat) || !cat.IsActive || cat.Kind != FinEntryKinds.Expense) { errors["lines"] = ["Every line needs an active expense category."]; break; }
                if (FinanceRules.AmountError(l.Amount) is { } lineError) { errors["lines"] = [lineError]; break; }
                if (FinanceRules.Clean(l.Note)?.Length > 200) { errors["lines"] = ["A line note takes 200 characters or fewer."]; break; }
            }
        }

        FinTaxType? tax = null;
        if (request.TaxTypeId is { } taxId and not 0)
        {
            tax = await db.FinTaxTypes.AsNoTracking().SingleOrDefaultAsync(t => t.Id == taxId, ct);
            if (tax is null || !tax.IsActive) errors["taxTypeId"] = ["Choose an active VAT type."];
        }

        decimal net = 0m, total = 0m, taxAmount = 0m;
        if (errors.Count == 0)
        {
            net = lines.Sum(l => l.Amount!.Value);
            (total, _, taxAmount) = tax is null ? (net, net, 0m) : FinanceCalculator.Vat(net, tax.Treatment, tax.Rate, inclusive: false);
            if (total > FinanceRules.MaxAmount) errors["lines"] = ["The total is too large."];
        }

        if (errors.Count > 0) return FinResult<FinBillResponse>.Invalid(errors);
        if (await periods.LockedMessageAsync(billDate, ct) is { } locked) return FinResult<FinBillResponse>.Conflict(locked);

        var bill = new FinBill
        {
            BillNo = "PENDING-" + Guid.NewGuid().ToString("N")[..10], SupplierName = supplier!, PayeeId = payee?.Id, SupplierRef = reference, BillDate = billDate, DueDate = dueDate, Notes = notes,
            TaxTypeId = tax?.Id, TaxRate = tax?.Rate ?? 0m, TaxAmount = taxAmount, Net = net, Total = total, CreatedBy = FinanceRules.Actor(http), CreatedUtc = DateTime.UtcNow,
        };
        foreach (var l in lines) bill.Lines.Add(new FinBillLine { CategoryId = l.CategoryId!.Value, Amount = l.Amount!.Value, Note = FinanceRules.Clean(l.Note) });
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        db.FinBills.Add(bill);
        await db.SaveChangesAsync(ct);
        bill.BillNo = "BILL-" + bill.Id.ToString("000000", CultureInfo.InvariantCulture);
        audit.Write("FinBillEntered", entityType: nameof(FinBill), entityId: bill.Id.ToString(), details: new { bill.BillNo, supplier, bill.Net, bill.TaxAmount, bill.Total });
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return FinResult<FinBillResponse>.Created((await GetAsync(bill.Id, ct)).Value!);
    }

    // ---- paying ----------------------------------------------------------------------------------------------------

    private async Task<FinCategory> PaymentCategoryAsync(CancellationToken ct)
    {
        var category = await db.FinCategories.SingleOrDefaultAsync(c => c.Kind == FinEntryKinds.Expense && c.Name == PaymentCategoryName, ct);
        if (category is not null) return category;
        category = new FinCategory { Kind = FinEntryKinds.Expense, Name = PaymentCategoryName, LedgerAccountId = await ledger.PayablesAccountIdAsync(ct) };   // posts to payables, so no empty expense account appears
        db.FinCategories.Add(category);
        await db.SaveChangesAsync(ct);
        return category;
    }

    public async Task<FinResult<FinBillResponse>> PayAsync(int id, FinBillPayRequest request, CancellationToken ct)
    {
        var errors = new Dictionary<string, string[]>();
        if (FinanceRules.AmountError(request.Amount) is { } amountError) errors["amount"] = [amountError];
        DateOnly date = default;
        if (!FinanceRules.TryParseDate(request.Date, out date)) errors["date"] = ["Enter the payment date."];
        else if (date > Today) errors["date"] = ["The payment date cannot be in the future."];
        var reference = FinanceRules.Clean(request.Reference);
        if (reference?.Length > 60) errors["reference"] = ["Use 60 characters or fewer."];
        FinAccount? account = null;
        if (request.AccountId is not { } accountId) errors["accountId"] = ["Choose the account the money is paid from."];
        else
        {
            account = await db.FinAccounts.SingleOrDefaultAsync(a => a.Id == accountId, ct);
            if (account is null || !account.IsActive) errors["accountId"] = ["Choose an active bank or cash account."];
            else if (errors.Count == 0 && date < account.OpeningDate) errors["date"] = [$"{account.Name} opens on {FinanceRules.Format(account.OpeningDate)}. The date cannot be earlier."];
        }

        if (errors.Count > 0) return FinResult<FinBillResponse>.Invalid(errors);
        if (await periods.LockedMessageAsync(date, ct) is { } locked) return FinResult<FinBillResponse>.Invalid("date", locked);

        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var bill = await db.FinBills.SingleOrDefaultAsync(b => b.Id == id, ct);
        if (bill is null) return FinResult<FinBillResponse>.NotFound("The bill was not found.");
        if (bill.Status != FinBillStatuses.Open) return FinResult<FinBillResponse>.Conflict($"{bill.BillNo} is voided, so it cannot be paid.");
        var paid = await db.FinEntries.Where(e => e.BillId == id && e.Status == FinStatuses.Active).SumAsync(e => (decimal?)e.Amount, ct) ?? 0m;
        var balance = bill.Total - paid;
        if (request.Amount > balance) return FinResult<FinBillResponse>.Invalid("amount", $"The payment is more than the balance owed ({balance.ToString("N2", CultureInfo.InvariantCulture)}).");

        var category = await PaymentCategoryAsync(ct);
        await using var command = db.Database.GetDbConnection().CreateCommand();
        command.Transaction = transaction.GetDbTransaction();
        command.CommandText = "SELECT NEXT VALUE FOR FinExpenseNo";
        var number = Convert.ToInt32(await command.ExecuteScalarAsync(ct), CultureInfo.InvariantCulture);
        var entry = new FinEntry
        {
            Kind = FinEntryKinds.Expense, EntryNo = "EXP-" + number.ToString("000000", CultureInfo.InvariantCulture), EntryDate = date, CategoryId = category.Id,
            Party = bill.SupplierName, PayeeId = bill.PayeeId, AccountId = account!.Id, Amount = request.Amount!.Value, Reference = reference ?? bill.SupplierRef, Notes = $"Payment for {bill.BillNo}",
            CreatedBy = FinanceRules.Actor(http), CreatedUtc = DateTime.UtcNow, BillId = bill.Id,
        };
        entry.Lines.Add(new FinEntryLine { CategoryId = category.Id, Amount = entry.Amount });
        db.FinEntries.Add(entry);
        audit.Write("FinBillPaid", entityType: nameof(FinBill), entityId: bill.Id.ToString(), details: new { bill.BillNo, entry.EntryNo, entry.Amount, account = account.Name });
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return FinResult<FinBillResponse>.Ok((await GetAsync(id, ct)).Value!);
    }

    /// <summary>Takes a payment back: voids its expense entry, so the bill is owed again. A payment made by a live cheque must have the cheque cancelled first.</summary>
    public async Task<FinResult<FinBillResponse>> RemovePaymentAsync(int id, int entryId, string? reason, CancellationToken ct)
    {
        var text = FinanceRules.Clean(reason);
        if (text is null) return FinResult<FinBillResponse>.Invalid("reason", "Enter the reason for taking the payment back.");
        if (text.Length > 300) return FinResult<FinBillResponse>.Invalid("reason", "Use 300 characters or fewer.");
        var entry = await db.FinEntries.SingleOrDefaultAsync(e => e.Id == entryId && e.BillId == id, ct);
        if (entry is null) return FinResult<FinBillResponse>.NotFound("The payment was not found.");
        if (entry.Status != FinStatuses.Active) return FinResult<FinBillResponse>.Conflict($"{entry.EntryNo} is already voided.");
        if (await periods.LockedMessageAsync(entry.EntryDate, ct) is { } locked) return FinResult<FinBillResponse>.Conflict(locked);
        var serial = await db.FinCheques.AsNoTracking().Where(c => c.EntryId == entryId && c.Status != FinChequeStatuses.Cancelled && c.Status != FinChequeStatuses.Bounced).Select(c => c.Serial).FirstOrDefaultAsync(ct);
        if (serial is not null) return FinResult<FinBillResponse>.Conflict($"{entry.EntryNo} is linked to cheque {serial}. Cancel the cheque first.");

        entry.Status = FinStatuses.Voided;
        entry.VoidReason = text;
        entry.VoidedBy = FinanceRules.Actor(http);
        entry.VoidedUtc = DateTime.UtcNow;
        audit.Write("FinExpenseVoided", entityType: nameof(FinEntry), entityId: entry.Id.ToString(), details: new { entry.EntryNo, entry.Amount, reason = text });
        await db.SaveChangesAsync(ct);
        return FinResult<FinBillResponse>.Ok((await GetAsync(id, ct)).Value!);
    }

    // ---- voiding ---------------------------------------------------------------------------------------------------

    public async Task<FinResult<FinBillResponse>> VoidAsync(int id, string? reason, CancellationToken ct)
    {
        var text = FinanceRules.Clean(reason);
        if (text is null) return FinResult<FinBillResponse>.Invalid("reason", "Enter the reason for voiding this bill.");
        if (text.Length > 300) return FinResult<FinBillResponse>.Invalid("reason", "Use 300 characters or fewer.");
        var bill = await db.FinBills.SingleOrDefaultAsync(b => b.Id == id, ct);
        if (bill is null) return FinResult<FinBillResponse>.NotFound("The bill was not found.");
        if (bill.Status != FinBillStatuses.Open) return FinResult<FinBillResponse>.Conflict($"{bill.BillNo} is already voided.");
        if (await db.FinEntries.AnyAsync(e => e.BillId == id && e.Status == FinStatuses.Active, ct)) return FinResult<FinBillResponse>.Conflict($"{bill.BillNo} has payments. Take them back before voiding it.");
        if (await periods.LockedMessageAsync(Today, ct) is { } locked) return FinResult<FinBillResponse>.Conflict(locked);   // the voiding is booked today

        bill.Status = FinBillStatuses.Voided;
        bill.VoidReason = text;
        bill.VoidedBy = FinanceRules.Actor(http);
        bill.VoidedUtc = DateTime.UtcNow;
        audit.Write("FinBillVoided", entityType: nameof(FinBill), entityId: bill.Id.ToString(), details: new { bill.BillNo, bill.Total, reason = text });
        await db.SaveChangesAsync(ct);
        return FinResult<FinBillResponse>.Ok((await GetAsync(id, ct)).Value!);
    }
}
