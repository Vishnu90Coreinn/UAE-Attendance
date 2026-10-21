using HrPayroll.Api.Auth;
using HrPayroll.Api.Dtos;
using HrPayroll.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace HrPayroll.Api.Controllers;

[ApiController]
[Route("api/deductions")]
[Authorize(Policy = Policies.ManagerOrAdmin)]
public sealed class DeductionsController(DeductionService deductions) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> Get([FromQuery] string? month, CancellationToken ct)
    {
        if (!PayrollService.TryMonth(month, out var start)) return ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]>
        { ["month"] = ["Choose a month in YYYY-MM format."] }));
        return Map(await deductions.GetMonthAsync(start, ct));
    }

    [HttpPut("{month}")]
    public async Task<IActionResult> Save(string month, [FromBody] MonthDeductionsSaveRequest? request, CancellationToken ct)
    {
        if (!PayrollService.TryMonth(month, out var start)) return ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]>
        { ["month"] = ["Choose a month in YYYY-MM format."] }));
        return Map(await deductions.SaveMonthAsync(start, request ?? new(), ct));
    }

    internal IActionResult Map(DeductionResult result) => result.StatusCode switch
    {
        200 or 201 => StatusCode(result.StatusCode, result.Body),
        400 => ValidationProblem(new ValidationProblemDetails(result.Errors!)),
        404 => NotFound(),
        _ => Problem(statusCode: 409, title: result.Message ?? "The change conflicts with the current data. Reload and try again."),
    };
}
