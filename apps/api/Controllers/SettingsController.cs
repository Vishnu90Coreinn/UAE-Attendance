using HrPayroll.Api.Auth;
using HrPayroll.Api.Dtos;
using HrPayroll.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace HrPayroll.Api.Controllers;

[ApiController]
[Route("api/settings")]
public sealed class SettingsController(SettingsService settings) : ControllerBase
{
    [HttpGet("payroll")]
    [Authorize(Policy = Policies.AnyUser)]
    public async Task<ActionResult<PayrollSettingsResponse>> GetPayroll(CancellationToken cancellationToken) =>
        Ok(await settings.GetAsync(cancellationToken));

    /// <summary>Only the Administrator may change the company-wide payroll rules and print details.</summary>
    [HttpPut("payroll")]
    [Authorize(Policy = Policies.AdminOnly)]
    public async Task<ActionResult<PayrollSettingsResponse>> UpdatePayroll(
        PayrollSettingsRequest request, CancellationToken cancellationToken)
    {
        var result = await settings.UpdateAsync(request, cancellationToken);
        if (result.Succeeded)
        {
            return Ok(result.Settings);
        }

        var errors = result.Errors!.ToDictionary(e => e.Key, e => new[] { e.Value });
        return ValidationProblem(new ValidationProblemDetails(errors));
    }
}
