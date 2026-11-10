namespace HrPayroll.Api.Dtos;

/// <summary>Replace body for the company document settings. Images are uploaded separately and never appear here.</summary>
public sealed record DocumentSettingsRequest(
    string? CompanyName, string? CompanySubtitle, string? CompanyNameAr, string? Mobile, string? Address1, string? Address2,
    string? Email, string? Trn, string? BankName, string? AccountName, string? AccountNumber, string? Iban,
    string? DefaultPaymentTerms, string? DefaultInvoiceNotes, string? SignerName, string? SignerTitle);

public sealed record DocumentSettingsResponse(
    string CompanyName, string CompanySubtitle, string CompanyNameAr, string Mobile, string Address1, string Address2,
    string Email, string Trn, string BankName, string AccountName, string AccountNumber, string Iban,
    string DefaultPaymentTerms, string DefaultInvoiceNotes, int NextInvoiceNumber, string SignerName, string SignerTitle,
    bool HasLogo, bool HasSeal, bool HasSignature);

/// <summary>Body of an image upload: the picture as base64 (PNG or JPEG, at most 1 MB).</summary>
public sealed record DocumentImageRequest(string? ImageBase64);
