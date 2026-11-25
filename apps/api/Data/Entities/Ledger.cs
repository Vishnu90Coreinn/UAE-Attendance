namespace HrPayroll.Api.Data.Entities;

// Phase 4: the double-entry ledger. Journals are derived from the finance records and are never edited: a change is a reversing journal.

public static class LedgerTypes
{
    public const string Asset = "Asset";
    public const string Liability = "Liability";
    public const string Equity = "Equity";
    public const string Revenue = "Revenue";
    public const string Expense = "Expense";
    public static readonly string[] All = [Asset, Liability, Equity, Revenue, Expense];

    /// <summary>Assets and expenses grow with a debit; the others grow with a credit.</summary>
    public static bool DebitNormal(string type) => type is Asset or Expense;
}

public static class JournalSources
{
    public const string Entry = "Entry";
    public const string Transfer = "Transfer";

    /// <summary>An account's opening balance (SourceId is the account).</summary>
    public const string Opening = "Opening";

    /// <summary>A partner's opening capital (SourceId is the partner).</summary>
    public const string PartnerOpening = "PartnerOpen";
    public const string Manual = "Manual";

    /// <summary>A cheque issued or received: it moves money between the bank and "cheques payable" or "cheques receivable" until it clears.</summary>
    public const string Cheque = "Cheque";

    /// <summary>The closing journal of a financial year (SourceId is the year): income and expenses move to retained earnings.</summary>
    public const string YearEnd = "YearEnd";
}

/// <summary>One account in the chart of accounts. Never deleted, only switched off.</summary>
public sealed class LedgerAccount
{
    public int Id { get; set; }
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public string Type { get; set; } = LedgerTypes.Asset;
    public bool IsActive { get; set; } = true;

    /// <summary>True for the accounts the system needs (opening balance equity); they cannot be switched off.</summary>
    public bool IsSystem { get; set; }
    public DateTime CreatedUtc { get; set; }
}

/// <summary>
/// One balanced posting, made from a source record. <see cref="Part"/> is "Post" or "Reversal"; a reversal swaps every debit and credit of the
/// posting it undoes. A source can be posted again (a higher <see cref="Revision"/>) after an opening balance changes.
/// </summary>
public sealed class Journal
{
    public int Id { get; set; }

    /// <summary>JNL-000001.</summary>
    public string Number { get; set; } = "";
    public DateOnly Date { get; set; }
    public string SourceType { get; set; } = JournalSources.Entry;
    public int SourceId { get; set; }
    public int Revision { get; set; }
    public string Part { get; set; } = "Post";
    public string Description { get; set; } = "";
    public int? ReversesJournalId { get; set; }

    /// <summary>Who posted it by hand; null for the journals the system derives.</summary>
    public string? CreatedBy { get; set; }
    public DateTime CreatedUtc { get; set; }
    public List<JournalLine> Lines { get; set; } = [];
}

public sealed class JournalLine
{
    public int Id { get; set; }
    public int JournalId { get; set; }
    public Journal Journal { get; set; } = null!;
    public int LedgerAccountId { get; set; }
    public LedgerAccount LedgerAccount { get; set; } = null!;
    public decimal Debit { get; set; }
    public decimal Credit { get; set; }
    public string? Memo { get; set; }
}
