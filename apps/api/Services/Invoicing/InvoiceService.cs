using System.Data;
using System.Globalization;
using System.Text;
using System.Text.Json;
using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services;

public sealed record InvoiceFilter(string? Q = null, int? ClientId = null, string? Project = null, DateOnly? From = null, DateOnly? To = null, string? Status = null);

public sealed record InvoiceFile(byte[] Content, string FileName, string ContentType);

/// <summary>
/// Tax invoices: draft, issue (assigns the next gap-free number and locks), cancel, payments, duplicate, list and CSV.
/// All amounts are computed here by <see cref="InvoiceCalculator"/>; whatever the browser previewed is never trusted.
/// </summary>
public sealed class InvoiceService(AppDbContext db, IAuditLogger audit, TimeProvider time, IHttpContextAccessor httpContext)
{
    public const decimal MaxAmount = 999_999_999.99m;
    public const decimal MaxTotal = 9_999_999_999.99m;
    public const int MaxLines = 100;
    public static readonly string[] StatusFilters = ["Draft", "Issued", "PartPaid", "Paid", "Overdue", "Cancelled"];
    private static readonly TimeZoneInfo CompanyTimeZone = TimeZoneInfo.FindSystemTimeZoneById("Asia/Dubai");
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    // ----- queries ----------------------------------------------------------------------------------------

    public async Task<DocumentResult> ListAsync(InvoiceFilter filter, CancellationToken ct)
    {
        var problem = Validate(filter);
        if (problem is not null) return problem;
        var rows = await Filtered(filter).ToListAsync(ct);
        return new(200, rows.Select(ToSummary).Where(s => MatchesStatus(s, filter.Status)).ToList());
    }

    public async Task<DocumentResult> GetAsync(int id, CancellationToken ct)
    {
        var invoice = await LoadAsync(id, tracked: false, ct);
        return invoice is null ? new(404) : new(200, await ToResponseAsync(invoice, ct));
    }

    /// <summary>The CSV text of the filtered list. Cells starting with = + - @ are prefixed with a quote so a spreadsheet never runs them.</summary>
    public async Task<DocumentResult> ExportCsvAsync(InvoiceFilter filter, CancellationToken ct)
    {
        var problem = Validate(filter);
        if (problem is not null) return problem;
        var rows = (await Filtered(filter).ToListAsync(ct)).Select(r => (Row: r, Summary: ToSummary(r))).Where(x => MatchesStatus(x.Summary, filter.Status)).ToList();
        var csv = new StringBuilder();
        csv.AppendLine("Invoice No,Status,Client,Project,LPO Ref,Invoice Date,Due Date,Sub Total,VAT,Total,Paid,Balance Due");
        foreach (var (row, s) in rows)
        {
            csv.AppendLine(string.Join(',', new[]
            {
                Cell(s.Number ?? "(draft)"), Cell(s.IsOverdue ? "Overdue" : s.DisplayStatus), Cell(s.ClientName), Cell(s.Project), Cell(s.LpoRef),
                s.InvoiceDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), s.DueDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                Money(row.SubTotal), Money(row.VatTotal), Money(s.Total), Money(s.AmountPaid), Money(s.BalanceDue),
            }));
        }
        return new(200, new InvoiceFile(new UTF8Encoding(true).GetBytes(csv.ToString()), "Invoices.csv", "text/csv"));
    }

    // ----- drafts -----------------------------------------------------------------------------------------

    public async Task<DocumentResult> CreateAsync(InvoiceRequest request, CancellationToken ct)
    {
        var settings = await db.DocumentSettings.AsNoTracking().SingleAsync(s => s.Id == DocumentSettings.SingletonId, ct);
        var (built, errors) = await BuildAsync(request, settings, ct);
        if (errors.Count > 0) return new(400, Errors: errors);
        var invoice = new Invoice { CreatedBy = Actor, CreatedUtc = Now };
        Apply(invoice, built!);
        db.Invoices.Add(invoice);
        audit.Write("InvoiceCreated", entityType: nameof(Invoice), entityId: "new", details: new { client = invoice.ClientName, total = invoice.Total });
        await db.SaveChangesAsync(ct);
        return new(201, await ToResponseAsync(invoice, ct));
    }

    public async Task<DocumentResult> UpdateAsync(int id, InvoiceRequest request, CancellationToken ct)
    {
        var invoice = await LoadAsync(id, tracked: true, ct);
        if (invoice is null) return new(404);
        if (invoice.Status != InvoiceStatuses.Draft) return new(409, Message: "Only a draft invoice can be edited. This one is " + invoice.Status.ToLowerInvariant() + ".");
        var settings = await db.DocumentSettings.AsNoTracking().SingleAsync(s => s.Id == DocumentSettings.SingletonId, ct);
        var (built, errors) = await BuildAsync(request, settings, ct);
        if (errors.Count > 0) return new(400, Errors: errors);
        db.InvoiceLines.RemoveRange(invoice.Lines);
        invoice.Lines.Clear();
        Apply(invoice, built!);
        audit.Write("InvoiceUpdated", entityType: nameof(Invoice), entityId: Id(id), details: new { client = invoice.ClientName, total = invoice.Total });
        await db.SaveChangesAsync(ct);
        return new(200, await ToResponseAsync(invoice, ct));
    }

    public async Task<DocumentResult> DeleteDraftAsync(int id, CancellationToken ct)
    {
        var invoice = await LoadAsync(id, tracked: true, ct);
        if (invoice is null) return new(404);
        if (invoice.Status != InvoiceStatuses.Draft) return new(409, Message: "Only a draft invoice can be deleted. Cancel an issued invoice instead.");
        db.Invoices.Remove(invoice);
        audit.Write("InvoiceDraftDeleted", entityType: nameof(Invoice), entityId: Id(id), details: new { client = invoice.ClientName, total = invoice.Total });
        await db.SaveChangesAsync(ct);
        return new(204);
    }

    public async Task<DocumentResult> DuplicateAsync(int id, CancellationToken ct)
    {
        var source = await LoadAsync(id, tracked: false, ct);
        if (source is null) return new(404);
        var today = Today;
        var copy = new Invoice
        {
            Status = InvoiceStatuses.Draft, ClientId = source.ClientId, ClientName = source.ClientName, ClientTrn = source.ClientTrn,
            ClientAddress = source.ClientAddress, InvoiceDate = today, DueDate = today.AddDays(source.DueDate.DayNumber - source.InvoiceDate.DayNumber),
            PaymentTerms = source.PaymentTerms, LpoRef = source.LpoRef, PcRef = source.PcRef, Project = source.Project, Scope = source.Scope, Notes = source.Notes,
            SubTotal = source.SubTotal, VatTotal = source.VatTotal, Total = source.Total, CreatedBy = Actor, CreatedUtc = Now, UpdatedUtc = Now,
            Lines = source.Lines.OrderBy(l => l.LineNo).Select(l => new InvoiceLine
            {
                LineNo = l.LineNo, Description = l.Description, Quantity = l.Quantity, Rate = l.Rate, Taxable = l.Taxable, Vat = l.Vat, Amount = l.Amount,
            }).ToList(),
        };
        db.Invoices.Add(copy);
        audit.Write("InvoiceDuplicated", entityType: nameof(Invoice), entityId: "new", details: new { sourceId = id, sourceNumber = source.Number });
        await db.SaveChangesAsync(ct);
        return new(201, await ToResponseAsync(copy, ct));
    }

    // ----- issue / cancel / payments ---------------------------------------------------------------------

    public const int MaxNumberLength = 30;
    private static readonly System.Text.RegularExpressions.Regex NumberPattern = new(@"^[A-Za-z0-9][A-Za-z0-9 ./_-]*$", System.Text.RegularExpressions.RegexOptions.Compiled);

    /// <summary>
    /// Locks the invoice and gives it a number: the one the manager typed, or, when none is typed, the next automatic
    /// number. The counter is read under an update lock inside a serialisable transaction so two automatic issues can never
    /// share or skip a number. A typed number is checked for being unused and does not move the counter.
    /// </summary>
    public async Task<DocumentResult> IssueAsync(int id, string? typedNumber, CancellationToken ct)
    {
        var typed = (typedNumber ?? "").Trim();
        if (typed.Length > MaxNumberLength)
            return new(400, Errors: new() { ["number"] = [$"The invoice number must be {MaxNumberLength} characters or fewer."] });
        if (typed.Length > 0 && !NumberPattern.IsMatch(typed))
            return new(400, Errors: new() { ["number"] = ["Use letters, numbers, spaces and . / _ - only, starting with a letter or number."] });

        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        try
        {
            var invoice = await LoadAsync(id, tracked: true, ct);
            if (invoice is null) return new(404);
            if (invoice.Status != InvoiceStatuses.Draft) return new(409, Message: "This invoice has already been issued.");
            var errors = new Dictionary<string, string[]>();
            if (string.IsNullOrWhiteSpace(invoice.ClientName)) errors["clientName"] = ["Enter the client before issuing."];
            if (invoice.Lines.Count == 0) errors["lines"] = ["Add at least one line before issuing."];
            if (invoice.Total <= 0) errors["lines"] = ["The invoice total must be above 0 before it can be issued."];
            if (errors.Count > 0) return new(400, Errors: errors);

            var settings = await db.DocumentSettings
                .FromSqlRaw("SELECT * FROM DocumentSettings WITH (UPDLOCK, HOLDLOCK) WHERE Id = 1")
                .SingleAsync(ct);
            if (typed.Length > 0)
            {
                if (await db.Invoices.AnyAsync(i => i.Number == typed, ct))
                    return new(400, Errors: new() { ["number"] = ["This invoice number is already used by another invoice."] });
                invoice.Number = typed;
            }
            else
            {
                invoice.Number = "INV-" + settings.NextInvoiceNumber.ToString("000000", CultureInfo.InvariantCulture);
                settings.NextInvoiceNumber++;
            }
            invoice.Status = InvoiceStatuses.Issued;
            invoice.IssuedUtc = Now;
            invoice.IssuedBy = Actor;
            invoice.UpdatedUtc = Now;
            invoice.CompanyJson = JsonSerializer.Serialize(CompanyOf(settings), JsonOptions);
            audit.Write("InvoiceIssued", entityType: nameof(Invoice), entityId: Id(id), details: new { number = invoice.Number, total = invoice.Total, typed = typed.Length > 0 });
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            return new(200, await ToResponseAsync(invoice, ct));
        }
        catch (Exception ex) when (ex is DbUpdateException or Microsoft.Data.SqlClient.SqlException)
        {
            return new(409, Message: "Another invoice was being issued at the same time. Try again.");
        }
    }

    public async Task<DocumentResult> CancelAsync(int id, CancelInvoiceRequest request, CancellationToken ct)
    {
        var reason = (request.Reason ?? "").Trim();
        if (reason.Length == 0) return new(400, Errors: new() { ["reason"] = ["Enter the reason for cancelling."] });
        if (reason.Length > 300) return new(400, Errors: new() { ["reason"] = ["Reason must be 300 characters or fewer."] });
        var invoice = await LoadAsync(id, tracked: true, ct);
        if (invoice is null) return new(404);
        if (invoice.Status != InvoiceStatuses.Issued) return new(409, Message: "Only an issued invoice can be cancelled.");
        if (invoice.Payments.Count > 0) return new(409, Message: "This invoice has payments. Remove them before cancelling.");
        invoice.Status = InvoiceStatuses.Cancelled;
        invoice.CancelledUtc = Now;
        invoice.CancelReason = reason;
        invoice.UpdatedUtc = Now;
        audit.Write("InvoiceCancelled", entityType: nameof(Invoice), entityId: Id(id), details: new { number = invoice.Number, reason });
        await db.SaveChangesAsync(ct);
        return new(200, await ToResponseAsync(invoice, ct));
    }

    public async Task<DocumentResult> AddPaymentAsync(int id, InvoicePaymentRequest request, CancellationToken ct)
    {
        var errors = new Dictionary<string, string[]>();
        var method = (request.Method ?? "").Trim();
        var reference = (request.Reference ?? "").Trim();
        if (request.PaidDate is null) errors["paidDate"] = ["Enter the payment date."];
        else if (request.PaidDate > Today) errors["paidDate"] = ["The payment date cannot be in the future."];
        if (request.Amount is null || request.Amount <= 0 || request.Amount > MaxAmount || decimal.Round(request.Amount.Value, 2) != request.Amount.Value)
            errors["amount"] = ["Enter an amount above 0 with at most 2 decimal places."];
        if (method.Length == 0) errors["method"] = ["Enter how it was paid (for example Bank transfer)."];
        else if (method.Length > 30) errors["method"] = ["Method must be 30 characters or fewer."];
        if (reference.Length > 60) errors["reference"] = ["Reference must be 60 characters or fewer."];
        if (errors.Count > 0) return new(400, Errors: errors);

        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        try
        {
            var invoice = await LoadAsync(id, tracked: true, ct);
            if (invoice is null) return new(404);
            if (invoice.Status != InvoiceStatuses.Issued) return new(409, Message: "Payments can only be recorded against an issued invoice.");
            var balance = invoice.Total - invoice.Payments.Sum(p => p.Amount);
            if (request.Amount > balance) return new(400, Errors: new() { ["amount"] = [$"The payment is more than the balance due ({balance.ToString("N2", CultureInfo.InvariantCulture)})."] });
            var payment = new InvoicePayment { PaidDate = request.PaidDate!.Value, Amount = request.Amount!.Value, Method = method, Reference = reference, RecordedBy = Actor, RecordedUtc = Now };
            invoice.Payments.Add(payment);
            invoice.UpdatedUtc = Now;
            audit.Write("InvoicePaymentRecorded", entityType: nameof(Invoice), entityId: Id(id), details: new { number = invoice.Number, amount = payment.Amount, method });
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            return new(200, await ToResponseAsync(invoice, ct));
        }
        catch (Exception ex) when (ex is DbUpdateException or Microsoft.Data.SqlClient.SqlException)
        {
            return new(409, Message: "The invoice changed while you were saving. Reload and try again.");
        }
    }

    public async Task<DocumentResult> DeletePaymentAsync(int id, int paymentId, CancellationToken ct)
    {
        var invoice = await LoadAsync(id, tracked: true, ct);
        if (invoice is null) return new(404);
        var payment = invoice.Payments.SingleOrDefault(p => p.Id == paymentId);
        if (payment is null) return new(404);
        invoice.Payments.Remove(payment);
        db.InvoicePayments.Remove(payment);
        invoice.UpdatedUtc = Now;
        audit.Write("InvoicePaymentRemoved", entityType: nameof(Invoice), entityId: Id(id), details: new { number = invoice.Number, amount = payment.Amount });
        await db.SaveChangesAsync(ct);
        return new(200, await ToResponseAsync(invoice, ct));
    }

    /// <summary>The invoice and the logo bytes for the PDF.</summary>
    public async Task<(InvoiceResponse? Invoice, byte[]? Logo, byte[]? Seal)> ForPdfAsync(int id, CancellationToken ct)
    {
        var invoice = await LoadAsync(id, tracked: false, ct);
        if (invoice is null) return (null, null, null);
        // The logo and stamp are read from the current settings, the same as the on-screen view, so an upload applies to every invoice.
        var images = await db.DocumentSettings.AsNoTracking().Where(s => s.Id == DocumentSettings.SingletonId)
            .Select(s => new { s.Logo, s.Seal }).SingleAsync(ct);
        return (await ToResponseAsync(invoice, ct), images.Logo, images.Seal);
    }

    // ----- building and mapping ---------------------------------------------------------------------------

    private sealed record Built(
        int? ClientId, string ClientName, string ClientTrn, string ClientAddress, DateOnly InvoiceDate, DateOnly DueDate,
        string PaymentTerms, string LpoRef, string PcRef, string Project, string Scope, string Notes,
        List<(string Description, decimal Quantity, decimal Rate, decimal Taxable, decimal Vat, decimal Amount)> Lines);

    private async Task<(Built? Built, Dictionary<string, string[]> Errors)> BuildAsync(InvoiceRequest r, DocumentSettings settings, CancellationToken ct)
    {
        var errors = new Dictionary<string, string[]>();
        string clientName, clientTrn, clientAddress;
        if (r.ClientId is { } clientId)
        {
            var client = await db.InvoiceClients.AsNoTracking().SingleOrDefaultAsync(c => c.Id == clientId, ct);
            if (client is null) errors["clientId"] = ["Choose a client from the list."];
            clientName = client?.Name ?? ""; clientTrn = client?.Trn ?? ""; clientAddress = client?.Address ?? "";
        }
        else
        {
            clientName = (r.ClientName ?? "").Trim(); clientTrn = (r.ClientTrn ?? "").Trim(); clientAddress = (r.ClientAddress ?? "").Trim();
            if (clientName.Length == 0) errors["clientName"] = ["Choose or enter the client."];
            else if (clientName.Length > 120) errors["clientName"] = ["Client name must be 120 characters or fewer."];
            if (clientTrn.Length > 30) errors["clientTrn"] = ["TRN must be 30 characters or fewer."];
            if (clientAddress.Length > 250) errors["clientAddress"] = ["Address must be 250 characters or fewer."];
        }

        if (r.InvoiceDate is null) errors["invoiceDate"] = ["Enter the invoice date."];
        if (r.DueDate is null) errors["dueDate"] = ["Enter the due date."];
        else if (r.InvoiceDate is { } d && r.DueDate < d) errors["dueDate"] = ["The due date cannot be before the invoice date."];
        var terms = (r.PaymentTerms ?? "").Trim();
        if (terms.Length == 0) terms = settings.DefaultPaymentTerms;
        if (terms.Length > 40) errors["paymentTerms"] = ["Terms must be 40 characters or fewer."];
        var lpo = (r.LpoRef ?? "").Trim(); var project = (r.Project ?? "").Trim(); var scope = (r.Scope ?? "").Trim(); var notes = (r.Notes ?? "").Trim();
        if (lpo.Length > 80) errors["lpoRef"] = ["LPO reference must be 80 characters or fewer."];
        var pc = (r.PcRef ?? "").Trim();
        if (pc.Length > 80) errors["pcRef"] = ["PC reference must be 80 characters or fewer."];
        if (project.Length > 120) errors["project"] = ["Project must be 120 characters or fewer."];
        if (scope.Length > 120) errors["scope"] = ["Scope must be 120 characters or fewer."];
        if (notes.Length > 300) errors["notes"] = ["Notes must be 300 characters or fewer."];

        var lines = new List<(string, decimal, decimal, decimal, decimal, decimal)>();
        var requested = r.Lines ?? [];
        if (requested.Count == 0) errors["lines"] = ["Add at least one line."];
        else if (requested.Count > MaxLines) errors["lines"] = [$"An invoice can have at most {MaxLines} lines."];
        else
        {
            for (var i = 0; i < requested.Count; i++)
            {
                var line = requested[i];
                var description = (line?.Description ?? "").Trim();
                if (description.Length == 0) errors[$"lines[{i}].description"] = ["Enter a description."];
                else if (description.Length > 500) errors[$"lines[{i}].description"] = ["Description must be 500 characters or fewer."];
                var ok = true;
                if (line?.Quantity is null || line.Quantity < 0 || line.Quantity > MaxAmount || decimal.Round(line.Quantity.Value, 2) != line.Quantity.Value)
                { errors[$"lines[{i}].quantity"] = ["Enter an area of 0 or more with at most 2 decimal places."]; ok = false; }
                if (line?.Rate is null || line.Rate < 0 || line.Rate > MaxAmount || decimal.Round(line.Rate.Value, 2) != line.Rate.Value)
                { errors[$"lines[{i}].rate"] = ["Enter a rate of 0 or more with at most 2 decimal places."]; ok = false; }
                if (!ok) continue;
                var (taxable, vat, amount) = InvoiceCalculator.Line(line!.Quantity!.Value, line.Rate!.Value);
                if (amount > MaxTotal) { errors[$"lines[{i}].rate"] = ["This line is too large."]; continue; }
                lines.Add((description, line.Quantity.Value, line.Rate.Value, taxable, vat, amount));
            }
            if (errors.Count == 0 && lines.Sum(l => l.Item6) > MaxTotal) errors["lines"] = ["The invoice total is too large."];
        }
        if (errors.Count > 0) return (null, errors);
        return (new Built(r.ClientId, clientName, clientTrn, clientAddress, r.InvoiceDate!.Value, r.DueDate!.Value, terms, lpo, pc, project, scope, notes, lines), errors);
    }

    private void Apply(Invoice invoice, Built b)
    {
        invoice.ClientId = b.ClientId; invoice.ClientName = b.ClientName; invoice.ClientTrn = b.ClientTrn; invoice.ClientAddress = b.ClientAddress;
        invoice.InvoiceDate = b.InvoiceDate; invoice.DueDate = b.DueDate; invoice.PaymentTerms = b.PaymentTerms;
        invoice.LpoRef = b.LpoRef; invoice.PcRef = b.PcRef; invoice.Project = b.Project; invoice.Scope = b.Scope; invoice.Notes = b.Notes;
        var n = 0;
        foreach (var l in b.Lines)
            invoice.Lines.Add(new InvoiceLine { LineNo = ++n, Description = l.Description, Quantity = l.Quantity, Rate = l.Rate, Taxable = l.Taxable, Vat = l.Vat, Amount = l.Amount });
        var (sub, vat, total) = InvoiceCalculator.Totals(b.Lines.Select(l => (l.Taxable, l.Vat, l.Amount)));
        invoice.SubTotal = sub; invoice.VatTotal = vat; invoice.Total = total;
        invoice.UpdatedUtc = Now;
    }

    private Task<Invoice?> LoadAsync(int id, bool tracked, CancellationToken ct)
    {
        var query = db.Invoices.Include(i => i.Lines).Include(i => i.Payments).AsSplitQuery();
        return (tracked ? query : query.AsNoTracking()).SingleOrDefaultAsync(i => i.Id == id, ct);
    }

    private IQueryable<InvoiceRow> Filtered(InvoiceFilter f)
    {
        var query = db.Invoices.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(f.Q))
        {
            var q = f.Q.Trim();
            query = query.Where(i => (i.Number != null && i.Number.Contains(q)) || i.ClientName.Contains(q) || i.Project.Contains(q) || i.LpoRef.Contains(q));
        }
        if (f.ClientId is { } clientId) query = query.Where(i => i.ClientId == clientId);
        if (!string.IsNullOrWhiteSpace(f.Project)) { var p = f.Project.Trim(); query = query.Where(i => i.Project.Contains(p)); }
        if (f.From is { } from) query = query.Where(i => i.InvoiceDate >= from);
        if (f.To is { } to) query = query.Where(i => i.InvoiceDate <= to);
        return query.OrderByDescending(i => i.InvoiceDate).ThenByDescending(i => i.Id).Select(i => new InvoiceRow(
            i.Id, i.Number, i.Status, i.ClientName, i.Project, i.LpoRef, i.InvoiceDate, i.DueDate, i.SubTotal, i.VatTotal, i.Total,
            i.Payments.Sum(p => (decimal?)p.Amount) ?? 0m));
    }

    private sealed record InvoiceRow(
        int Id, string? Number, string Status, string ClientName, string Project, string LpoRef, DateOnly InvoiceDate, DateOnly DueDate,
        decimal SubTotal, decimal VatTotal, decimal Total, decimal Paid);

    private InvoiceSummary ToSummary(InvoiceRow r)
    {
        var display = DisplayStatus(r.Status, r.Total, r.Paid);
        return new(r.Id, r.Number, r.Status, display, IsOverdue(r.Status, r.Total, r.Paid, r.DueDate), r.ClientName, r.Project, r.LpoRef,
            r.InvoiceDate, r.DueDate, r.Total, r.Paid, r.Status == InvoiceStatuses.Issued ? r.Total - r.Paid : 0m);
    }

    private static bool MatchesStatus(InvoiceSummary s, string? status) => string.IsNullOrWhiteSpace(status) || status switch
    {
        "Overdue" => s.IsOverdue,
        _ => s.DisplayStatus == status,
    };

    private static DocumentResult? Validate(InvoiceFilter f)
    {
        var errors = new Dictionary<string, string[]>();
        if (!string.IsNullOrWhiteSpace(f.Status) && !StatusFilters.Contains(f.Status)) errors["status"] = ["Choose a valid status."];
        if (f.From is { } from && f.To is { } to && from > to) errors["to"] = ["The end date cannot be before the start date."];
        return errors.Count > 0 ? new(400, Errors: errors) : null;
    }

    public static string DisplayStatus(string status, decimal total, decimal paid) => status switch
    {
        InvoiceStatuses.Draft => "Draft",
        InvoiceStatuses.Cancelled => "Cancelled",
        _ => paid >= total && total > 0 ? "Paid" : paid > 0 ? "PartPaid" : "Issued",
    };

    private bool IsOverdue(string status, decimal total, decimal paid, DateOnly dueDate) =>
        status == InvoiceStatuses.Issued && total - paid > 0 && dueDate < Today;

    private async Task<InvoiceResponse> ToResponseAsync(Invoice i, CancellationToken ct)
    {
        InvoiceCompany company;
        if (i.CompanyJson is not null) company = JsonSerializer.Deserialize<InvoiceCompany>(i.CompanyJson, JsonOptions)!;
        else company = CompanyOf(await db.DocumentSettings.AsNoTracking().SingleAsync(s => s.Id == DocumentSettings.SingletonId, ct));
        var paid = i.Payments.Sum(p => p.Amount);
        var images = await db.DocumentSettings.AsNoTracking().Where(s => s.Id == DocumentSettings.SingletonId)
            .Select(s => new { HasLogo = s.Logo != null, HasSeal = s.Seal != null }).SingleAsync(ct);
        var live = company with { HasLogo = images.HasLogo, HasSeal = images.HasSeal };
        return new InvoiceResponse(
            i.Id, i.Number, i.Status, DisplayStatus(i.Status, i.Total, paid), IsOverdue(i.Status, i.Total, paid, i.DueDate),
            i.ClientId, i.ClientName, i.ClientTrn, i.ClientAddress, i.InvoiceDate, i.DueDate, i.PaymentTerms, i.LpoRef, i.Project, i.Scope, i.Notes,
            i.Lines.OrderBy(l => l.LineNo).Select(l => new InvoiceLineResponse(l.LineNo, l.Description, l.Quantity, l.Rate, l.Taxable, l.Vat, l.Amount)).ToList(),
            i.Payments.OrderBy(p => p.PaidDate).ThenBy(p => p.Id).Select(p => new InvoicePaymentResponse(p.Id, p.PaidDate, p.Amount, p.Method, p.Reference, p.RecordedBy)).ToList(),
            i.SubTotal, i.VatTotal, i.Total, paid, i.Status == InvoiceStatuses.Issued ? i.Total - paid : 0m, AmountInWords.Aed(i.Total),
            live, i.CreatedBy, i.IssuedUtc, i.IssuedBy, i.CancelledUtc, i.CancelReason, i.PcRef);
    }

    private static InvoiceCompany CompanyOf(DocumentSettings s) => new(
        s.CompanyName, s.CompanySubtitle, s.CompanyNameAr, s.Mobile, s.Address1, s.Address2, s.Email, s.Trn, s.BankName,
        s.AccountName, s.AccountNumber, s.Iban, s.Logo is not null, s.Seal is not null);

    private static string Cell(string value)
    {
        var text = value.Replace("\r", " ").Replace("\n", " ");
        if (text.Length > 0 && "=+-@\t".Contains(text[0])) text = "'" + text;
        return "\"" + text.Replace("\"", "\"\"") + "\"";
    }

    private static string Money(decimal value) => value.ToString("0.00", CultureInfo.InvariantCulture);
    private static string Id(int id) => id.ToString(CultureInfo.InvariantCulture);
    private string Actor => httpContext.HttpContext?.User.Identity?.Name ?? "";
    private DateTime Now => time.GetUtcNow().UtcDateTime;
    private DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(time.GetUtcNow(), CompanyTimeZone).DateTime);
}
