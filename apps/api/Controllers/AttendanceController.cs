using HrPayroll.Api.Auth;
using HrPayroll.Api.Dtos;
using HrPayroll.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace HrPayroll.Api.Controllers;

[ApiController]
[Route("api/attendance")]
public sealed class AttendanceController(AttendanceService attendance, WageRedactor wages, AttendanceExportService exports) : ControllerBase
{
    [HttpGet]
    [Authorize(Policy = Policies.AnyUser)]
    public async Task<IActionResult> Get([FromQuery] string? date, CancellationToken ct) => Map(await attendance.GetAsync(date, ct));

    [HttpPut("{date}")]
    [Authorize(Policy = Policies.SupervisorOrAbove)]
    public async Task<IActionResult> Put(string date, [FromBody] List<AttendanceRequest?> rows, CancellationToken ct) => Map(await attendance.SaveAsync(date, rows, ct));

    [HttpDelete("{date}/{workerId:int}")]
    [Authorize(Policy = Policies.SupervisorOrAbove)]
    public async Task<IActionResult> Delete(string date, int workerId, CancellationToken ct) => Map(await attendance.DeleteAsync(date, workerId, ct));

    [HttpPost("{date}/approve")]
    [Authorize(Policy = Policies.ManagerOrAdmin)]
    public async Task<IActionResult> Approve(string date, [FromBody] ApproveAttendanceRequest? request, CancellationToken ct) =>
        Map(await attendance.ApproveAsync(date, request?.WorkerIds, ct));

    [HttpPost("{date}/reject")]
    [Authorize(Policy = Policies.ManagerOrAdmin)]
    public async Task<IActionResult> Reject(string date, [FromBody] RejectAttendanceRequest? request, CancellationToken ct) =>
        Map(await attendance.RejectAsync(date, request?.WorkerIds, request?.Reason, ct));

    [HttpGet("{date}/export/pdf")]
    [Authorize(Policy = Policies.AnyUser)]
    public async Task<IActionResult> ExportPdf(string date, CancellationToken ct) => await Export(date, AttendanceExportFormat.Pdf, ct);

    [HttpGet("{date}/export/excel")]
    [Authorize(Policy = Policies.AnyUser)]
    public async Task<IActionResult> ExportExcel(string date, CancellationToken ct) => await Export(date, AttendanceExportFormat.Excel, ct);

    private async Task<IActionResult> Export(string date, AttendanceExportFormat format, CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        try
        {
            var result = await exports.ExportAsync(date, format, ct);
            return result.StatusCode switch
            {
                200 => File(result.File!, result.ContentType!, result.FileName),
                400 => ValidationProblem(new ValidationProblemDetails(result.Errors!)),
                _ => Problem(statusCode: 409, title: "The attendance export is not available. Reload and try again."),
            };
        }
        catch (PdfTextNotSupportedException)
        {
            return Problem(statusCode: 422, title: "The PDF supports English text. Update names that use other scripts.");
        }
    }

    [HttpGet("summary")]
    [Authorize(Policy = Policies.AnyUser)]
    public async Task<IActionResult> Summary(CancellationToken ct) => Ok(await attendance.SummaryAsync(ct));

    private IActionResult Map(AttendanceResult result) => result.StatusCode switch
    {
        200 => Ok(wages.Apply(result.Day!)),
        204 => NoContent(),
        400 => ValidationProblem(new ValidationProblemDetails(result.Errors!)),
        _ => Problem(statusCode: 409, title: "Attendance cannot be changed because the month is finalised or another request changed this day. Reload and try again."),
    };
}
