using HrPayroll.Api.Auth;
using HrPayroll.Api.Dtos;
using HrPayroll.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace HrPayroll.Api.Controllers;

[ApiController]
[TypeFilter(typeof(PayrollConflictFilter))]
[Route("api/payroll")]
public sealed class PayrollController(PayrollService payroll, PayrollPdf pdf) : ControllerBase
{
    [HttpGet]
    [Authorize(Policy = Policies.ManagerOrAdmin)]
    public async Task<IActionResult> Get([FromQuery] string? month, CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        if (!PayrollService.TryMonth(month, out var start)) return InvalidMonth();
        return Ok(await payroll.ReadAsync(start, ct));
    }

    [HttpGet("pdf")]
    [Authorize(Policy = Policies.ManagerOrAdmin)]
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

    [HttpPost("{month}/finalise")]
    [Authorize(Policy = Policies.ManagerOrAdmin)]
    public async Task<IActionResult> Finalise(string month, FinalisePayrollRequest request, CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        if (!PayrollService.TryMonth(month, out var start)) return InvalidMonth();
        if (payroll.IsFutureMonth(start)) return ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]>
            { ["month"] = ["Future UAE months cannot be finalised."] }));
        if (string.IsNullOrWhiteSpace(request.Revision)) return ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]>
            { ["revision"] = ["Reload the report and provide its revision."] }));
        var result = await payroll.FinaliseAsync(start, request.Revision, ct);
        return result.StatusCode == 200 ? Ok(result.Report) : Problem(statusCode: 409, title: "Payroll is already finalised or changed. Reload the report.");
    }

    [HttpDelete("{month}/finalise")]
    [Authorize(Policy = Policies.ManagerOrAdmin)]
    public async Task<IActionResult> Reopen(string month, ReopenPayrollRequest request, CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        if (!PayrollService.TryMonth(month, out var start)) return InvalidMonth();
        var reason = request.Reason?.Trim();
        if (string.IsNullOrEmpty(reason) || reason.Length > 500) return ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]>
            { ["reason"] = ["Enter a reason of 1 to 500 characters."] }));
        var result = await payroll.ReopenAsync(start, reason, ct);
        return result.StatusCode == 200 ? Ok(result.Report) : Problem(statusCode: 409, title: "Payroll is not finalised. Reload the report.");
    }

    private IActionResult InvalidMonth() => ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]>
        { ["month"] = ["Choose a valid month in YYYY-MM format (0001-01 to 9999-12)."] }));
}
