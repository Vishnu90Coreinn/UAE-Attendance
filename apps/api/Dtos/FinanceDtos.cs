namespace HrPayroll.Api.Dtos;

// Expense and income tracking (Phase 3, stage 3). Dates travel as yyyy-MM-dd text; money is AED with 2 decimals.

public sealed record FinAccountResponse(
    int Id, string Name, string Kind, string? BankName, string? AccountNumber, string? Iban,
    decimal OpeningBalance, string OpeningDate, bool IsActive, int SortOrder, decimal Balance, int EntryCount, bool StaffCanUse = false, int? HolderUserId = null, string? HolderName = null);

/// <summary>Missing fields are answered with field messages, so every property is nullable.</summary>
public sealed class FinAccountRequest
{
    public string? Name { get; init; }
    public string? Kind { get; init; }
    public string? BankName { get; init; }
    public string? AccountNumber { get; init; }
    public string? Iban { get; init; }
    public decimal? OpeningBalance { get; init; }
    public string? OpeningDate { get; init; }
    public int? SortOrder { get; init; }

    /// <summary>Whether staff allowed to submit expenses may pick this account.</summary>
    public bool? StaffCanUse { get; init; }

    /// <summary>For a Custody account: the office staff login that holds the cash.</summary>
    public int? HolderUserId { get; init; }
}

public sealed record FinCategoryResponse(int Id, string Kind, string Name, bool IsActive, int UseCount);

/// <summary>Create uses <c>Kind</c> and <c>Name</c>. Update uses <c>Name</c> and <c>IsActive</c>; the kind never changes.</summary>
public sealed class FinCategoryRequest
{
    public string? Kind { get; init; }
    public string? Name { get; init; }
    public bool? IsActive { get; init; }
}

public sealed record FinTransferResponse(
    int Id, string TransferNo, string TransferDate, int FromAccountId, string FromAccountName, int ToAccountId, string ToAccountName,
    decimal Amount, string? Reference, string? Notes, string Status, string? VoidReason, string CreatedBy, DateTime CreatedUtc);

public sealed class FinTransferRequest
{
    public string? TransferDate { get; init; }
    public int? FromAccountId { get; init; }
    public int? ToAccountId { get; init; }
    public decimal? Amount { get; init; }
    public string? Reference { get; init; }
    public string? Notes { get; init; }
}

public sealed record FinAttachmentResponse(int Id, string FileName, string ContentType, long SizeBytes);

/// <summary>One category's part of an entry. The lines of an entry add up to its amount.</summary>
public sealed record FinEntryLineResponse(int CategoryId, string CategoryName, decimal Amount, string? Note);

public sealed record FinPayeeResponse(
    int Id, string Kind, string Name, int? DefaultCategoryId, string? DefaultCategoryName, string? Phone, string? TaxNumber, string? Notes,
    bool IsActive, int EntryCount, decimal Total);

/// <summary>Create uses every field. Update changes the name, default category, contact details and <c>IsActive</c>; the kind never changes.</summary>
public sealed class FinPayeeRequest
{
    public string? Kind { get; init; }
    public string? Name { get; init; }
    public int? DefaultCategoryId { get; init; }
    public string? Phone { get; init; }
    public string? TaxNumber { get; init; }
    public string? Notes { get; init; }
    public bool? IsActive { get; init; }
}

public sealed record FinEntryResponse(
    int Id, string Kind, string EntryNo, string EntryDate, int CategoryId, string CategoryName, string Party, int AccountId, string AccountName,
    decimal Amount, string? Reference, string? Notes, string Status, string? VoidReason, string CreatedBy, DateTime CreatedUtc,
    IReadOnlyList<FinAttachmentResponse> Attachments,
    string? VoidedBy = null, DateTime? VoidedUtc = null, int? ReplacesEntryId = null, string? ReplacesEntryNo = null, string? ReplacedByEntryNo = null, int? PartnerId = null,
    int? PayeeId = null, IReadOnlyList<FinEntryLineResponse>? Lines = null);

/// <summary>The filtered expenses, newest first, with their total. Voided rows are listed only when asked for and never counted in the total.</summary>
public sealed record FinEntryList(IReadOnlyList<FinEntryResponse> Items, decimal Total, int Count, bool Truncated, int PendingCount = 0, decimal PendingTotal = 0m);

/// <summary>Multipart form: the fields plus the receipt files.</summary>
public sealed class FinExpenseForm
{
    public string? EntryDate { get; init; }
    public int? CategoryId { get; init; }
    public string? Party { get; init; }
    public int? AccountId { get; init; }
    public decimal? Amount { get; init; }
    public string? Reference { get; init; }
    public string? Notes { get; init; }

    /// <summary>Capital only: the partner who put the money in or took it back.</summary>
    public int? PartnerId { get; init; }

    /// <summary>The saved payee picked for this entry, if any.</summary>
    public int? PayeeId { get; init; }

    /// <summary>Optional JSON list <c>[{"categoryId":1,"amount":2000,"note":"Deposit"}]</c>: splits the amount between categories. Without it the entry has one line, <see cref="CategoryId"/>.</summary>
    public string? LinesJson { get; init; }
    public IFormFileCollection? Files { get; init; }

    /// <summary>When correcting: the receipts of the original entry to keep. Others are left behind with the voided original.</summary>
    public List<int>? KeepAttachmentIds { get; init; }
}

public sealed record FinMonthLockResponse(string Month, bool IsLocked, string? LockedBy, DateTime? LockedUtc, string? UnlockedBy, DateTime? UnlockedUtc, string? UnlockReason);

public sealed class FinVoidRequest
{
    public string? Reason { get; init; }
}

/// <summary>Income and expense over a stretch of days, plus the net. Transfers and voided rows are left out.</summary>
public sealed record FinPeriodTotals(decimal Income, decimal Expense, decimal Net);

public sealed record FinDashboardBucket(string Start, string Label, decimal Income, decimal Expense);

/// <summary>Share is a percentage with one decimal; the shares of the list add up to exactly 100.0.</summary>
public sealed record FinDashboardCategory(int? CategoryId, string Name, decimal Amount, decimal Share);

public sealed record FinDashboardPartner(int Id, string Name, decimal NetCapital, decimal Share);

/// <summary>The partners' capital as it stands today, so the money in the accounts can be told apart from the money partners put in.</summary>
public sealed record FinDashboardCapital(decimal Total, IReadOnlyList<FinDashboardPartner> Partners);

public sealed record FinDashboardEntry(int Id, string Kind, string EntryNo, string EntryDate, string CategoryName, string Party, string AccountName, decimal Amount);

/// <summary>Everything the finance overview shows, worked out by the server for one period ending today.</summary>
public sealed record FinDashboardResponse(
    int Days, string From, string To, decimal TotalBalance, IReadOnlyList<FinAccountResponse> Accounts,
    FinPeriodTotals Current, FinPeriodTotals Previous, string Granularity, IReadOnlyList<FinDashboardBucket> Buckets,
    IReadOnlyList<FinDashboardCategory> Spending, IReadOnlyList<FinDashboardEntry> Latest, FinDashboardCapital? Capital = null);

/// <summary>One account's statement for a period: where it started, what moved, where it ended.</summary>
public sealed record FinReportAccount(
    int AccountId, string Name, string Kind, bool IsActive, decimal Opening, decimal Income, decimal Expense, decimal TransfersIn, decimal TransfersOut, decimal Closing,
    decimal Capital = 0m);

public sealed record FinReportTotals(decimal Opening, decimal Income, decimal Expense, decimal TransfersIn, decimal TransfersOut, decimal Closing, decimal Capital = 0m);

/// <summary>A partner's capital over the period: at the start, added, returned, at the end, and the share of everyone's capital at the end.</summary>
public sealed record FinReportPartner(int PartnerId, string Name, decimal Opening, decimal Added, decimal Returned, decimal Closing, decimal Share);

/// <summary>Share is a percentage with one decimal; the shares of the list add up to exactly 100.0.</summary>
public sealed record FinReportCategory(int CategoryId, string Name, decimal Amount, int Count, decimal Share);

public sealed record FinReportEntry(string Date, string EntryNo, string Kind, string Category, string Party, string Account, string? Reference, decimal Amount);

/// <summary>One calendar month inside the report period: what was recorded in it, and whether it has been locked (checked and closed).</summary>
public sealed record FinReportMonth(string Month, int Entries, decimal Income, decimal Expense, decimal Net, decimal Capital, bool IsLocked, string? LockedBy, DateTime? LockedUtc);

/// <summary>Who money was paid to or received from over the period. Share is a percentage with one decimal; the shares of the list add up to exactly 100.0.</summary>
public sealed record FinReportPayee(string Name, decimal Amount, int Count, decimal Share);

/// <summary>What each person entered over the period: how many entries, and the income and expenses among them.</summary>
public sealed record FinReportEnteredBy(string Name, int Entries, decimal Income, decimal Expense);

/// <summary>
/// Where the money came from and went, for the period. <c>Operating</c> = income less expenses; <c>Financing</c> = capital put in less capital paid back.
/// <c>Other</c> is whatever else moved the total (normally zero; an account that opened inside the period adds its opening balance). <c>NetChange</c> = <c>Closing</c> less <c>Opening</c>.
/// </summary>
public sealed record FinCashFlow(
    decimal Opening, decimal Income, decimal Expense, decimal Operating, decimal CapitalIn, decimal CapitalOut, decimal Financing, decimal Other, decimal NetChange, decimal Closing);

/// <summary>The period report. Identical figures go into the screen, the Excel file, the PDF and the CSV.</summary>
public sealed record FinReport(
    string From, string To, IReadOnlyList<FinReportAccount> Accounts, FinReportTotals Totals, FinPeriodTotals Period,
    IReadOnlyList<FinReportCategory> IncomeCategories, IReadOnlyList<FinReportCategory> ExpenseCategories, int EntryCount,
    IReadOnlyList<FinReportPartner>? Partners = null, IReadOnlyList<FinReportMonth>? Months = null,
    IReadOnlyList<FinReportPayee>? ExpensePayees = null, IReadOnlyList<FinReportPayee>? IncomePayees = null,
    IReadOnlyList<FinReportEnteredBy>? EnteredBy = null, FinCashFlow? CashFlow = null, string Granularity = "month");

/// <summary>
/// A partner and the capital figures worked out for them. <c>NetCapital</c> = opening capital + capital added - capital returned,
/// and <c>Share</c> is that as a percentage of every partner's net capital (two decimals, all shares add up to 100.00).
/// </summary>
public sealed record FinPartnerResponse(
    int Id, string Name, decimal OpeningCapital, bool IsActive, int SortOrder, decimal Added, decimal Returned, decimal NetCapital, decimal Share,
    int MovementCount, string? LastMovementDate);

public sealed record FinPartnersResponse(IReadOnlyList<FinPartnerResponse> Partners, decimal TotalCapital);

/// <summary>Missing fields are answered with field messages, so every property is nullable.</summary>
public sealed class FinPartnerRequest
{
    public string? Name { get; init; }
    public decimal? OpeningCapital { get; init; }
    public bool? IsActive { get; init; }
    public int? SortOrder { get; init; }
}

/// <summary>A cheque with the account it is drawn on, what it is linked to and the statuses it may move to next.</summary>
public sealed record FinChequeResponse(
    int Id, string Direction, string Serial, decimal Amount, string PartyName, string IssueDate, string DueDate, int AccountId, string AccountName,
    string Status, string? StatusDate, string? StatusNote, int? EntryId, string? EntryNo, string? Notes, bool IsOpen, bool IsPostDated, bool IsOverdue,
    IReadOnlyList<string> NextStatuses, string CreatedBy, DateTime CreatedUtc);

/// <summary>Open cheques are money already committed (issued) or expected (received). Totals cover every match, not just the rows shown.</summary>
public sealed record FinChequeList(IReadOnlyList<FinChequeResponse> Items, int Count, decimal OpenIssued, decimal OpenReceived, bool Truncated);

/// <summary>What the overview shows: open issued cheques due soon and overdue, and the later post-dated ones.</summary>
public sealed record FinChequeSummary(
    int Days, decimal DueSoonIssued, int DueSoonIssuedCount, decimal DueSoonReceived, int DueSoonReceivedCount,
    int OverdueCount, decimal OverdueAmount, decimal LaterIssued, int LaterIssuedCount, IReadOnlyList<FinChequeResponse> Next);

/// <summary>Missing fields are answered with field messages, so every property is nullable.</summary>
public sealed class FinChequeRequest
{
    public string? Direction { get; init; }
    public string? Serial { get; init; }
    public decimal? Amount { get; init; }
    public string? PartyName { get; init; }
    public string? IssueDate { get; init; }
    public string? DueDate { get; init; }
    public int? AccountId { get; init; }
    public int? EntryId { get; init; }
    public string? Notes { get; init; }
}

public sealed class FinChequeStatusRequest
{
    public string? Status { get; init; }

    /// <summary>The day it happened (delivered, cleared, bounced). Defaults to today.</summary>
    public string? Date { get; init; }
    public string? Note { get; init; }
}

/// <summary>Office staff and whether a Manager has allowed them to submit expenses for approval.</summary>
public sealed record FinSubmitterResponse(int UserId, string Username, string Role, bool CanSubmit);

public sealed class FinSubmitterRequest
{
    public bool? CanSubmit { get; init; }
}

/// <summary>What a staff member may pick when submitting: the accounts they may pay from, the expense categories and the saved payees.</summary>
public sealed record FinMyOptions(IReadOnlyList<FinAccountResponse> Accounts, IReadOnlyList<FinCategoryResponse> Categories, IReadOnlyList<FinPayeeResponse> Payees);

/// <summary>One row of an uploaded Excel file, as read and checked. Status is Ready, Duplicate (already recorded, skipped) or Error.</summary>
public sealed record FinImportRow(
    int Row, string? Date, string? Party, string? Category, string? Account, decimal? Amount, string? Reference, string? Notes, string Status, IReadOnlyList<string> Problems);

/// <summary>The checked file. Nothing is saved until the import is confirmed; <c>Imported</c> is 0 for a preview.</summary>
public sealed record FinImportResult(IReadOnlyList<FinImportRow> Rows, int Ready, int Duplicates, int Errors, decimal ReadyTotal, int Imported);

// ---- Ledger (Phase 4) -----------------------------------------------------------------------------------------

public sealed record LedgerAccountResponse(int Id, string Code, string Name, string Type, bool IsActive, bool IsSystem, decimal Debit, decimal Credit, decimal Balance);

/// <summary>Balance is positive in the account's normal direction (a debit for assets and expenses, a credit for the rest).</summary>
public sealed record LedgerTrialBalance(string AsOf, IReadOnlyList<LedgerAccountResponse> Accounts, decimal TotalDebit, decimal TotalCredit, bool Balanced);

public sealed record LedgerLineResponse(string Date, string JournalNumber, string Description, string? Memo, decimal Debit, decimal Credit, decimal Balance, string Part);

public sealed record LedgerAccountStatement(LedgerAccountResponse Account, string From, string To, decimal Opening, IReadOnlyList<LedgerLineResponse> Lines, decimal Closing);

public sealed record JournalLineResponse(string AccountCode, string AccountName, decimal Debit, decimal Credit, string? Memo);

public sealed record JournalResponse(int Id, string Number, string Date, string SourceType, int SourceId, string Part, string Description, IReadOnlyList<JournalLineResponse> Lines);

public sealed record JournalList(IReadOnlyList<JournalResponse> Items, int Count, bool Truncated);

/// <summary>One of the safety checks: what the ledger says, what the finance screens say, and whether they agree.</summary>
public sealed record LedgerCheck(string Name, string Subject, decimal Ledger, decimal Screens, bool Agrees);

public sealed record LedgerCheckResult(bool AllAgree, IReadOnlyList<LedgerCheck> Checks, int Journals, decimal TotalDebit, decimal TotalCredit);

public sealed record LedgerSyncResult(int Posted, int Reversed);
