using HrPayroll.Api.Auth;
using HrPayroll.Api.Dtos;
using HrPayroll.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace HrPayroll.Api.Controllers;

/// <summary>Tax invoices. Managers and the Administrator write; HR reads; supervisors have no access.</summary>
[Route("api/invoices")]
public sealed class InvoicesController(InvoiceService invoices, InvoicePdf pdf) : InvoiceBaseController
{
    [HttpGet]
    [Authorize(Policy = Policies.ManagerAdminOrHr)]
    public async Task<IActionResult> List([FromQuery] string? q, [FromQuery] int? clientId, [FromQuery] string? project,
        [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, [FromQuery] string? status, CancellationToken ct) =>
        Map(await invoices.ListAsync(new InvoiceFilter(q, clientId, project, from, to, status), ct));

    [HttpGet("export")]
    [Authorize(Policy = Policies.ManagerAdminOrHr)]
    public async Task<IActionResult> Export([FromQuery] string? q, [FromQuery] int? clientId, [FromQuery] string? project,
        [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, [FromQuery] string? status, CancellationToken ct)
    {
        var result = await invoices.ExportCsvAsync(new InvoiceFilter(q, clientId, project, from, to, status), ct);
        if (result.StatusCode != 200) return Map(result);
        var file = (InvoiceFile)result.Body!;
        Response.Headers.CacheControl = "no-store";
        return File(file.Content, file.ContentType, file.FileName);
    }

    [HttpGet("{id:int}")]
    [Authorize(Policy = Policies.ManagerAdminOrHr)]
    public async Task<IActionResult> Get(int id, CancellationToken ct) => Map(await invoices.GetAsync(id, ct));

    [HttpGet("{id:int}/pdf")]
    [Authorize(Policy = Policies.ManagerAdminOrHr)]
    public async Task<IActionResult> Pdf(int id, CancellationToken ct)
    {
        var (invoice, logo) = await invoices.ForPdfAsync(id, ct);
        if (invoice is null) return Map(new DocumentResult(404));
        try
        {
            Response.Headers.CacheControl = "no-store";
            var name = (invoice.Number ?? $"Draft-{invoice.Id}") + ".pdf";
            return File(pdf.Generate(invoice, logo), "application/pdf", name);
        }
        catch (PdfTextNotSupportedException)
        {
            return Problem(statusCode: 422, title: "The PDF supports English text. Update names that use other scripts, or print the invoice from the browser.");
        }
    }

    [HttpPost]
    [Authorize(Policy = Policies.ManagerOrAdmin)]
    public async Task<IActionResult> Create(InvoiceRequest request, CancellationToken ct) => Map(await invoices.CreateAsync(request, ct));

    [HttpPut("{id:int}")]
    [Authorize(Policy = Policies.ManagerOrAdmin)]
    public async Task<IActionResult> Update(int id, InvoiceRequest request, CancellationToken ct) => Map(await invoices.UpdateAsync(id, request, ct));

    [HttpDelete("{id:int}")]
    [Authorize(Policy = Policies.ManagerOrAdmin)]
    public async Task<IActionResult> Delete(int id, CancellationToken ct) => Map(await invoices.DeleteDraftAsync(id, ct));

    [HttpPost("{id:int}/duplicate")]
    [Authorize(Policy = Policies.ManagerOrAdmin)]
    public async Task<IActionResult> Duplicate(int id, CancellationToken ct) => Map(await invoices.DuplicateAsync(id, ct));

    [HttpPost("{id:int}/issue")]
    [Authorize(Policy = Policies.ManagerOrAdmin)]
    public async Task<IActionResult> Issue(int id, CancellationToken ct) => Map(await invoices.IssueAsync(id, ct));

    [HttpPost("{id:int}/cancel")]
    [Authorize(Policy = Policies.ManagerOrAdmin)]
    public async Task<IActionResult> Cancel(int id, CancelInvoiceRequest request, CancellationToken ct) => Map(await invoices.CancelAsync(id, request, ct));

    [HttpPost("{id:int}/payments")]
    [Authorize(Policy = Policies.ManagerOrAdmin)]
    public async Task<IActionResult> AddPayment(int id, InvoicePaymentRequest request, CancellationToken ct) => Map(await invoices.AddPaymentAsync(id, request, ct));

    [HttpDelete("{id:int}/payments/{paymentId:int}")]
    [Authorize(Policy = Policies.ManagerOrAdmin)]
    public async Task<IActionResult> DeletePayment(int id, int paymentId, CancellationToken ct) => Map(await invoices.DeletePaymentAsync(id, paymentId, ct));
}
