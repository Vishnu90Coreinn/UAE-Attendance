using HrPayroll.Api.Auth;
using HrPayroll.Api.Dtos;
using HrPayroll.Api.Services;
using HrPayroll.Api.Services.Finance;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace HrPayroll.Api.Controllers;

/// <summary>The books: chart of accounts, ledger, journals, trial balance and the safety checks. Managers and Administrators and the read-only Partner see them.</summary>
[ApiController]
[Route("api/finance/ledger")]
public sealed class LedgerController(FinanceLedgerService ledger, FinanceLedgerExportService exports) : ControllerBase
{
    private static DateOnly? Date(string? text) => FinanceRules.TryParseDate(text, out var d) ? d : null;

    private IActionResult Map<T>(FinResult<T> result) => result.Status switch
    {
        200 => Ok(result.Value),
        201 => StatusCode(201, result.Value),
        400 => ValidationProblem(new ValidationProblemDetails(result.Errors!)),
        404 => Problem(statusCode: 404, title: result.Title ?? "Not found."),
        _ => Problem(statusCode: result.Status, title: result.Title),
    };

    /// <summary>A download when <c>format</c> is xlsx, pdf or csv; null for the JSON the screen uses.</summary>
    private static FinReportFormat? Format(string? format) => (format ?? "json").ToLowerInvariant() switch
    {
        "xlsx" => FinReportFormat.Excel, "pdf" => FinReportFormat.Pdf, "csv" => FinReportFormat.Csv, _ => null,
    };

    private async Task<IActionResult> Download(Func<Task<FinResult<FinReportFile>>> make)
    {
        Response.Headers.CacheControl = "no-store";
        try
        {
            var file = await make();
            return file.Status == 200 ? File(file.Value!.Content, file.Value.ContentType, file.Value.FileName) : Map(file);
        }
        catch (PdfTextNotSupportedException)
        {
            return Problem(statusCode: 422, title: "The PDF supports English text. Use the Excel or CSV file for names in other scripts.");
        }
    }

    [HttpGet("accounts")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> Chart([FromQuery] string? asOf, CancellationToken ct) => Ok(await ledger.ChartAsync(Date(asOf), ct));

    [HttpPost("accounts")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> CreateAccount([FromBody] LedgerAccountRequest? request, CancellationToken ct) => Map(await ledger.CreateAccountAsync(request ?? new(), ct));

    [HttpPut("accounts/{id:int}")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> UpdateAccount(int id, [FromBody] LedgerAccountRequest? request, CancellationToken ct) => Map(await ledger.UpdateAccountAsync(id, request ?? new(), ct));

    [HttpGet("trial-balance")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> TrialBalance([FromQuery] string? asOf, [FromQuery] string? format, CancellationToken ct) =>
        Format(format) is { } f
            ? await Download(async () => FinResult<FinReportFile>.Ok(await exports.TrialBalanceAsync(asOf, f, ct)))
            : Ok(await ledger.TrialBalanceAsync(Date(asOf), ct));

    [HttpGet("profit-and-loss")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> ProfitAndLoss([FromQuery] string? from, [FromQuery] string? to, [FromQuery] string? format, CancellationToken ct) =>
        Format(format) is { } f ? await Download(() => exports.ProfitAndLossAsync(from, to, f, ct)) : Map(await ledger.ProfitAndLossAsync(from, to, ct));

    [HttpGet("balance-sheet")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> BalanceSheet([FromQuery] string? asOf, [FromQuery] string? format, CancellationToken ct) =>
        Format(format) is { } f
            ? await Download(async () => FinResult<FinReportFile>.Ok(await exports.BalanceSheetAsync(asOf, f, ct)))
            : Ok(await ledger.BalanceSheetAsync(asOf, ct));

    [HttpGet("accounts/{id:int}/statement")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> Statement(int id, [FromQuery] string? from, [FromQuery] string? to, [FromQuery] string? format, CancellationToken ct) =>
        Format(format) is { } f ? await Download(() => exports.StatementAsync(id, from, to, f, ct)) : Map(await ledger.StatementAsync(id, from, to, ct));

    [HttpGet("journals")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> Journals([FromQuery] string? from, [FromQuery] string? to, [FromQuery] string? source, [FromQuery] int? sourceId, [FromQuery] string? format, CancellationToken ct) =>
        Format(format) is { } f
            ? await Download(async () => FinResult<FinReportFile>.Ok(await exports.JournalsAsync(from, to, f, ct)))
            : Ok(await ledger.JournalsAsync(from, to, source, sourceId, ct));

    /// <summary>Post a journal by hand. It must balance, and cannot go in a locked month.</summary>
    [HttpPost("journals")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> PostJournal([FromBody] ManualJournalRequest? request, CancellationToken ct) => Map(await ledger.PostManualAsync(request ?? new(), ct));

    [HttpPost("journals/{id:int}/reverse")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> ReverseJournal(int id, [FromBody] FinVoidRequest? request, CancellationToken ct) => Map(await ledger.ReverseManualAsync(id, request?.Reason, ct));

    /// <summary>Whether the ledger agrees with the finance screens, account by account and partner by partner.</summary>
    [HttpGet("check")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> Check(CancellationToken ct) => Ok(await ledger.CheckAsync(ct));

    [HttpGet("mappings")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> Mappings(CancellationToken ct) => Ok(await ledger.MappingsAsync(ct));

    /// <summary>Administrator only: choose where a category, account or partner posts. The books are derived again so the past follows.</summary>
    [HttpPut("mappings/{kind}/{id:int}")]
    [Authorize(Policy = Policies.AdminOnly)]
    public async Task<IActionResult> SetMapping(string kind, int id, [FromBody] LedgerMappingRequest? request, CancellationToken ct) => Map(await ledger.SetMappingAsync(kind, id, request ?? new(), ct));

    [HttpPost("sync")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> Sync(CancellationToken ct) => Ok(await ledger.SyncAsync(ct));

    /// <summary>Administrator only: derive every journal again, for when the mapping changed before the books went live.</summary>
    [HttpPost("rebuild")]
    [Authorize(Policy = Policies.AdminOnly)]
    public async Task<IActionResult> Rebuild(CancellationToken ct) => Map(await ledger.RebuildAsync(ct));
}
