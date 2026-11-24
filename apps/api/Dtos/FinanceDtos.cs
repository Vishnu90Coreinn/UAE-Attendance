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
