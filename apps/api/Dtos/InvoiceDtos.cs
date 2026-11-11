namespace HrPayroll.Api.Dtos;

/// <summary>Every member is nullable so a missing field reaches the validator and gets a field message.</summary>
public sealed record InvoiceLineRequest(string? Description, decimal? Quantity, decimal? Rate);

/// <summary>
/// Create/replace body for a draft. When <c>ClientId</c> is given the client's saved name, TRN and address are used;
/// otherwise <c>ClientName</c> (required) and the other client fields are taken as typed.
/// </summary>
public sealed record InvoiceRequest(
    int? ClientId, string? ClientName, string? ClientTrn, string? ClientAddress,
    DateOnly? InvoiceDate, DateOnly? DueDate, string? PaymentTerms,
    string? LpoRef, string? Project, string? Scope, string? Notes,
    List<InvoiceLineRequest>? Lines);

public sealed record CancelInvoiceRequest(string? Reason);

/// <summary>Body of issue. A blank <c>Number</c> takes the next automatic number; a typed one is used as it is.</summary>
public sealed record IssueInvoiceRequest(string? Number = null);

public sealed record InvoicePaymentRequest(DateOnly? PaidDate, decimal? Amount, string? Method, string? Reference);

public sealed record InvoiceLineResponse(int LineNo, string Description, decimal Quantity, decimal Rate, decimal Taxable, decimal Vat, decimal Amount);

public sealed record InvoicePaymentResponse(int Id, DateOnly PaidDate, decimal Amount, string Method, string Reference, string RecordedBy);

/// <summary>The company block printed on an invoice: live settings for a draft, the copy taken at issue for an issued invoice.</summary>
public sealed record InvoiceCompany(
    string CompanyName, string CompanySubtitle, string CompanyNameAr, string Mobile, string Address1, string Address2,
    string Email, string Trn, string BankName, string AccountName, string AccountNumber, string Iban, bool HasLogo);

public sealed record InvoiceResponse(
    int Id, string? Number, string Status, string DisplayStatus, bool IsOverdue,
    int? ClientId, string ClientName, string ClientTrn, string ClientAddress,
    DateOnly InvoiceDate, DateOnly DueDate, string PaymentTerms, string LpoRef, string Project, string Scope, string Notes,
    IReadOnlyList<InvoiceLineResponse> Lines, IReadOnlyList<InvoicePaymentResponse> Payments,
    decimal SubTotal, decimal VatTotal, decimal Total, decimal AmountPaid, decimal BalanceDue, string TotalInWords,
    InvoiceCompany Company, string CreatedBy, DateTime? IssuedUtc, string? IssuedBy, DateTime? CancelledUtc, string? CancelReason);

public sealed record InvoiceSummary(
    int Id, string? Number, string Status, string DisplayStatus, bool IsOverdue, string ClientName, string Project, string LpoRef,
    DateOnly InvoiceDate, DateOnly DueDate, decimal Total, decimal AmountPaid, decimal BalanceDue);

public sealed record InvoiceClientRequest(string? Name, string? Trn, string? Address, bool? IsActive);

public sealed record InvoiceClientResponse(int Id, string Name, string Trn, string Address, bool IsActive);
