using HrPayroll.Api.Auth;
using HrPayroll.Api.Dtos;
using HrPayroll.Api.Services;
using HrPayroll.Api.Services.Push;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace HrPayroll.Api.Controllers;

[ApiController]
[Route("api/attendance")]
public sealed class AttendanceController(AttendanceService attendance, WageRedactor wages, AttendanceExportService exports, IPushNotifier push) : ControllerBase
{
    [HttpGet]
    [Authorize(Policy = Policies.AnyUser)]
    public async Task<IActionResult> Get([FromQuery] string? date, CancellationToken ct) => Map(await attendance.GetAsync(date, ct));

    [HttpPut("{date}")]
    [Authorize(Policy = Policies.SupervisorOrAbove)]
    public async Task<IActionResult> Put(string date, [FromBody] List<AttendanceRequest?> rows, CancellationToken ct)
    {
        var result = await attendance.SaveAsync(date, rows, ct);
        // A supervisor sending entries for approval tells the managers there is something waiting.
        if (result is { StatusCode: 200, SubmittedForApproval: > 0 })
            await push.NotifyRolesAsync([Roles.Manager, Roles.Administrator],
                new("Attendance submitted", $"{User.Identity?.Name} submitted attendance for {date} ({result.SubmittedForApproval} {(result.SubmittedForApproval == 1 ? "worker" : "workers")}).", "/attendance"), CurrentUserId(), ct);
        return Map(result);
    }

    private int? CurrentUserId() =>
        int.TryParse(User.FindFirst("sub")?.Value ?? User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value, out var id) ? id : null;

    [HttpDelete("{date}/{workerId:int}")]
    [Authorize(Policy = Policies.SupervisorOrAbove)]
    public async Task<IActionResult> Delete(string date, int workerId, CancellationToken ct) => Map(await attendance.DeleteAsync(date, workerId, ct));

    [HttpPost("{date}/approve")]
    [Authorize(Policy = Policies.ManagerOrAdmin)]
    public async Task<IActionResult> Approve(string date, [FromBody] ApproveAttendanceRequest? request, CancellationToken ct) =>
        Map(await attendance.ApproveAsync(date, request?.WorkerIds, ct));

    [HttpPost("{date}/reject")]
    [Authorize(Policy = Policies.ManagerOrAdmin)]
    public async Task<IActionResult> Reject(string date, [FromBody] RejectAttendanceRequest? request, CancellationToken ct)
    {
        var result = await attendance.RejectAsync(date, request?.WorkerIds, request?.Reason, ct);
        // Each supervisor whose entries were sent back hears why, so they can correct and resubmit.
        if (result is { StatusCode: 200, RejectedBySubmitter: { } rejected })
            foreach (var (username, count) in rejected)
                await push.NotifyUsernameAsync(username,
                    new("Attendance sent back", $"{date}: {count} {(count == 1 ? "entry was" : "entries were")} rejected. {request?.Reason?.Trim()}", "/attendance"), ct);
        return Map(result);
    }

    [HttpGet("{date}/export/pdf")]
    [Authorize(Policy = Policies.AnyUser)]
    public async Task<IActionResult> ExportPdf(string date, CancellationToken ct) => await Export(date, AttendanceExportFormat.Pdf, ct);

    [HttpGet("{date}/export/excel")]
    [Authorize(Policy = Policies.AnyUser)]
    public async Task<IActionResult> ExportExcel(string date, CancellationToken ct) => await Export(date, AttendanceExportFormat.Excel, ct);

    [HttpGet("export/{format}")]
    [Authorize(Policy = Policies.AnyUser)]
    public async Task<IActionResult> ExportRange(string format, [FromQuery] string? from, [FromQuery] string? to, CancellationToken ct) =>
        format switch
        {
            "pdf" => await Export(from, to, AttendanceExportFormat.Pdf, ct),
            "excel" => await Export(from, to, AttendanceExportFormat.Excel, ct),
            _ => NotFound(),
        };

    private Task<IActionResult> Export(string date, AttendanceExportFormat format, CancellationToken ct) =>
        Export(() => exports.ExportAsync(date, format, ct));

    private Task<IActionResult> Export(string? from, string? to, AttendanceExportFormat format, CancellationToken ct) =>
        Export(() => exports.ExportRangeAsync(from, to, format, ct));

    private async Task<IActionResult> Export(Func<Task<AttendanceExportResult>> run)
    {
        Response.Headers.CacheControl = "no-store";
        try
        {
            var result = await run();
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

    /// <summary>Head-counts per day for the dashboard chart: one request instead of a full attendance sheet per day.</summary>
    [HttpGet("trend")]
    [Authorize(Policy = Policies.AnyUser)]
    public async Task<IActionResult> Trend([FromQuery] string? to, [FromQuery] int days = 7, CancellationToken ct = default)
    {
        var result = await attendance.TrendAsync(to, days, ct);
        return result.StatusCode == 200 ? Ok(result.Value) : ValidationProblem(new ValidationProblemDetails(result.Errors!));
    }

    private IActionResult Map(AttendanceResult result) => result.StatusCode switch
    {
        200 => Ok(wages.Apply(result.Day!)),
        204 => NoContent(),
        400 => ValidationProblem(new ValidationProblemDetails(result.Errors!)),
        _ => Problem(statusCode: 409, title: "Attendance cannot be changed because the month is finalised or another request changed this day. Reload and try again."),
    };
}
