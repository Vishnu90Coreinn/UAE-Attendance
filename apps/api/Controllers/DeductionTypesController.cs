using HrPayroll.Api.Auth;
using HrPayroll.Api.Dtos;
using HrPayroll.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace HrPayroll.Api.Controllers;

[ApiController]
[Route("api/deduction-types")]
[Authorize(Policy = Policies.ManagerOrAdmin)]
public sealed class DeductionTypesController(DeductionService deductions) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> Get(CancellationToken ct) => Ok(await deductions.ListTypesAsync(ct));

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] DeductionTypeRequest? request, CancellationToken ct) =>
        Map(await deductions.CreateTypeAsync(request ?? new(), ct));

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] DeductionTypeRequest? request, CancellationToken ct) =>
        Map(await deductions.UpdateTypeAsync(id, request ?? new(), ct));

    private IActionResult Map(DeductionResult result) => result.StatusCode switch
    {
        200 or 201 => StatusCode(result.StatusCode, result.Body),
        400 => ValidationProblem(new ValidationProblemDetails(result.Errors!)),
        404 => NotFound(),
        _ => Problem(statusCode: 409, title: result.Message ?? "The change conflicts with the current data. Reload and try again."),
    };
}
