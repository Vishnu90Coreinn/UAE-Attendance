namespace HrPayroll.Api.Data.Entities;

// Phase 2 (QTN-HR-2026-003): tax invoices, HR certificates and letters, and the daily site progress (WIR) report.

/// <summary>
/// Company identity, bank details and artwork used on invoices and letters. Exactly one row (<c>Id = 1</c>), seeded by a
/// migration and edited by a Manager or the Administrator.
/// </summary>
public sealed class DocumentSettings
{
    public const int SingletonId = 1;

    public int Id { get; set; }
    public string CompanyName { get; set; } = "";
    public string CompanySubtitle { get; set; } = "";
    public string CompanyNameAr { get; set; } = "";
    public string Mobile { get; set; } = "";
    public string Address1 { get; set; } = "";
    public string Address2 { get; set; } = "";
    public string Email { get; set; } = "";
    public string Trn { get; set; } = "";
    public string BankName { get; set; } = "";
    public string AccountName { get; set; } = "";
    public string AccountNumber { get; set; } = "";
    public string Iban { get; set; } = "";
    public string DefaultPaymentTerms { get; set; } = "";
    public string DefaultInvoiceNotes { get; set; } = "";

    /// <summary>The number the next issued invoice receives (shown as INV-000185). Only ever increases.</summary>
    public int NextInvoiceNumber { get; set; }

    /// <summary>Default signatory printed on letters.</summary>
    public string SignerName { get; set; } = "";
    public string SignerTitle { get; set; } = "";

    /// <summary>Optional artwork (PNG or JPEG, at most 1 MB each). Null means "not uploaded".</summary>
    public byte[]? Logo { get; set; }
    public string? LogoContentType { get; set; }
    public byte[]? Seal { get; set; }
    public string? SealContentType { get; set; }
    public byte[]? Signature { get; set; }
    public string? SignatureContentType { get; set; }
    public DateTime UpdatedUtc { get; set; }
}

public static class InvoiceStatuses
{
    public const string Draft = "Draft";
    public const string Issued = "Issued";
    public const string Cancelled = "Cancelled";
    public static readonly string[] All = [Draft, Issued, Cancelled];
}

/// <summary>A customer that invoices are addressed to.</summary>
public sealed class InvoiceClient
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Trn { get; set; } = "";
    public string Address { get; set; } = "";
    public bool IsActive { get; set; } = true;
}

/// <summary>
/// A tax invoice. A draft has no number; issuing assigns the next sequential number (UAE VAT invoices must not have gaps) and
/// locks the invoice. The client and company details are copied onto the invoice so a later change never alters an issued one.
/// Paid / part-paid / overdue are worked out from <see cref="Payments"/>, not stored.
/// </summary>
public sealed class Invoice
{
    public int Id { get; set; }

    /// <summary>"INV-000185"; null while the invoice is a draft.</summary>
    public string? Number { get; set; }
    public string Status { get; set; } = InvoiceStatuses.Draft;
    public int? ClientId { get; set; }
    public InvoiceClient? Client { get; set; }
    public string ClientName { get; set; } = "";
    public string ClientTrn { get; set; } = "";
    public string ClientAddress { get; set; } = "";
    public DateOnly InvoiceDate { get; set; }
    public DateOnly DueDate { get; set; }
    public string PaymentTerms { get; set; } = "";
    public string LpoRef { get; set; } = "";
    public string Project { get; set; } = "";
    public string Scope { get; set; } = "";
    public string Notes { get; set; } = "";
    public decimal SubTotal { get; set; }
    public decimal VatTotal { get; set; }
    public decimal Total { get; set; }

    /// <summary>JSON copy of the company details and bank details at the moment of issue; null for a draft.</summary>
    public string? CompanyJson { get; set; }
    public string CreatedBy { get; set; } = "";
    public DateTime CreatedUtc { get; set; }
    public DateTime UpdatedUtc { get; set; }
    public DateTime? IssuedUtc { get; set; }
    public string? IssuedBy { get; set; }
    public DateTime? CancelledUtc { get; set; }
    public string? CancelReason { get; set; }

    public List<InvoiceLine> Lines { get; set; } = [];
    public List<InvoicePayment> Payments { get; set; } = [];
}

public sealed class InvoiceLine
{
    public int Id { get; set; }
    public int InvoiceId { get; set; }
    public Invoice Invoice { get; set; } = null!;
    public int LineNo { get; set; }
    public string Description { get; set; } = "";
    public decimal Quantity { get; set; }
    public decimal Rate { get; set; }
    public decimal Taxable { get; set; }
    public decimal Vat { get; set; }
    public decimal Amount { get; set; }
}

public sealed class InvoicePayment
{
    public int Id { get; set; }
    public int InvoiceId { get; set; }
    public Invoice Invoice { get; set; } = null!;
    public DateOnly PaidDate { get; set; }
    public decimal Amount { get; set; }
    public string Method { get; set; } = "";
    public string Reference { get; set; } = "";
    public string RecordedBy { get; set; } = "";
    public DateTime RecordedUtc { get; set; }
}

public static class LetterTypes
{
    public const string Salary = "Salary";
    public const string Service = "Service";
    public const string BankTransfer = "BankTransfer";
    public const string Noc = "Noc";
    public static readonly string[] All = [Salary, Service, BankTransfer, Noc];
}

/// <summary>
/// One certificate or letter that was issued. <see cref="ContentJson"/> holds every value printed on it (worker details,
/// salary breakdown, bank details, text), so a letter can be re-opened exactly as issued even after the worker changes.
/// </summary>
public sealed class IssuedLetter
{
    public int Id { get; set; }

    /// <summary>"DEAKS/HR/2026/0001".</summary>
    public string RefNo { get; set; } = "";
    public int Year { get; set; }
    public int Sequence { get; set; }
    public string LetterType { get; set; } = "";
    public int WorkerId { get; set; }
    public Worker Worker { get; set; } = null!;
    public DateOnly IssueDate { get; set; }
    public string AddressedTo { get; set; } = "";
    public string ContentJson { get; set; } = "";
    public string IssuedBy { get; set; } = "";
    public DateTime IssuedUtc { get; set; }
}

public static class CertificateStatuses
{
    /// <summary>Raised by a supervisor; HR has not sent it for approval yet.</summary>
    public const string Requested = "Requested";
    public const string PendingApproval = "PendingApproval";
    /// <summary>The manager sent it back to HR with a reason.</summary>
    public const string Returned = "Returned";
    public const string Approved = "Approved";
    public static readonly string[] All = [Requested, PendingApproval, Returned, Approved];
}

/// <summary>
/// A certificate or letter asked for by a supervisor. HR fills in and updates the details (<see cref="DetailsJson"/>) and
/// sends it to a manager; only when the manager approves is the letter issued (<see cref="IssuedLetterId"/>) and numbered.
/// </summary>
public sealed class CertificateRequest
{
    public int Id { get; set; }
    public int WorkerId { get; set; }
    public Worker Worker { get; set; } = null!;
    public string LetterType { get; set; } = "";

    /// <summary>The supervisor's note: what the certificate is for.</summary>
    public string Reason { get; set; } = "";
    public string Status { get; set; } = CertificateStatuses.Requested;
    public string RequestedBy { get; set; } = "";
    public DateTime RequestedUtc { get; set; }

    /// <summary>The HR-entered letter details as JSON (the same shape as a letter preview request); null until HR saves them.</summary>
    public string? DetailsJson { get; set; }
    public string? PreparedBy { get; set; }
    public DateTime? PreparedUtc { get; set; }
    public string? ReviewedBy { get; set; }
    public DateTime? ReviewedUtc { get; set; }

    /// <summary>Why the manager sent it back.</summary>
    public string ReviewNote { get; set; } = "";
    public int? IssuedLetterId { get; set; }
    public IssuedLetter? IssuedLetter { get; set; }
}

public static class Completion
{
    public const string NotStarted = "NotStarted";
    public const string InProgress = "InProgress";
    public const string Completed = "Completed";
    public static readonly string[] All = [NotStarted, InProgress, Completed];
}

public static class WirStatuses
{
    public const string Pending = "Pending";
    public const string Submitted = "Submitted";
    public const string Approved = "Approved";
    public const string ApprovedWithComments = "ApprovedWithComments";
    public const string Rejected = "Rejected";
    public const string AlignmentNotComplete = "AlignmentNotComplete";
    public const string AlignmentUnderProcess = "AlignmentUnderProcess";
    public const string AlignmentComplete = "AlignmentComplete";
    public static readonly string[] All =
        [Pending, Submitted, AlignmentNotComplete, AlignmentUnderProcess, AlignmentComplete, Approved, ApprovedWithComments, Rejected];
}

/// <summary>How far the alignment of a floor's installed work has got, tracked apart from the WIR.</summary>
public static class AlignmentStatuses
{
    public const string NotComplete = "NotComplete";
    public const string UnderProcess = "UnderProcess";
    public const string Complete = "Complete";
    public static readonly string[] All = [NotComplete, UnderProcess, Complete];
}

/// <summary>A construction project or site whose installation progress is tracked.</summary>
public sealed class SiteProject
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public bool IsActive { get; set; } = true;
}

/// <summary>The progress of one project on one date. A project has at most one report per date.</summary>
public sealed class SiteProgressReport
{
    public int Id { get; set; }
    public int ProjectId { get; set; }
    public SiteProject Project { get; set; } = null!;
    public DateOnly ReportDate { get; set; }
    public string UpdatedBy { get; set; } = "";
    public DateTime UpdatedUtc { get; set; }
    public List<SiteProgressFloor> Floors { get; set; } = [];
}

public sealed class SiteProgressFloor
{
    public int Id { get; set; }
    public int ReportId { get; set; }
    public SiteProgressReport Report { get; set; } = null!;
    public int SortOrder { get; set; }
    public string Floor { get; set; } = "";
    public int Frames { get; set; }
    public int Glass { get; set; }
    public int Shutters { get; set; }
    public string Alignment { get; set; } = AlignmentStatuses.NotComplete;
    public string Completion { get; set; } = Entities.Completion.NotStarted;
    public string WirStatus { get; set; } = WirStatuses.Pending;
    public string Remarks { get; set; } = "";
    /// <summary>A Manager or the Administrator locks a floor to freeze it: supervisors cannot change or remove it until it is unlocked.</summary>
    public bool IsLocked { get; set; }
}
