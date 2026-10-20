using HrPayroll.Api.Auth;
using HrPayroll.Api.Dtos;
using HrPayroll.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace HrPayroll.Api.Controllers;

[ApiController]
[Route("api/attendance")]
public sealed class AttendanceController(AttendanceService attendance) : ControllerBase
{
    [HttpGet]
    [Authorize(Policy = Policies.AnyUser)]
    public async Task<IActionResult> Get([FromQuery] string? date, CancellationToken ct) => Map(await attendance.GetAsync(date, ct));

    [HttpPut("{date}")]
    [Authorize(Policy = Policies.HrOrAdmin)]
    public async Task<IActionResult> Put(string date, [FromBody] List<AttendanceRequest?> rows, CancellationToken ct) => Map(await attendance.SaveAsync(date, rows, ct));

    [HttpDelete("{date}/{workerId:int}")]
    [Authorize(Policy = Policies.HrOrAdmin)]
    public async Task<IActionResult> Delete(string date, int workerId, CancellationToken ct) => Map(await attendance.DeleteAsync(date, workerId, ct));

    private IActionResult Map(AttendanceResult result) => result.StatusCode switch
    {
        200 => Ok(result.Day),
        204 => NoContent(),
        400 => ValidationProblem(new ValidationProblemDetails(result.Errors!)),
        _ => Problem(statusCode: 409, title: "Attendance cannot be changed because the month is finalised or another request changed this day. Reload and try again."),
    };
}
