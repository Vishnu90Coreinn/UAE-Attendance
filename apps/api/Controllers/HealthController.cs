using HrPayroll.Api.Data;
using HrPayroll.Api.Dtos;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Controllers;

[ApiController]
[Route("api/health")]
public sealed class HealthController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<HealthResponse>> Get(CancellationToken cancellationToken)
    {
        var databaseReachable = await db.Database.CanConnectAsync(cancellationToken);

        return databaseReachable
            ? Ok(new HealthResponse("ok", "ok"))
            : StatusCode(StatusCodes.Status503ServiceUnavailable, new HealthResponse("degraded", "unreachable"));
    }
}
