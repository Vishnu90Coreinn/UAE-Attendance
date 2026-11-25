using HrPayroll.Api.Auth;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using HrPayroll.Api.Services;
using HrPayroll.Api.Services.Finance;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace HrPayroll.Api.Controllers;

/// <summary>Expense and income tracking: bank and cash accounts, categories and transfers. Managers and Administrators edit; the Partner reads.</summary>
[ApiController]
[Route("api/finance")]
public sealed class FinanceController(FinanceAccountService accounts, FinanceCategoryService categories, FinanceTransferService transfers, FinanceEntryService entries, FinancePeriodService periods, FinanceDashboardService dashboard, FinanceReportService reports, FinanceReportExportService reportExports, FinancePartnerService partners) : ControllerBase
{
    private IActionResult Map<T>(FinResult<T> result) => result.Status switch
    {
        200 => Ok(result.Value),
        201 => StatusCode(201, result.Value),
        400 => ValidationProblem(new ValidationProblemDetails(result.Errors!)),
        404 => Problem(statusCode: 404, title: result.Title ?? "Not found."),
        _ => Problem(statusCode: result.Status, title: result.Title),
    };

    [HttpGet("dashboard")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> Dashboard([FromQuery] int? days, CancellationToken ct) => Ok(await dashboard.GetAsync(days, ct));

    // --- partners and their capital ---------------------------------------------------------------------------

    [HttpGet("partners")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> Partners(CancellationToken ct) => Ok(await partners.ListAsync(ct));

    [HttpPost("partners")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> CreatePartner([FromBody] FinPartnerRequest? request, CancellationToken ct) => Map(await partners.CreateAsync(request ?? new(), ct));

    [HttpPut("partners/{id:int}")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> UpdatePartner(int id, [FromBody] FinPartnerRequest? request, CancellationToken ct) => Map(await partners.UpdateAsync(id, request ?? new(), ct));

    /// <summary>Capital put in and paid back, newest first; the total is what is left.</summary>
    [HttpGet("capital")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> Capital(
        [FromQuery] string? from, [FromQuery] string? to, [FromQuery] int? partnerId, [FromQuery] int? accountId, [FromQuery] bool includeVoided, CancellationToken ct) =>
        Ok(await entries.ListAsync(FinEntryKinds.CapitalKinds, new FinEntryFilter(from, to, null, accountId, null, null, null, includeVoided, partnerId), ct));

    [HttpPost("capital/contributions")]
    [Authorize(Policy = Policies.Finance)]
    [RequestSizeLimit(30_000_000)]
    public async Task<IActionResult> AddCapital([FromForm] FinExpenseForm? form, CancellationToken ct) =>
        Map(await entries.CreateAsync(FinEntryKinds.Capital, form ?? new(), ct));

    [HttpPost("capital/returns")]
    [Authorize(Policy = Policies.Finance)]
    [RequestSizeLimit(30_000_000)]
    public async Task<IActionResult> ReturnCapital([FromForm] FinExpenseForm? form, CancellationToken ct) =>
        Map(await entries.CreateAsync(FinEntryKinds.CapitalOut, form ?? new(), ct));

    [HttpGet("capital/{id:int}")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> CapitalEntry(int id, CancellationToken ct) =>
        await entries.KindOfAsync(id, ct) is { } kind && FinEntryKinds.IsCapital(kind)
            ? Map(await entries.GetAsync(kind, id, ct)) : Problem(statusCode: 404, title: "The capital entry was not found.");

    [HttpPut("capital/{id:int}")]
    [Authorize(Policy = Policies.Finance)]
    [RequestSizeLimit(30_000_000)]
    public async Task<IActionResult> CorrectCapital(int id, [FromForm] FinExpenseForm? form, CancellationToken ct) =>
        await entries.KindOfAsync(id, ct) is { } kind && FinEntryKinds.IsCapital(kind)
            ? Map(await entries.CorrectAsync(kind, id, form ?? new(), ct)) : Problem(statusCode: 404, title: "The capital entry was not found.");

    [HttpPost("capital/{id:int}/void")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> VoidCapital(int id, [FromBody] FinVoidRequest? request, CancellationToken ct) =>
        await entries.KindOfAsync(id, ct) is { } kind && FinEntryKinds.IsCapital(kind)
            ? Map(await entries.VoidAsync(kind, id, request?.Reason, ct)) : Problem(statusCode: 404, title: "The capital entry was not found.");

    // --- reports ----------------------------------------------------------------------------------------------

    /// <summary>The period statement as JSON, or as a download when <c>format</c> is xlsx, pdf or csv.</summary>
    [HttpGet("reports/summary")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> ReportSummary([FromQuery] string? from, [FromQuery] string? to, [FromQuery] string? format, CancellationToken ct)
    {
        var kind = (format ?? "json").ToLowerInvariant() switch
        {
            "json" => FinReportFormat.Json, "xlsx" => FinReportFormat.Excel, "pdf" => FinReportFormat.Pdf, "csv" => FinReportFormat.Csv, _ => (FinReportFormat?)null,
        };
        if (kind is null) return ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]> { ["format"] = ["Use json, xlsx, pdf or csv."] }));
        if (kind == FinReportFormat.Json) return Map(await reports.BuildAsync(from, to, ct));

        Response.Headers.CacheControl = "no-store";
        try
        {
            var file = await reportExports.ExportAsync(from, to, kind.Value, ct);
            return file.Status == 200 ? File(file.Value!.Content, file.Value.ContentType, file.Value.FileName) : Map(file);
        }
        catch (PdfTextNotSupportedException)
        {
            return Problem(statusCode: 422, title: "The PDF supports English text. Use the Excel or CSV file for names in other scripts.");
        }
    }

    // --- accounts --------------------------------------------------------------------------------------------

    [HttpGet("accounts")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> Accounts([FromQuery] bool includeInactive, CancellationToken ct) => Ok(await accounts.ListAsync(includeInactive, ct));

    [HttpPost("accounts")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> CreateAccount([FromBody] FinAccountRequest? request, CancellationToken ct) =>
        Map(await accounts.CreateAsync(request ?? new(), ct));

    [HttpPut("accounts/{id:int}")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> UpdateAccount(int id, [FromBody] FinAccountRequest? request, CancellationToken ct) =>
        Map(await accounts.UpdateAsync(id, request ?? new(), ct));

    [HttpPost("accounts/{id:int}/deactivate")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> DeactivateAccount(int id, CancellationToken ct) => Map(await accounts.SetActiveAsync(id, false, ct));

    [HttpPost("accounts/{id:int}/activate")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> ActivateAccount(int id, CancellationToken ct) => Map(await accounts.SetActiveAsync(id, true, ct));

    // --- categories ------------------------------------------------------------------------------------------

    [HttpGet("categories")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> Categories([FromQuery] string? kind, [FromQuery] bool includeInactive, CancellationToken ct) =>
        Ok(await categories.ListAsync(kind, includeInactive, ct));

    [HttpPost("categories")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> CreateCategory([FromBody] FinCategoryRequest? request, CancellationToken ct) =>
        Map(await categories.CreateAsync(request ?? new(), ct));

    [HttpPut("categories/{id:int}")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> UpdateCategory(int id, [FromBody] FinCategoryRequest? request, CancellationToken ct) =>
        Map(await categories.UpdateAsync(id, request ?? new(), ct));

    // --- expenses ---------------------------------------------------------------------------------------------

    [HttpGet("expenses")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> Expenses(
        [FromQuery] string? from, [FromQuery] string? to, [FromQuery] int? categoryId, [FromQuery] int? accountId,
        [FromQuery] decimal? min, [FromQuery] decimal? max, [FromQuery] string? q, [FromQuery] bool includeVoided, CancellationToken ct) =>
        Ok(await entries.ListAsync(FinEntryKinds.Expense, new FinEntryFilter(from, to, categoryId, accountId, min, max, q, includeVoided), ct));

    [HttpGet("expenses/{id:int}")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> Expense(int id, CancellationToken ct) => Map(await entries.GetAsync(FinEntryKinds.Expense, id, ct));

    [HttpPost("expenses")]
    [Authorize(Policy = Policies.Finance)]
    [RequestSizeLimit(30_000_000)]
    public async Task<IActionResult> CreateExpense([FromForm] FinExpenseForm? form, CancellationToken ct) =>
        Map(await entries.CreateAsync(FinEntryKinds.Expense, form ?? new(), ct));

    [HttpPut("expenses/{id:int}")]
    [Authorize(Policy = Policies.Finance)]
    [RequestSizeLimit(30_000_000)]
    public async Task<IActionResult> CorrectExpense(int id, [FromForm] FinExpenseForm? form, CancellationToken ct) =>
        Map(await entries.CorrectAsync(FinEntryKinds.Expense, id, form ?? new(), ct));

    [HttpPost("expenses/{id:int}/void")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> VoidExpense(int id, [FromBody] FinVoidRequest? request, CancellationToken ct) =>
        Map(await entries.VoidAsync(FinEntryKinds.Expense, id, request?.Reason, ct));

    [HttpGet("expenses/parties")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> ExpenseParties(CancellationToken ct) => Ok(await entries.PartiesAsync(FinEntryKinds.Expense, ct));

    // --- income -----------------------------------------------------------------------------------------------

    [HttpGet("income")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> Income(
        [FromQuery] string? from, [FromQuery] string? to, [FromQuery] int? categoryId, [FromQuery] int? accountId,
        [FromQuery] decimal? min, [FromQuery] decimal? max, [FromQuery] string? q, [FromQuery] bool includeVoided, CancellationToken ct) =>
        Ok(await entries.ListAsync(FinEntryKinds.Income, new FinEntryFilter(from, to, categoryId, accountId, min, max, q, includeVoided), ct));

    [HttpGet("income/{id:int}")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> IncomeEntry(int id, CancellationToken ct) => Map(await entries.GetAsync(FinEntryKinds.Income, id, ct));

    [HttpPost("income")]
    [Authorize(Policy = Policies.Finance)]
    [RequestSizeLimit(30_000_000)]
    public async Task<IActionResult> CreateIncome([FromForm] FinExpenseForm? form, CancellationToken ct) =>
        Map(await entries.CreateAsync(FinEntryKinds.Income, form ?? new(), ct));

    [HttpPut("income/{id:int}")]
    [Authorize(Policy = Policies.Finance)]
    [RequestSizeLimit(30_000_000)]
    public async Task<IActionResult> CorrectIncome(int id, [FromForm] FinExpenseForm? form, CancellationToken ct) =>
        Map(await entries.CorrectAsync(FinEntryKinds.Income, id, form ?? new(), ct));

    [HttpPost("income/{id:int}/void")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> VoidIncome(int id, [FromBody] FinVoidRequest? request, CancellationToken ct) =>
        Map(await entries.VoidAsync(FinEntryKinds.Income, id, request?.Reason, ct));

    [HttpGet("income/parties")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> IncomeParties(CancellationToken ct) => Ok(await entries.PartiesAsync(FinEntryKinds.Income, ct));

    [HttpGet("attachments/{id:int}")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> Attachment(int id, CancellationToken ct)
    {
        var found = await entries.OpenAttachmentAsync(id, ct);
        if (found is null) return Problem(statusCode: 404, title: "The file was not found.");
        Response.Headers.XContentTypeOptions = "nosniff";
        Response.Headers.ContentDisposition = $"inline; filename=\"receipt{Path.GetExtension(found.Value.Attachment.StoredName)}\"";
        return File(found.Value.Content, found.Value.Attachment.ContentType);
    }

    // --- month locks ------------------------------------------------------------------------------------------

    [HttpGet("month-locks")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> MonthLocks(CancellationToken ct) => Ok(await periods.ListAsync(ct));

    [HttpPost("month-locks/{month}/lock")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> LockMonth(string month, CancellationToken ct) => Map(await periods.LockAsync(month, ct));

    [HttpPost("month-locks/{month}/unlock")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> UnlockMonth(string month, [FromBody] FinVoidRequest? request, CancellationToken ct) =>
        Map(await periods.UnlockAsync(month, request?.Reason, ct));

    // --- transfers -------------------------------------------------------------------------------------------

    [HttpGet("transfers")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> Transfers(
        [FromQuery] string? from, [FromQuery] string? to, [FromQuery] int? accountId, [FromQuery] bool includeVoided, CancellationToken ct) =>
        Ok(await transfers.ListAsync(from, to, accountId, includeVoided, ct));

    [HttpPut("transfers/{id:int}")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> CorrectTransfer(int id, [FromBody] FinTransferRequest? request, CancellationToken ct) =>
        Map(await transfers.CorrectAsync(id, request ?? new(), ct));

    [HttpPost("transfers/{id:int}/void")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> VoidTransfer(int id, [FromBody] FinVoidRequest? request, CancellationToken ct) =>
        Map(await transfers.VoidAsync(id, request?.Reason, ct));

    [HttpPost("transfers")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> CreateTransfer([FromBody] FinTransferRequest? request, CancellationToken ct) =>
        Map(await transfers.CreateAsync(request ?? new(), ct));
}
