namespace HrPayroll.Api.Dtos;

/// <summary>
/// The body of both "preview" and "issue". Every member is nullable so a missing field reaches the validator and is answered
/// with a field message. Blank <c>AddressedTo</c>, <c>PurposeNote</c>, <c>SignerName</c> and <c>SignerTitle</c> fall back to
/// defaults; the bank fields are used only when the worker has no value of their own.
/// </summary>
public sealed record LetterRequest(
    int? WorkerId, string? LetterType, DateOnly? IssueDate, string? AddressedTo, string? Salutation,
    string? PurposeNote, string? SignerName, string? SignerTitle, bool? ShowSeal,
    string? BankName = null, string? BankAccountNumber = null, string? Iban = null);

/// <summary>A piece of text in a paragraph; <c>Bold</c> runs carry the values that were filled in.</summary>
public sealed record LetterRun(string Text, bool Bold);

public sealed record LetterSalaryTable(decimal Basic, decimal Housing, decimal Transport, decimal Other, decimal Total);

/// <summary>
/// Everything printed on a letter. It is stored as JSON when the letter is issued, so a past letter is re-opened exactly as it
/// was issued and never recomputed from the live worker or settings.
/// </summary>
public sealed record LetterContent(
    string LetterType, string Title, DateOnly IssueDate, string RefNo, string AddressedTo,
    string CompanyName, string Address1, string Address2, string Mobile, string Email,
    string WorkerName, string WorkerCode, string Designation,
    List<List<LetterRun>> Paragraphs, LetterSalaryTable? Salary,
    string PurposeNote, string SignerName, string SignerTitle, bool ShowSeal);

/// <summary>What the preview and the issued letter return. The images themselves are fetched from the images endpoint.</summary>
public sealed record LetterDocument(LetterContent Content, bool HasLogo, bool HasSeal, bool HasSignature);

public sealed record LetterSummary(
    int Id, string RefNo, string LetterType, int WorkerId, string WorkerName, string WorkerCode,
    DateOnly IssueDate, string AddressedTo, string IssuedBy, DateTime IssuedUtc);

/// <summary>A supervisor asking for a certificate. Members are nullable so a missing field gets a field message.</summary>
public sealed record CertificateRequestCreate(int? WorkerId, string? LetterType, string? Reason);

/// <summary>A manager's reason for sending a request back to HR.</summary>
public sealed record CertificateRejectRequest(string? Reason);

public sealed record CertificateRequestResponse(
    int Id, int WorkerId, string WorkerName, string WorkerCode, string LetterType, string Reason, string Status,
    string RequestedBy, DateTime RequestedUtc, string? PreparedBy, DateTime? PreparedUtc, string? ReviewedBy,
    DateTime? ReviewedUtc, string ReviewNote, bool HasDetails, int? LetterId, string? RefNo);

/// <summary>The request with the HR-entered details and the letter built from them (null until HR has saved details).</summary>
public sealed record CertificateRequestDetail(CertificateRequestResponse Request, LetterRequest? Details, LetterDocument? Document);

public sealed record LetterRecord(
    int Id, string RefNo, string LetterType, int WorkerId, DateOnly IssueDate, string IssuedBy, DateTime IssuedUtc,
    LetterDocument Document);
