using HrPayroll.Api.Auth;
using HrPayroll.Api.Dtos;
using HrPayroll.Api.Services.Finance;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace HrPayroll.Api.Controllers;

/// <summary>Supplier bills: what the company owes and has paid. Managers and Administrators.</summary>
[ApiController]
[ServiceFilter(typeof(LedgerSyncFilter))]
[Route("api/finance/bills")]
public sealed class FinanceBillsController(FinanceBillService bills) : ControllerBase
{
    private IActionResult Map<T>(FinResult<T> result) => result.Status switch
    {
        200 => Ok(result.Value),
        201 => StatusCode(201, result.Value),
        400 => ValidationProblem(new ValidationProblemDetails(result.Errors!)),
        404 => Problem(statusCode: 404, title: result.Title ?? "Not found."),
        _ => Problem(statusCode: result.Status, title: result.Title),
    };

    [HttpGet]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> List([FromQuery] string? status, [FromQuery] string? q, CancellationToken ct) => Ok(await bills.ListAsync(status, q, ct));

    [HttpGet("{id:int}")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> Get(int id, CancellationToken ct) => Map(await bills.GetAsync(id, ct));

    [HttpPost]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> Create([FromBody] FinBillRequest? request, CancellationToken ct) => Map(await bills.CreateAsync(request ?? new(), ct));

    [HttpPost("{id:int}/pay")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> Pay(int id, [FromBody] FinBillPayRequest? request, CancellationToken ct) => Map(await bills.PayAsync(id, request ?? new(), ct));

    [HttpPost("{id:int}/payments/{entryId:int}/remove")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> RemovePayment(int id, int entryId, [FromBody] FinVoidRequest? request, CancellationToken ct) => Map(await bills.RemovePaymentAsync(id, entryId, request?.Reason, ct));

    [HttpPost("{id:int}/void")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> Void(int id, [FromBody] FinVoidRequest? request, CancellationToken ct) => Map(await bills.VoidAsync(id, request?.Reason, ct));
}
