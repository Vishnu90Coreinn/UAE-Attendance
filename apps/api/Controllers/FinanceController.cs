using HrPayroll.Api.Auth;
using HrPayroll.Api.Dtos;
using HrPayroll.Api.Services.Finance;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace HrPayroll.Api.Controllers;

/// <summary>Expense and income tracking: bank and cash accounts, categories and transfers. Managers and Administrators edit; the Partner reads.</summary>
[ApiController]
[Route("api/finance")]
public sealed class FinanceController(FinanceAccountService accounts, FinanceCategoryService categories, FinanceTransferService transfers) : ControllerBase
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
