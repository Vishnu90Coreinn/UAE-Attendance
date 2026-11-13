using System.Globalization;
using System.Text.Json;
using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace HrPayroll.Api.Services;

public sealed record LetterResult(int StatusCode, object? Body = null, Dictionary<string, string[]>? Errors = null, string? Message = null);

/// <summary>
/// HR certificates and letters. Previewing builds the letter from the live worker and company settings and saves nothing.
/// Issuing assigns the next reference of the year and stores every printed value, so a letter is later re-opened and
/// re-printed exactly as issued. Issued letters cannot be changed or deleted.
/// </summary>
public sealed class LetterService(AppDbContext db, IAuditLogger audit, TimeProvider time, IHttpContextAccessor httpContext)
{
    public const int MaxAddresseeLength = 200;
    public const int MaxPurposeLength = 500;
    public const int MaxSignerLength = 80;
    public const int MaxBankFieldLength = 80;
    public const int MaxListed = 500;

    private const string Missing = "---";
    private const int UniqueIndexViolation = 2601;
    private const int UniqueConstraintViolation = 2627;
    private const int Deadlock = 1205;
    private static readonly string[] Salutations = ["Mr.", "Ms.", "Mrs.", "Eng."];
    private static readonly TimeZoneInfo CompanyTimeZone = TimeZoneInfo.FindSystemTimeZoneById("Asia/Dubai");
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    // --- preview and issue ---------------------------------------------------------------------------------

    public async Task<LetterResult> PreviewAsync(LetterRequest request, CancellationToken ct)
    {
        var built = await BuildAsync(request, ct);
        return built.Errors is not null ? new(400, Errors: built.Errors) : new(200, Document(built.Content!, built.Settings!));
    }

    /// <summary>
    /// Issues the letter. When <paramref name="fulfilling"/> is a certificate request id, that request is marked Approved in
    /// the same transaction, so a letter is never numbered without its request being closed (and the other way round).
    /// </summary>
    public async Task<LetterResult> IssueAsync(LetterRequest request, CancellationToken ct, int? fulfilling = null)
    {
        var actor = httpContext.HttpContext?.User.Identity?.Name ?? "";
        for (var attempt = 0; attempt < 5; attempt++)
        {
            db.ChangeTracker.Clear();
            var built = await BuildAsync(request, ct);
            if (built.Errors is not null) return new(400, Errors: built.Errors);

            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            try
            {
                var year = built.Content!.IssueDate.Year;
                // One issuer per year at a time: the next number is read and used under this lock, so numbers never repeat or skip.
                if (!await LockYearAsync(year, ct)) continue;
                // Read the request only now that this issuer holds the lock, so two approvals cannot both see "pending".
                CertificateRequest? certificate = null;
                if (fulfilling is { } requestId)
                {
                    certificate = await db.CertificateRequests.SingleOrDefaultAsync(r => r.Id == requestId, ct);
                    if (certificate is null) return new(404);
                    if (certificate.Status != CertificateStatuses.PendingApproval)
                        return new(409, Message: "This request is no longer waiting for approval.");
                }
                var sequence = (await db.IssuedLetters.Where(l => l.Year == year).MaxAsync(l => (int?)l.Sequence, ct) ?? 0) + 1;
                var refNo = $"DEAKS/HR/{year}/{sequence.ToString("0000", CultureInfo.InvariantCulture)}";
                var content = built.Content with { RefNo = refNo };
                var letter = new IssuedLetter
                {
                    RefNo = refNo, Year = year, Sequence = sequence, LetterType = content.LetterType, WorkerId = request.WorkerId!.Value,
                    IssueDate = content.IssueDate, AddressedTo = content.AddressedTo, ContentJson = JsonSerializer.Serialize(content, Json),
                    IssuedBy = actor, IssuedUtc = time.GetUtcNow().UtcDateTime,
                };
                db.IssuedLetters.Add(letter);
                if (certificate is not null)
                {
                    certificate.Status = CertificateStatuses.Approved;
                    certificate.IssuedLetter = letter;
                    certificate.ReviewedBy = actor;
                    certificate.ReviewedUtc = time.GetUtcNow().UtcDateTime;
                    certificate.ReviewNote = "";
                    audit.Write("CertificateApproved", entityType: nameof(CertificateRequest), entityId: certificate.Id.ToString(CultureInfo.InvariantCulture),
                        details: new { refNo, letterType = content.LetterType, workerId = letter.WorkerId });
                }
                audit.Write("LetterIssued", entityType: nameof(IssuedLetter), entityId: refNo,
                    details: new { refNo, letterType = content.LetterType, workerId = letter.WorkerId });
                await db.SaveChangesAsync(ct);
                await transaction.CommitAsync(ct);
                return new(201, Record(letter, content, built.Settings!));
            }
            catch (DbUpdateException ex) when (ex.InnerException is SqlException { Number: UniqueIndexViolation or UniqueConstraintViolation or Deadlock })
            {
                // Another letter took the number first; try again with the next one.
            }
            catch (SqlException ex) when (ex.Number == Deadlock)
            {
                // Chosen as the deadlock victim by a concurrent issue; try again.
            }
        }
        return new(409, Message: "Several letters were issued at the same moment. Try again.");
    }

    private async Task<bool> LockYearAsync(int year, CancellationToken ct)
    {
        await using var command = db.Database.GetDbConnection().CreateCommand();
        command.Transaction = db.Database.CurrentTransaction!.GetDbTransaction();
        command.CommandText = "DECLARE @result int; EXEC @result = sys.sp_getapplock @Resource = @resource, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 10000; SELECT @result;";
        command.Parameters.Add(new SqlParameter("@resource", "IssuedLetters:" + year.ToString(CultureInfo.InvariantCulture)));
        return Convert.ToInt32(await command.ExecuteScalarAsync(ct), CultureInfo.InvariantCulture) >= 0;
    }

    // --- reads ----------------------------------------------------------------------------------------------

    public async Task<IReadOnlyList<LetterSummary>> ListAsync(string? search, string? type, DateOnly? from, DateOnly? to, CancellationToken ct)
    {
        var query = db.IssuedLetters.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(type)) query = query.Where(l => l.LetterType == type);
        if (from is { } f) query = query.Where(l => l.IssueDate >= f);
        if (to is { } t) query = query.Where(l => l.IssueDate <= t);
        var term = (search ?? "").Trim();
        if (term.Length > 0)
            query = query.Where(l => l.RefNo.Contains(term) || l.Worker.FullName.Contains(term) || l.Worker.WorkerCode.Contains(term) || l.AddressedTo.Contains(term));
        return await query.OrderByDescending(l => l.IssuedUtc).ThenByDescending(l => l.Id).Take(MaxListed)
            .Select(l => new LetterSummary(l.Id, l.RefNo, l.LetterType, l.WorkerId, l.Worker.FullName, l.Worker.WorkerCode,
                l.IssueDate, l.AddressedTo, l.IssuedBy, l.IssuedUtc))
            .ToListAsync(ct);
    }

    public async Task<LetterResult> GetAsync(int id, CancellationToken ct)
    {
        var letter = await db.IssuedLetters.AsNoTracking().SingleOrDefaultAsync(l => l.Id == id, ct);
        if (letter is null) return new(404);
        return new(200, Record(letter, Read(letter), await SettingsAsync(ct)));
    }

    /// <summary>The stored content of an issued letter plus the current artwork, for the PDF.</summary>
    public async Task<(LetterContent Content, DocumentSettings Settings, string RefNo)?> LoadForPdfAsync(int id, CancellationToken ct)
    {
        var letter = await db.IssuedLetters.AsNoTracking().SingleOrDefaultAsync(l => l.Id == id, ct);
        return letter is null ? null : (Read(letter), await SettingsAsync(ct), letter.RefNo);
    }

    /// <summary>One of the uploaded images ("logo", "seal" or "signature"), or null when it was not uploaded.</summary>
    public async Task<(byte[] Data, string ContentType)?> GetImageAsync(string kind, CancellationToken ct)
    {
        var s = await SettingsAsync(ct);
        var (data, type) = kind switch
        {
            "logo" => (s.Logo, s.LogoContentType),
            "seal" => (s.Seal, s.SealContentType),
            "signature" => (s.Signature, s.SignatureContentType),
            _ => (null, null),
        };
        return data is { Length: > 0 } && type is not null ? (data, type) : null;
    }

    // --- building a letter ----------------------------------------------------------------------------------

    private sealed record Built(LetterContent? Content, DocumentSettings? Settings, Dictionary<string, string[]>? Errors);

    private Task<DocumentSettings> SettingsAsync(CancellationToken ct) =>
        db.DocumentSettings.AsNoTracking().SingleAsync(s => s.Id == DocumentSettings.SingletonId, ct);

    private async Task<Built> BuildAsync(LetterRequest request, CancellationToken ct)
    {
        var errors = new Dictionary<string, string[]>();
        void Fail(string key, string message) => errors[key] = [message];

        var type = (request.LetterType ?? "").Trim();
        if (!LetterTypes.All.Contains(type)) Fail("letterType", "Choose the type of letter.");

        Worker? worker = null;
        if (request.WorkerId is null or <= 0) Fail("workerId", "Choose a worker.");
        else
        {
            worker = await db.Workers.AsNoTracking().SingleOrDefaultAsync(w => w.Id == request.WorkerId, ct);
            if (worker is null) Fail("workerId", "Choose a worker.");
        }

        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(time.GetUtcNow(), CompanyTimeZone).DateTime);
        var issueDate = request.IssueDate ?? today;
        if (issueDate > today) Fail("issueDate", "The issue date cannot be in the future.");

        var salutation = string.IsNullOrWhiteSpace(request.Salutation) ? "Mr." : request.Salutation.Trim();
        if (!Salutations.Contains(salutation)) Fail("salutation", "Choose Mr., Ms., Mrs. or Eng.");

        var settings = await SettingsAsync(ct);
        var company = (settings.CompanyName.Trim() + " " + settings.CompanySubtitle.Trim()).Trim();

        var addressee = Text(request.AddressedTo);
        if (addressee.Length == 0) addressee = "To Whom It May Concern";
        if (addressee.Length > MaxAddresseeLength) Fail("addressedTo", $"The addressee must be {MaxAddresseeLength} characters or fewer.");

        var purpose = Text(request.PurposeNote);
        if (purpose.Length == 0)
            purpose = $"This certificate is issued upon the request of the employee without any financial or legal liability on {company}.";
        if (purpose.Length > MaxPurposeLength) Fail("purposeNote", $"The purpose note must be {MaxPurposeLength} characters or fewer.");

        var signerName = Text(request.SignerName);
        if (signerName.Length == 0) signerName = settings.SignerName.Trim();
        if (signerName.Length == 0) Fail("signerName", "Enter the signatory name.");
        else if (signerName.Length > MaxSignerLength) Fail("signerName", $"The signatory name must be {MaxSignerLength} characters or fewer.");
        var signerTitle = Text(request.SignerTitle);
        if (signerTitle.Length == 0) signerTitle = settings.SignerTitle.Trim();
        if (signerTitle.Length == 0) Fail("signerTitle", "Enter the signatory title.");
        else if (signerTitle.Length > MaxSignerLength) Fail("signerTitle", $"The signatory title must be {MaxSignerLength} characters or fewer.");

        string bankName = "", account = "", iban = "";
        if (type == LetterTypes.BankTransfer)
        {
            bankName = Text(worker?.BankName).Length > 0 ? Text(worker?.BankName) : Text(request.BankName);
            account = Text(worker?.BankAccountNumber).Length > 0 ? Text(worker?.BankAccountNumber) : Text(request.BankAccountNumber);
            iban = (Text(worker?.Iban).Length > 0 ? Text(worker?.Iban) : Text(request.Iban)).Replace(" ", "").ToUpperInvariant();
            if (bankName.Length == 0) Fail("bankName", "Enter the bank name.");
            else if (bankName.Length > MaxBankFieldLength) Fail("bankName", $"The bank name must be {MaxBankFieldLength} characters or fewer.");
            if (account.Length == 0) Fail("bankAccountNumber", "Enter the account number.");
            else if (account.Length > MaxBankFieldLength) Fail("bankAccountNumber", $"The account number must be {MaxBankFieldLength} characters or fewer.");
            if (iban.Length == 0) Fail("iban", "Enter the IBAN.");
            else if (iban.Length > MaxBankFieldLength) Fail("iban", $"The IBAN must be {MaxBankFieldLength} characters or fewer.");
        }

        LetterSalaryTable? salary = null;
        if (worker is not null && type is LetterTypes.Salary or LetterTypes.BankTransfer)
        {
            var basic = worker!.BasicSalary ?? worker.EffectiveSalary;
            var total = basic + worker.HousingAllowance + worker.TransportAllowance + worker.OtherAllowance;
            if (total <= 0) Fail("workerId", "This worker has no salary recorded. Add the salary first.");
            else salary = new LetterSalaryTable(basic, worker.HousingAllowance, worker.TransportAllowance, worker.OtherAllowance, total);
        }

        if (errors.Count > 0) return new(null, null, errors);

        var w = worker!;
        string name = $"{salutation} {w.FullName}", nationality = Or(w.Nationality), passport = Or(w.PassportNumber), eid = Or(w.EmiratesId);
        var joined = w.JoinDate?.ToString("dd MMM yyyy", CultureInfo.InvariantCulture) ?? Missing;
        var ids = $"{w.WorkerCode}";

        var (title, paragraphs) = type switch
        {
            LetterTypes.Salary => ("SALARY CERTIFICATE", new List<List<LetterRun>>
            {
                P(T("This is to certify that "), B(name), T(", holding "), B(nationality), T(" Passport No. "), B(passport), T(" and Emirates ID No. "), B(eid),
                    T(" (Employee ID: "), B(ids), T("), is actively employed with "), B(company), T(" as a "), B(w.Designation), T(" since "), B(joined), T(".")),
                P(T($"As per company records, {name}'s current monthly gross remuneration breakdown is structured as follows:")),
            }),
            LetterTypes.Service => ("EMPLOYMENT & SERVICE CERTIFICATE", new List<List<LetterRun>>
            {
                P(T("This certificate is issued to confirm that "), B(name), T(", a citizen of "), B(nationality), T(" holding Passport No. "), B(passport),
                    T(" and Emirates ID No. "), B(eid), T(", is currently employed with "), B(company), T(" as a "), B(w.Designation), T(".")),
                P(T($"{name} joined our company on "), B(joined), T(" and continues to fulfill duties under Employee ID "), B(ids), T(" with dedication and good professional conduct.")),
                P(T($"During employment, {name} has demonstrated strong capability and adherence to company policies and UAE labor laws.")),
            }),
            LetterTypes.BankTransfer => ("BANK SALARY TRANSFER REQUEST", new List<List<LetterRun>>
            {
                P(T("We hereby confirm that "), B(name), T(", holding "), B(nationality), T(" Passport No. "), B(passport), T(" and Emirates ID No. "), B(eid),
                    T(", is an active employee of "), B(company), T(" working as "), B(w.Designation), T(" since "), B(joined), T(".")),
                P(T("We confirm that monthly salary payments amounting to "), B(Money(salary!.Total) + " AED"),
                    T(" will be transferred directly to the employee's bank account maintained at "), B(bankName), T(" under Account No: "), B(account),
                    T(" (IBAN: "), B(iban), T(").")),
                P(T("The company undertakes not to alter or transfer these salary payments to another financial institution without official clearance from "),
                    B(bankName), T(", subject to UAE Central Bank guidelines.")),
            }),
            _ => ("WHOM IT MAY CONCERN / NOC LETTER", new List<List<LetterRun>>
            {
                P(T("This is to certify that "), B(name), T(", of "), B(nationality), T(" nationality, holding Passport No. "), B(passport), T(" and Emirates ID No. "), B(eid),
                    T(", is currently employed with "), B(company), T(" as "), B(w.Designation), T(" starting from "), B(joined), T(".")),
                P(T("Management confirms that "), B(company), T(" has "), B("No Objection (NOC)"),
                    T($" whatsoever regarding {name} proceeding with official administrative, driving license, tenancy, or financial requests as permitted under UAE law.")),
            }),
        };

        var content = new LetterContent(type, title, issueDate, "", addressee, company, settings.Address1, settings.Address2, settings.Mobile, settings.Email,
            w.FullName, w.WorkerCode, w.Designation, paragraphs, salary, purpose, signerName, signerTitle, request.ShowSeal ?? true);
        return new(content, settings, null);
    }

    private static string Text(string? value) => (value ?? "").Trim();
    private static string Or(string? value) => string.IsNullOrWhiteSpace(value) ? Missing : value.Trim();
    private static string Money(decimal value) => value.ToString("N2", CultureInfo.InvariantCulture);
    private static LetterRun T(string text) => new(text, false);
    private static LetterRun B(string text) => new(text, true);
    private static List<LetterRun> P(params LetterRun[] runs) => [.. runs];

    private static LetterContent Read(IssuedLetter letter) =>
        JsonSerializer.Deserialize<LetterContent>(letter.ContentJson, Json) ?? throw new InvalidOperationException("The stored letter is unreadable.");

    private static LetterDocument Document(LetterContent content, DocumentSettings s) =>
        new(content, s.Logo is { Length: > 0 }, s.Seal is { Length: > 0 }, s.Signature is { Length: > 0 });

    private static LetterRecord Record(IssuedLetter l, LetterContent content, DocumentSettings s) =>
        new(l.Id, l.RefNo, l.LetterType, l.WorkerId, l.IssueDate, l.IssuedBy, l.IssuedUtc, Document(content, s));
}
