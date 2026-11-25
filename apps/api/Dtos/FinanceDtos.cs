namespace HrPayroll.Api.Dtos;

// Expense and income tracking (Phase 3, stage 3). Dates travel as yyyy-MM-dd text; money is AED with 2 decimals.

public sealed record FinAccountResponse(
    int Id, string Name, string Kind, string? BankName, string? AccountNumber, string? Iban,
    decimal OpeningBalance, string OpeningDate, bool IsActive, int SortOrder, decimal Balance, int EntryCount);

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

public sealed record FinEntryResponse(
    int Id, string Kind, string EntryNo, string EntryDate, int CategoryId, string CategoryName, string Party, int AccountId, string AccountName,
    decimal Amount, string? Reference, string? Notes, string Status, string? VoidReason, string CreatedBy, DateTime CreatedUtc,
    IReadOnlyList<FinAttachmentResponse> Attachments,
    string? VoidedBy = null, DateTime? VoidedUtc = null, int? ReplacesEntryId = null, string? ReplacesEntryNo = null, string? ReplacedByEntryNo = null, int? PartnerId = null);

/// <summary>The filtered expenses, newest first, with their total. Voided rows are listed only when asked for and never counted in the total.</summary>
public sealed record FinEntryList(IReadOnlyList<FinEntryResponse> Items, decimal Total, int Count, bool Truncated);

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

public sealed record FinDashboardCategory(int? CategoryId, string Name, decimal Amount, int Share);

public sealed record FinDashboardEntry(int Id, string Kind, string EntryNo, string EntryDate, string CategoryName, string Party, string AccountName, decimal Amount);

/// <summary>Everything the finance overview shows, worked out by the server for one period ending today.</summary>
public sealed record FinDashboardResponse(
    int Days, string From, string To, decimal TotalBalance, IReadOnlyList<FinAccountResponse> Accounts,
    FinPeriodTotals Current, FinPeriodTotals Previous, string Granularity, IReadOnlyList<FinDashboardBucket> Buckets,
    IReadOnlyList<FinDashboardCategory> Spending, IReadOnlyList<FinDashboardEntry> Latest);

/// <summary>One account's statement for a period: where it started, what moved, where it ended.</summary>
public sealed record FinReportAccount(
    int AccountId, string Name, string Kind, bool IsActive, decimal Opening, decimal Income, decimal Expense, decimal TransfersIn, decimal TransfersOut, decimal Closing,
    decimal Capital = 0m);

public sealed record FinReportTotals(decimal Opening, decimal Income, decimal Expense, decimal TransfersIn, decimal TransfersOut, decimal Closing, decimal Capital = 0m);

/// <summary>A partner's capital over the period: at the start, added, returned, at the end, and the share of everyone's capital at the end.</summary>
public sealed record FinReportPartner(int PartnerId, string Name, decimal Opening, decimal Added, decimal Returned, decimal Closing, decimal Share);

public sealed record FinReportCategory(int CategoryId, string Name, decimal Amount, int Count, int Share);

public sealed record FinReportEntry(string Date, string EntryNo, string Kind, string Category, string Party, string Account, string? Reference, decimal Amount);

/// <summary>The period report. Identical figures go into the screen, the Excel file, the PDF and the CSV.</summary>
public sealed record FinReport(
    string From, string To, IReadOnlyList<FinReportAccount> Accounts, FinReportTotals Totals, FinPeriodTotals Period,
    IReadOnlyList<FinReportCategory> IncomeCategories, IReadOnlyList<FinReportCategory> ExpenseCategories, int EntryCount,
    IReadOnlyList<FinReportPartner>? Partners = null);

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
