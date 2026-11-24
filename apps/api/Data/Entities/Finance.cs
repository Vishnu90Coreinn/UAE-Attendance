namespace HrPayroll.Api.Data.Entities;

// Phase 3, Stage 3 (QTN-HR-2026-005): expense and income tracking. Tracking only: no ledger, no VAT.

public static class FinAccountKinds
{
    public const string Bank = "Bank";
    public const string Cash = "Cash";
    public static readonly string[] All = [Bank, Cash];
}

public static class FinEntryKinds
{
    public const string Expense = "Expense";
    public const string Income = "Income";
    public static readonly string[] All = [Expense, Income];
}

public static class FinStatuses
{
    public const string Active = "Active";
    public const string Voided = "Voided";
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
    public string CreatedBy { get; set; } = "";
    public DateTime CreatedUtc { get; set; }

    /// <summary>Set only by a one-off import (for example "Daftra" and its record id); makes a re-run add nothing twice.</summary>
    public string? ExternalSource { get; set; }
    public string? ExternalId { get; set; }
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
