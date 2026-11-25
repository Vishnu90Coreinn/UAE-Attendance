namespace HrPayroll.Api.Data.Entities;

// Phase 3, Stage 3 (QTN-HR-2026-005): expense and income tracking. Tracking only: no ledger, no VAT.

public static class FinAccountKinds
{
    public const string Bank = "Bank";
    public const string Cash = "Cash";

    /// <summary>Petty cash a staff member holds. Money moves into it with a transfer (the advance) and out of it by their approved expenses or a transfer back.</summary>
    public const string Custody = "Custody";
    public static readonly string[] All = [Bank, Cash, Custody];
}

public static class FinEntryKinds
{
    public const string Expense = "Expense";
    public const string Income = "Income";

    /// <summary>Capital a partner put into the company. Raises an account's balance; never income.</summary>
    public const string Capital = "Capital";

    /// <summary>Capital paid back to a partner. Lowers an account's balance; never an expense.</summary>
    public const string CapitalOut = "CapitalOut";

    /// <summary>The kinds with their own category list and screens.</summary>
    public static readonly string[] All = [Expense, Income];
    public static readonly string[] CapitalKinds = [Capital, CapitalOut];
    public static bool IsCapital(string kind) => kind is Capital or CapitalOut;
}

/// <summary>A partner of the company. Capital is tracked per partner; the partner's opening capital is what they put in before this app was used.</summary>
public sealed class FinPartner
{
    public int Id { get; set; }
    public string Name { get; set; } = "";

    /// <summary>Capital already put in before the first entry here; it is part of the accounts' opening balances, not an extra deposit.</summary>
    public decimal OpeningCapital { get; set; }

    /// <summary>The partner's capital account in the ledger.</summary>
    public int? LedgerAccountId { get; set; }
    public bool IsActive { get; set; } = true;
    public int SortOrder { get; set; }
    public DateTime CreatedUtc { get; set; }
    public DateTime UpdatedUtc { get; set; }
}


public static class FinStatuses
{
    public const string Active = "Active";
    public const string Voided = "Voided";

    /// <summary>An expense a staff member submitted that a Manager has not yet approved. Counts in no balance or report until approved.</summary>
    public const string Pending = "Pending";
}

/// <summary>A company bank or cash account. Never deleted, only switched off. Its balance is worked out, never stored.</summary>
public sealed class FinAccount
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Kind { get; set; } = FinAccountKinds.Bank;
    public string? BankName { get; set; }
    public string? AccountNumber { get; set; }
    public string? Iban { get; set; }
    public decimal OpeningBalance { get; set; }

    /// <summary>Staff allowed to submit expenses may choose this account as the one they paid from.</summary>
    public bool StaffCanUse { get; set; }

    /// <summary>For a Custody account: the staff login that holds the cash. Null for every other account.</summary>
    public int? HolderUserId { get; set; }

    /// <summary>The ledger account this account posts to. Made when first posted; the accountant may point it elsewhere.</summary>
    public int? LedgerAccountId { get; set; }

    /// <summary>The balance holds on this date; no entry or transfer may be dated before it.</summary>
    public DateOnly OpeningDate { get; set; }
    public bool IsActive { get; set; } = true;
    public int SortOrder { get; set; }
    public DateTime CreatedUtc { get; set; }
    public DateTime UpdatedUtc { get; set; }
}

/// <summary>An expense or income category, managed in Settings. Renamed or switched off, never deleted.</summary>
public sealed class FinCategory
{
    public int Id { get; set; }
    public string Kind { get; set; } = FinEntryKinds.Expense;
    public string Name { get; set; } = "";
    public bool IsActive { get; set; } = true;

    /// <summary>The VAT treatment offered first for this category (the accountant decides per category; for example government fees may carry none).</summary>
    public int? DefaultTaxTypeId { get; set; }

    /// <summary>True when this category never carries VAT (salaries, advances, some government fees): the entry form starts on "no VAT". With neither this nor a default VAT type, the form asks each time.</summary>
    public bool NoVat { get; set; }

    /// <summary>Made and used by the system (invoice payments, supplier bill payments). Never offered on entry forms and never picked by hand.</summary>
    public bool IsSystem { get; set; }

    /// <summary>The ledger account this category posts to (an expense or revenue account, unless the accountant chooses otherwise).</summary>
    public int? LedgerAccountId { get; set; }
}

/// <summary>
/// One expense or one income. An entry is never deleted: it is voided, or corrected by voiding it and adding a
/// replacement that points back at it through <see cref="ReplacesEntryId"/>.
/// </summary>
public sealed class FinEntry
{
    public int Id { get; set; }
    public string Kind { get; set; } = FinEntryKinds.Expense;

    /// <summary>EXP-000001 or INC-000001.</summary>
    public string EntryNo { get; set; } = "";
    public DateOnly EntryDate { get; set; }

    /// <summary>Set when this income is a payment received against a tax invoice: it clears the receivable instead of earning revenue.</summary>
    public int? InvoiceId { get; set; }

    /// <summary>Set when this expense pays a supplier bill: it clears what we owe instead of being a new cost (the cost was booked when the bill was entered).</summary>
    public int? BillId { get; set; }
    public int CategoryId { get; set; }
    public FinCategory Category { get; set; } = null!;

    /// <summary>Paid to (expense) or received from (income).</summary>
    public string Party { get; set; } = "";
    public int AccountId { get; set; }
    public FinAccount Account { get; set; } = null!;
    public decimal Amount { get; set; }

    /// <summary>Supplier invoice, cheque or licence number, or the income reference. Not unique.</summary>
    public string? Reference { get; set; }
    public string? Notes { get; set; }
    public string Status { get; set; } = FinStatuses.Active;
    public string? VoidReason { get; set; }
    public string? VoidedBy { get; set; }
    public DateTime? VoidedUtc { get; set; }
    public int? ReplacesEntryId { get; set; }

    /// <summary>The partner, for capital put in or paid back. Null for expenses and income.</summary>
    public int? PartnerId { get; set; }

    /// <summary>The saved payee picked for this entry, when one was. <see cref="Party"/> keeps the name as it was on the day.</summary>
    public int? PayeeId { get; set; }

    /// <summary>The VAT treatment chosen, or null when none was recorded (entries from before VAT, or a deliberate "no VAT").</summary>
    public int? TaxTypeId { get; set; }

    /// <summary>The rate that applied on the day, as a percentage.</summary>
    public decimal TaxRate { get; set; }

    /// <summary>The VAT on this entry. Inside <see cref="Amount"/> for a standard-rated entry; for reverse charge it is owed by the company and not part of the cash.</summary>
    public decimal TaxAmount { get; set; }

    /// <summary>Whether what was typed already contained the VAT (true) or the VAT was added on top (false).</summary>
    public bool TaxInclusive { get; set; } = true;

    /// <summary>How the amount divides between categories (expenses and income). One line for an ordinary entry; the lines add up to <see cref="Amount"/>.</summary>
    public List<FinEntryLine> Lines { get; set; } = [];
    public string CreatedBy { get; set; } = "";
    public DateTime CreatedUtc { get; set; }

    /// <summary>Set only by a one-off import (for example "Daftra" and its record id); makes a re-run add nothing twice.</summary>
    public string? ExternalSource { get; set; }
    public string? ExternalId { get; set; }
}

/// <summary>One category's part of an entry. <see cref="FinEntry.CategoryId"/> is the largest line's category.</summary>
public sealed class FinEntryLine
{
    public int Id { get; set; }
    public int EntryId { get; set; }
    public FinEntry Entry { get; set; } = null!;
    public int CategoryId { get; set; }
    public FinCategory Category { get; set; } = null!;
    public decimal Amount { get; set; }
    public string? Note { get; set; }
}

/// <summary>A person or company the business pays or is paid by, saved so it is picked, not retyped. Switched off, never deleted.</summary>
public sealed class FinPayee
{
    public int Id { get; set; }

    /// <summary>"Expense" (paid to) or "Income" (received from).</summary>
    public string Kind { get; set; } = FinEntryKinds.Expense;
    public string Name { get; set; } = "";

    /// <summary>Filled in on the entry form when this payee is picked.</summary>
    public int? DefaultCategoryId { get; set; }
    public string? Phone { get; set; }
    public string? TaxNumber { get; set; }
    public string? Notes { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedUtc { get; set; }
}

public static class FinChequeStatuses
{
    public const string Issued = "Issued";
    public const string Delivered = "Delivered";
    public const string Received = "Received";
    public const string Deposited = "Deposited";
    public const string Cleared = "Cleared";
    public const string Bounced = "Bounced";
    public const string Cancelled = "Cancelled";

    public static readonly string[] All = [Issued, Delivered, Received, Deposited, Cleared, Bounced, Cancelled];

    /// <summary>A cheque still waiting to turn into money (or not): it counts as a commitment (issued) or an expected receipt (received).</summary>
    public static bool IsOpen(string status) => status is Issued or Delivered or Received or Deposited;

    /// <summary>The statuses a cheque may move to next. Cleared, Bounced and Cancelled are final.</summary>
    public static string[] Next(string direction, string status) => (direction, status) switch
    {
        (FinChequeDirections.Issued, Issued) => [Delivered, Cancelled],
        (FinChequeDirections.Issued, Delivered) => [Cleared, Bounced, Cancelled],
        (FinChequeDirections.Received, Received) => [Deposited, Cancelled],
        (FinChequeDirections.Received, Deposited) => [Cleared, Bounced, Cancelled],
        _ => [],
    };
}

public static class FinChequeDirections
{
    /// <summary>A cheque the company wrote (payable).</summary>
    public const string Issued = "Issued";

    /// <summary>A cheque the company was given (receivable).</summary>
    public const string Received = "Received";
}

/// <summary>
/// A cheque the company wrote or was given. Tracking only: a cheque does not change an account balance (the expense or income it belongs to
/// does, and may be linked). Open cheques are shown as money already committed or expected. Never deleted, only cancelled.
/// </summary>
public sealed class FinCheque
{
    public int Id { get; set; }
    public string Direction { get; set; } = FinChequeDirections.Issued;
    public string Serial { get; set; } = "";
    public decimal Amount { get; set; }

    /// <summary>The name on the cheque: the payee of an issued cheque, the drawer of a received one.</summary>
    public string PartyName { get; set; } = "";
    public DateOnly IssueDate { get; set; }

    /// <summary>The date written on it; a post-dated cheque has a due date after its issue date.</summary>
    public DateOnly DueDate { get; set; }
    public int AccountId { get; set; }
    public FinAccount Account { get; set; } = null!;
    public string Status { get; set; } = FinChequeStatuses.Issued;
    public DateOnly? StatusDate { get; set; }
    public string? StatusNote { get; set; }

    /// <summary>The expense (issued) or income (received) this cheque paid, when linked.</summary>
    public int? EntryId { get; set; }
    public string? Notes { get; set; }
    public string CreatedBy { get; set; } = "";
    public DateTime CreatedUtc { get; set; }
    public DateTime UpdatedUtc { get; set; }
}

public static class FinTaxTreatments
{
    /// <summary>VAT is charged at the rate (5%); it is claimable on a purchase and owed on a sale.</summary>
    public const string Standard = "Standard";

    /// <summary>A taxable supply at 0%: reported, but no VAT.</summary>
    public const string ZeroRated = "ZeroRated";
    public const string Exempt = "Exempt";

    /// <summary>The supplier charges no VAT; the buyer accounts for it (owed and reclaimed in the same return).</summary>
    public const string ReverseCharge = "ReverseCharge";
    public const string IntraGcc = "IntraGcc";
    public static readonly string[] All = [Standard, ZeroRated, Exempt, ReverseCharge, IntraGcc];
}

/// <summary>A VAT treatment an entry can carry. The rate is copied onto each entry, so changing it later never rewrites the past.</summary>
public sealed class FinTaxType
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Treatment { get; set; } = FinTaxTreatments.Standard;
    public decimal Rate { get; set; }
    public bool IsActive { get; set; } = true;
    public int SortOrder { get; set; }
}

/// <summary>A receipt or supplier invoice kept with an entry. The file lives in the receipts folder; only its details are here.</summary>
public sealed class FinAttachment
{
    public int Id { get; set; }
    public int EntryId { get; set; }
    public FinEntry Entry { get; set; } = null!;
    public string FileName { get; set; } = "";
    public string ContentType { get; set; } = "";
    public long SizeBytes { get; set; }

    /// <summary>The random name the file has in the receipts folder.</summary>
    public string StoredName { get; set; } = "";
    public string Sha256 { get; set; } = "";
    public string UploadedBy { get; set; } = "";
    public DateTime UploadedUtc { get; set; }
}

/// <summary>
/// A month a Manager has locked: nothing dated in it can be added, changed or voided while it is locked. One row per month;
/// unlocking keeps the row and records who, when and why.
/// </summary>
public sealed class FinMonthLock
{
    public int Id { get; set; }
    public int Year { get; set; }
    public int Month { get; set; }
    public bool IsLocked { get; set; }
    public string LockedBy { get; set; } = "";
    public DateTime LockedUtc { get; set; }
    public string? UnlockedBy { get; set; }
    public DateTime? UnlockedUtc { get; set; }
    public string? UnlockReason { get; set; }
}

/// <summary>Money moved between two of the company's own accounts. Not an expense and not income.</summary>
public sealed class FinTransfer
{
    public int Id { get; set; }

    /// <summary>TRF-000001.</summary>
    public string TransferNo { get; set; } = "";
    public DateOnly TransferDate { get; set; }
    public int FromAccountId { get; set; }
    public FinAccount FromAccount { get; set; } = null!;
    public int ToAccountId { get; set; }
    public FinAccount ToAccount { get; set; } = null!;
    public decimal Amount { get; set; }
    public string? Reference { get; set; }
    public string? Notes { get; set; }
    public string Status { get; set; } = FinStatuses.Active;
    public string? VoidReason { get; set; }
    public string? VoidedBy { get; set; }
    public DateTime? VoidedUtc { get; set; }
    public int? ReplacesTransferId { get; set; }
    public string CreatedBy { get; set; } = "";
    public DateTime CreatedUtc { get; set; }
}

public static class FinBillStatuses
{
    public const string Open = "Open";
    public const string Voided = "Voided";
}

/// <summary>
/// A bill from a supplier that has not been paid yet. Entering it books the cost and any VAT and records that we owe the supplier; paying it (an expense entry
/// with <see cref="FinEntry.BillId"/>) clears the debt. Never deleted: voided, with a reason. It moves no bank balance until it is paid.
/// </summary>
public sealed class FinBill
{
    public int Id { get; set; }

    /// <summary>BILL-000001.</summary>
    public string BillNo { get; set; } = "";
    public string SupplierName { get; set; } = "";
    public int? PayeeId { get; set; }

    /// <summary>The supplier's own invoice number.</summary>
    public string? SupplierRef { get; set; }
    public DateOnly BillDate { get; set; }
    public DateOnly DueDate { get; set; }
    public string? Notes { get; set; }
    public string Status { get; set; } = FinBillStatuses.Open;

    /// <summary>The VAT type; null when no VAT is recorded.</summary>
    public int? TaxTypeId { get; set; }
    public decimal TaxRate { get; set; }
    public decimal TaxAmount { get; set; }

    /// <summary>Sum of the lines, before VAT.</summary>
    public decimal Net { get; set; }

    /// <summary>What the supplier is owed: the net plus standard VAT (reverse charge VAT is not owed to the supplier).</summary>
    public decimal Total { get; set; }
    public string? VoidReason { get; set; }
    public string? VoidedBy { get; set; }
    public DateTime? VoidedUtc { get; set; }
    public string CreatedBy { get; set; } = "";
    public DateTime CreatedUtc { get; set; }
    public List<FinBillLine> Lines { get; set; } = [];
}

/// <summary>The supplier's invoice (or a photo of it) kept with a bill. The file lives in the receipts folder; only its details are here.</summary>
public sealed class FinBillAttachment
{
    public int Id { get; set; }
    public int BillId { get; set; }
    public FinBill Bill { get; set; } = null!;
    public string FileName { get; set; } = "";
    public string ContentType { get; set; } = "";
    public long SizeBytes { get; set; }
    public string StoredName { get; set; } = "";
    public string Sha256 { get; set; } = "";
    public string UploadedBy { get; set; } = "";
    public DateTime UploadedUtc { get; set; }
}

public sealed class FinBillLine
{
    public int Id { get; set; }
    public int BillId { get; set; }
    public FinBill Bill { get; set; } = null!;
    public int CategoryId { get; set; }
    public FinCategory Category { get; set; } = null!;
    public decimal Amount { get; set; }
    public string? Note { get; set; }
}
