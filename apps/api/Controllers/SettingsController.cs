using HrPayroll.Api.Auth;
using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Controllers;

[ApiController]
[Route("api/settings")]
public sealed class SettingsController(AppDbContext db) : ControllerBase
{
    // Read-only by design: the quote treats rule changes as change requests, so there is no write endpoint.
    [HttpGet("payroll")]
    [Authorize(Policy = Policies.AnyUser)]
    public async Task<ActionResult<PayrollSettingsResponse>> GetPayroll(CancellationToken cancellationToken)
    {
        var settings = await db.PayrollSettings.AsNoTracking()
            .SingleAsync(s => s.Id == PayrollSettings.SingletonId, cancellationToken);

        return Ok(new PayrollSettingsResponse(
            settings.CompanyName,
            settings.Tagline,
            settings.ContactEmail,
            settings.OvertimeRatePerHour,
            settings.MaxBasicHoursPerDay,
            settings.ShiftDescription,
            settings.PreparedByLabel,
            settings.ApprovedByLabel));
    }
}
