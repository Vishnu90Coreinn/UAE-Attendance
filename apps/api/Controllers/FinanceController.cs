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
[ServiceFilter(typeof(LedgerSyncFilter))]
[Route("api/finance")]
public sealed class FinanceController(FinanceAccountService accounts, FinanceCategoryService categories, FinanceTransferService transfers, FinanceEntryService entries, FinancePeriodService periods, FinanceDashboardService dashboard, FinanceReportService reports, FinanceReportExportService reportExports, FinancePartnerService partners, FinancePayeeService payees, FinanceChequeService cheques, FinanceSubmitterService submitters, FinanceImportService imports) : ControllerBase
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

    // --- Excel import ---------------------------------------------------------------------------------------

    private static string? ImportKind(string kind) => kind switch { "expenses" => FinEntryKinds.Expense, "income" => FinEntryKinds.Income, _ => null };

    [HttpGet("import/{kind}/template")]
    [Authorize(Policy = Policies.Finance)]
    public IActionResult ImportTemplate(string kind) =>
        ImportKind(kind) is { } k
            ? File(FinanceImportService.Template(k), AttendanceExportService.ExcelType, $"{(k == FinEntryKinds.Income ? "Income" : "Expenses")}_import_template.xlsx")
            : Problem(statusCode: 404, title: "Import expenses or income.");

    /// <summary>Checks an uploaded Excel file row by row; with <c>commit=true</c> it also saves every good row, or none if any row is wrong.</summary>
    [HttpPost("import/{kind}")]
    [Authorize(Policy = Policies.Finance)]
    [RequestSizeLimit(6_000_000)]
    public async Task<IActionResult> Import(string kind, [FromForm] IFormFile? file, [FromQuery] bool commit, CancellationToken ct)
    {
        if (ImportKind(kind) is not { } k) return Problem(statusCode: 404, title: "Import expenses or income.");
        if (file is null || file.Length == 0) return ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]> { ["file"] = ["Choose the Excel file."] }));
        if (file.Length > FinanceImportService.MaxBytes) return ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]> { ["file"] = ["The file is larger than 5 MB."] }));
        await using var stream = file.OpenReadStream();
        return Map(await imports.RunAsync(k, stream, commit, ct));
    }

    // --- staff who may submit expenses, and approving what they submit ----------------------------------------

    [HttpGet("submitters")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> Submitters(CancellationToken ct) => Ok(await submitters.ListAsync(ct));

    [HttpPut("submitters/{userId:int}")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> SetSubmitter(int userId, [FromBody] FinSubmitterRequest? request, CancellationToken ct) => Map(await submitters.SetAsync(userId, request ?? new(), ct));

    [HttpPost("expenses/{id:int}/approve")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> ApproveExpense(int id, CancellationToken ct) => Map(await entries.ApproveAsync(id, ct));

    [HttpPost("expenses/{id:int}/reject")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> RejectExpense(int id, [FromBody] FinVoidRequest? request, CancellationToken ct) => Map(await entries.RejectAsync(id, request?.Reason, ct));

    // --- cheque register -------------------------------------------------------------------------------------

    [HttpGet("cheques")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> Cheques(
        [FromQuery] string? direction, [FromQuery] string? status, [FromQuery] bool openOnly, [FromQuery] string? from, [FromQuery] string? to,
        [FromQuery] int? accountId, [FromQuery] string? q, CancellationToken ct) =>
        Ok(await cheques.ListAsync(new FinChequeFilter(direction, status, openOnly, from, to, accountId, q), ct));

    [HttpGet("cheques/summary")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> ChequeSummary(CancellationToken ct) => Ok(await cheques.SummaryAsync(ct));

    [HttpGet("cheques/{id:int}")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> Cheque(int id, CancellationToken ct) => Map(await cheques.GetAsync(id, ct));

    [HttpPost("cheques")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> CreateCheque([FromBody] FinChequeRequest? request, CancellationToken ct) => Map(await cheques.CreateAsync(request ?? new(), ct));

    [HttpPut("cheques/{id:int}")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> UpdateCheque(int id, [FromBody] FinChequeRequest? request, CancellationToken ct) => Map(await cheques.UpdateAsync(id, request ?? new(), ct));

    [HttpPost("cheques/{id:int}/status")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> ChequeStatus(int id, [FromBody] FinChequeStatusRequest? request, CancellationToken ct) => Map(await cheques.ChangeStatusAsync(id, request ?? new(), ct));

    // --- payees: the people and companies paid or received from -----------------------------------------------

    [HttpGet("payees")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> Payees([FromQuery] string? kind, [FromQuery] bool includeInactive, CancellationToken ct) => Ok(await payees.ListAsync(kind, includeInactive, ct));

    [HttpPost("payees")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> CreatePayee([FromBody] FinPayeeRequest? request, CancellationToken ct) => Map(await payees.CreateAsync(request ?? new(), ct));

    [HttpPut("payees/{id:int}")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> UpdatePayee(int id, [FromBody] FinPayeeRequest? request, CancellationToken ct) => Map(await payees.UpdateAsync(id, request ?? new(), ct));

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
    public async Task<IActionResult> ReportSummary([FromQuery] string? from, [FromQuery] string? to, [FromQuery] string? format, [FromQuery] string? granularity, CancellationToken ct)
    {
        var kind = (format ?? "json").ToLowerInvariant() switch
        {
            "json" => FinReportFormat.Json, "xlsx" => FinReportFormat.Excel, "pdf" => FinReportFormat.Pdf, "csv" => FinReportFormat.Csv, _ => (FinReportFormat?)null,
        };
        if (kind is null) return ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]> { ["format"] = ["Use json, xlsx, pdf or csv."] }));
        if (kind == FinReportFormat.Json) return Map(await reports.BuildAsync(from, to, ct, granularity));

        Response.Headers.CacheControl = "no-store";
        try
        {
            var file = await reportExports.ExportAsync(from, to, kind.Value, ct, granularity);
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
        [FromQuery] decimal? min, [FromQuery] decimal? max, [FromQuery] string? q, [FromQuery] bool includeVoided, [FromQuery] int? payeeId, CancellationToken ct) =>
        Ok(await entries.ListAsync(FinEntryKinds.Expense, new FinEntryFilter(from, to, categoryId, accountId, min, max, q, includeVoided, null, payeeId), ct));

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
        [FromQuery] decimal? min, [FromQuery] decimal? max, [FromQuery] string? q, [FromQuery] bool includeVoided, [FromQuery] int? payeeId, CancellationToken ct) =>
        Ok(await entries.ListAsync(FinEntryKinds.Income, new FinEntryFilter(from, to, categoryId, accountId, min, max, q, includeVoided, null, payeeId), ct));

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
