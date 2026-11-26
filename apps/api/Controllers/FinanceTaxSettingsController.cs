using HrPayroll.Api.Auth;
using HrPayroll.Api.Data;
using HrPayroll.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Controllers;

public sealed record FinanceTaxPeriodSettings(int Months, int StartMonth, bool Confirmed);

[ApiController]
[Route("api/finance/tax-period")]
public sealed class FinanceTaxSettingsController(AppDbContext db, IAuditLogger audit) : ControllerBase
{
    [HttpGet]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> Get(CancellationToken ct)
    {
        var s = await db.PayrollSettings.AsNoTracking().SingleAsync(ct);
        return Ok(new FinanceTaxPeriodSettings(s.VatPeriodMonths, s.VatPeriodStartMonth, s.VatPeriodConfirmed));
    }

    [HttpPut]
    [Authorize(Roles = Roles.Administrator + "," + Roles.Manager)]
    public async Task<IActionResult> Update(FinanceTaxPeriodSettings request, CancellationToken ct)
    {
        if (request.Months is not (1 or 3) || request.StartMonth is < 1 or > 12)
            return Problem(statusCode: 400, title: "Choose a monthly or quarterly period and a start month from 1 to 12.");
        var s = await db.PayrollSettings.SingleAsync(ct);
        s.VatPeriodMonths = request.Months;
        s.VatPeriodStartMonth = request.StartMonth;
        s.VatPeriodConfirmed = request.Confirmed;
        audit.Write("FinanceTaxPeriodChanged", details: new { request.Months, request.StartMonth, request.Confirmed });
        await db.SaveChangesAsync(ct);
        return Ok(request);
    }
}
