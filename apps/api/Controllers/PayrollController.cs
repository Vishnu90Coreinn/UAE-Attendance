using HrPayroll.Api.Auth;
using HrPayroll.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace HrPayroll.Api.Controllers;

[ApiController]
[Route("api/payroll")]
public sealed class PayrollController(PayrollService payroll, PayrollPdf pdf) : ControllerBase
{
    [HttpGet]
    [Authorize(Policy = Policies.AnyUser)]
    public async Task<IActionResult> Get([FromQuery] string? month, CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        if (!PayrollService.TryMonth(month, out var start)) return InvalidMonth();
        return Ok(await payroll.ReadAsync(start, ct));
    }

    [HttpGet("pdf")]
    [Authorize(Policy = Policies.AnyUser)]
    public async Task<IActionResult> Pdf([FromQuery] string? month, [FromQuery] string? revision, CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        if (!PayrollService.TryMonth(month, out var start)) return InvalidMonth();
        var report = await payroll.ReadAsync(start, ct);
        if (revision is not null && revision != report.Revision)
            return Problem(statusCode: 409, title: "Payroll changed. Reload the report before exporting.");
        try { return File(pdf.Generate(report), "application/pdf", $"Payroll_{report.Period}.pdf"); }
        catch (PdfTextNotSupportedException)
        {
            return Problem(statusCode: 422, title: "This PDF supports English text. Update unsupported characters or use Print for this report.");
        }
    }

    private IActionResult InvalidMonth() => ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]>
        { ["month"] = ["Choose a valid month in YYYY-MM format (0001-01 to 9999-12)."] }));
}
