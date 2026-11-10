using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services;

public sealed record DocumentResult(int StatusCode, object? Body = null, Dictionary<string, string[]>? Errors = null, string? Message = null);

public sealed record DocumentImage(byte[] Data, string ContentType);

/// <summary>Company identity, bank details and artwork used on invoices and letters.</summary>
public sealed class DocumentSettingsService(AppDbContext db, IAuditLogger audit, TimeProvider time)
{
    public const int MaxImageBytes = 1024 * 1024;
    public static readonly string[] ImageKinds = ["logo", "seal", "signature"];

    private sealed record Field(string Key, int Max, bool Required, Func<DocumentSettingsRequest, string?> Read,
        Func<DocumentSettings, string> Get, Action<DocumentSettings, string> Set);

    private static readonly Field[] Fields =
    [
        new("companyName", 120, true, r => r.CompanyName, s => s.CompanyName, (s, v) => s.CompanyName = v),
        new("companySubtitle", 120, false, r => r.CompanySubtitle, s => s.CompanySubtitle, (s, v) => s.CompanySubtitle = v),
        new("companyNameAr", 160, false, r => r.CompanyNameAr, s => s.CompanyNameAr, (s, v) => s.CompanyNameAr = v),
        new("mobile", 30, false, r => r.Mobile, s => s.Mobile, (s, v) => s.Mobile = v),
        new("address1", 120, false, r => r.Address1, s => s.Address1, (s, v) => s.Address1 = v),
        new("address2", 120, false, r => r.Address2, s => s.Address2, (s, v) => s.Address2 = v),
        new("email", 120, false, r => r.Email, s => s.Email, (s, v) => s.Email = v),
        new("trn", 30, false, r => r.Trn, s => s.Trn, (s, v) => s.Trn = v),
        new("bankName", 80, false, r => r.BankName, s => s.BankName, (s, v) => s.BankName = v),
        new("accountName", 120, false, r => r.AccountName, s => s.AccountName, (s, v) => s.AccountName = v),
        new("accountNumber", 40, false, r => r.AccountNumber, s => s.AccountNumber, (s, v) => s.AccountNumber = v),
        new("iban", 40, false, r => r.Iban, s => s.Iban, (s, v) => s.Iban = v),
        new("defaultPaymentTerms", 40, false, r => r.DefaultPaymentTerms, s => s.DefaultPaymentTerms, (s, v) => s.DefaultPaymentTerms = v),
        new("defaultInvoiceNotes", 300, false, r => r.DefaultInvoiceNotes, s => s.DefaultInvoiceNotes, (s, v) => s.DefaultInvoiceNotes = v),
        new("signerName", 80, false, r => r.SignerName, s => s.SignerName, (s, v) => s.SignerName = v),
        new("signerTitle", 80, false, r => r.SignerTitle, s => s.SignerTitle, (s, v) => s.SignerTitle = v),
    ];

    public async Task<DocumentSettingsResponse> GetAsync(CancellationToken ct) => ToResponse(await Load(ct));

    public async Task<DocumentResult> UpdateAsync(DocumentSettingsRequest request, CancellationToken ct)
    {
        var errors = new Dictionary<string, string[]>();
        var values = new Dictionary<string, string>();
        foreach (var field in Fields)
        {
            var value = (field.Read(request) ?? "").Trim();
            if (field.Required && value.Length == 0) errors[field.Key] = ["This field is required."];
            else if (value.Length > field.Max) errors[field.Key] = [$"Must be {field.Max} characters or fewer."];
            else values[field.Key] = value;
        }
        if (values.TryGetValue("email", out var email) && email.Length > 0 && (!email.Contains('@') || email.Contains(' ')))
            errors["email"] = ["Enter a valid email address."];
        if (errors.Count > 0) return new(400, Errors: errors);

        var settings = await Load(ct, tracked: true);
        var changes = new Dictionary<string, FieldChange>();
        foreach (var field in Fields)
        {
            var old = field.Get(settings);
            if (old == values[field.Key]) continue;
            // Bank details are sensitive: the audit row records that they changed, not their values.
            var secret = field.Key is "accountNumber" or "iban";
            changes[field.Key] = secret ? new FieldChange("(changed)", "(changed)") : new FieldChange(old, values[field.Key]);
            field.Set(settings, values[field.Key]);
        }
        if (changes.Count > 0)
        {
            settings.UpdatedUtc = time.GetUtcNow().UtcDateTime;
            audit.Write("DocumentSettingsChanged", entityType: nameof(DocumentSettings), entityId: "1", details: changes);
            await db.SaveChangesAsync(ct);
        }
        return new(200, ToResponse(settings));
    }

    public async Task<DocumentResult> SetImageAsync(string kind, string? base64, CancellationToken ct)
    {
        if (!ImageKinds.Contains(kind)) return new(404);
        if (!TryDecode(base64, out var data, out var contentType))
            return new(400, Errors: new() { ["imageBase64"] = ["Choose a PNG or JPEG picture of 1 MB or less."] });
        var settings = await Load(ct, tracked: true);
        Apply(settings, kind, data, contentType);
        settings.UpdatedUtc = time.GetUtcNow().UtcDateTime;
        audit.Write("DocumentImageChanged", entityType: nameof(DocumentSettings), entityId: "1", details: new { kind, action = "set", bytes = data!.Length });
        await db.SaveChangesAsync(ct);
        return new(200, ToResponse(settings));
    }

    public async Task<DocumentResult> DeleteImageAsync(string kind, CancellationToken ct)
    {
        if (!ImageKinds.Contains(kind)) return new(404);
        var settings = await Load(ct, tracked: true);
        Apply(settings, kind, null, null);
        settings.UpdatedUtc = time.GetUtcNow().UtcDateTime;
        audit.Write("DocumentImageChanged", entityType: nameof(DocumentSettings), entityId: "1", details: new { kind, action = "removed" });
        await db.SaveChangesAsync(ct);
        return new(200, ToResponse(settings));
    }

    public async Task<DocumentImage?> GetImageAsync(string kind, CancellationToken ct)
    {
        if (!ImageKinds.Contains(kind)) return null;
        var s = await db.DocumentSettings.AsNoTracking().SingleAsync(x => x.Id == DocumentSettings.SingletonId, ct);
        var (data, type) = kind switch { "logo" => (s.Logo, s.LogoContentType), "seal" => (s.Seal, s.SealContentType), _ => (s.Signature, s.SignatureContentType) };
        return data is null || type is null ? null : new DocumentImage(data, type);
    }

    /// <summary>Accepts base64 of a PNG or JPEG up to 1 MB; the type is decided from the file's own first bytes.</summary>
    public static bool TryDecode(string? base64, out byte[]? data, out string? contentType)
    {
        data = null; contentType = null;
        if (string.IsNullOrEmpty(base64) || base64.Length > MaxImageBytes * 4 / 3 + 8) return false;
        var buffer = new byte[base64.Length * 3 / 4 + 3];
        if (!Convert.TryFromBase64String(base64, buffer, out var written) || written < 8 || written > MaxImageBytes) return false;
        if (buffer[0] == 0xFF && buffer[1] == 0xD8 && buffer[2] == 0xFF) contentType = "image/jpeg";
        else if (buffer[0] == 0x89 && buffer[1] == 0x50 && buffer[2] == 0x4E && buffer[3] == 0x47 && buffer[4] == 0x0D && buffer[5] == 0x0A && buffer[6] == 0x1A && buffer[7] == 0x0A) contentType = "image/png";
        else return false;
        data = buffer[..written];
        return true;
    }

    private static void Apply(DocumentSettings s, string kind, byte[]? data, string? type)
    {
        switch (kind)
        {
            case "logo": s.Logo = data; s.LogoContentType = type; break;
            case "seal": s.Seal = data; s.SealContentType = type; break;
            default: s.Signature = data; s.SignatureContentType = type; break;
        }
    }

    private async Task<DocumentSettings> Load(CancellationToken ct, bool tracked = false) =>
        await (tracked ? db.DocumentSettings : db.DocumentSettings.AsNoTracking()).SingleAsync(s => s.Id == DocumentSettings.SingletonId, ct);

    private static DocumentSettingsResponse ToResponse(DocumentSettings s) => new(
        s.CompanyName, s.CompanySubtitle, s.CompanyNameAr, s.Mobile, s.Address1, s.Address2, s.Email, s.Trn, s.BankName,
        s.AccountName, s.AccountNumber, s.Iban, s.DefaultPaymentTerms, s.DefaultInvoiceNotes, s.NextInvoiceNumber,
        s.SignerName, s.SignerTitle, s.Logo is not null, s.Seal is not null, s.Signature is not null);
}
