using HrPayroll.Api.Auth;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using HrPayroll.Api.Services.Finance;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace HrPayroll.Api.Controllers;

/// <summary>Expense and income tracking: bank and cash accounts, categories and transfers. Managers and Administrators edit; the Partner reads.</summary>
[ApiController]
[Route("api/finance")]
public sealed class FinanceController(FinanceAccountService accounts, FinanceCategoryService categories, FinanceTransferService transfers, FinanceEntryService entries) : ControllerBase
{
    private IActionResult Map<T>(FinResult<T> result) => result.Status switch
    {
        200 => Ok(result.Value),
        201 => StatusCode(201, result.Value),
        400 => ValidationProblem(new ValidationProblemDetails(result.Errors!)),
        404 => Problem(statusCode: 404, title: result.Title ?? "Not found."),
        _ => Problem(statusCode: result.Status, title: result.Title),
    };

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

    [HttpGet("expenses/parties")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> ExpenseParties(CancellationToken ct) => Ok(await entries.PartiesAsync(FinEntryKinds.Expense, ct));

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

    // --- transfers -------------------------------------------------------------------------------------------

    [HttpGet("transfers")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> Transfers(
        [FromQuery] string? from, [FromQuery] string? to, [FromQuery] int? accountId, [FromQuery] bool includeVoided, CancellationToken ct) =>
        Ok(await transfers.ListAsync(from, to, accountId, includeVoided, ct));

    [HttpPost("transfers")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> CreateTransfer([FromBody] FinTransferRequest? request, CancellationToken ct) =>
        Map(await transfers.CreateAsync(request ?? new(), ct));
}
