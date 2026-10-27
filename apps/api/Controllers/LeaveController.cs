using HrPayroll.Api.Auth;
using HrPayroll.Api.Dtos;
using HrPayroll.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace HrPayroll.Api.Controllers;

[ApiController]
[Route("api/leave")]
public sealed class LeaveController(LeaveService leave, LeaveBalanceService balances, LeaveExportService exports) : ControllerBase
{
    /// <summary>Leave requests that touch one month (<c>month=yyyy-MM</c>), for everyone or one worker, as a PDF or Excel file.</summary>
    [HttpGet("export/{format:regex(^(pdf|excel)$)}")]
    [Authorize(Policy = Policies.AnyUser)]
    public async Task<IActionResult> Export(string format, [FromQuery] string? month, [FromQuery] string? workerId, CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        try
        {
            var result = await exports.ExportAsync(month, workerId, format == "pdf" ? AttendanceExportFormat.Pdf : AttendanceExportFormat.Excel, ct);
            return result.StatusCode == 200
                ? File(result.File!, result.ContentType!, result.FileName)
                : ValidationProblem(new ValidationProblemDetails(result.Errors!));
        }
        catch (PdfTextNotSupportedException)
        {
            return Problem(statusCode: 422, title: "The PDF supports English text. Update names that use other scripts.");
        }
    }

    /// <summary>Paid-leave allowance, used and remaining days per active worker for their current year.</summary>
    [HttpGet("balances")]
    [Authorize(Policy = Policies.AnyUser)]
    public async Task<IActionResult> Balances(CancellationToken ct) => Ok(await balances.ListAsync(ct));

    [HttpGet]
    [Authorize(Policy = Policies.AnyUser)]
    public async Task<IActionResult> List([FromQuery] string? status, [FromQuery] string? workerId, CancellationToken ct) => Map(await leave.ListAsync(status, workerId, ct));

    /// <summary>Supervisors raise leave; the Manager decides it.</summary>
    [HttpPost]
    [Authorize(Policy = Policies.SupervisorOrAbove)]
    public async Task<IActionResult> Create(CreateLeaveRequest request, CancellationToken ct) => Map(await leave.CreateAsync(request, User.Identity!.Name!, ct));

    /// <summary>The photo of the leave request or doctor's note, when one was attached.</summary>
    [HttpGet("{id:int}/attachment")]
    [Authorize(Policy = Policies.AnyUser)]
    public async Task<IActionResult> Attachment(int id, CancellationToken ct)
    {
        var photo = await leave.GetAttachmentAsync(id, ct);
        if (photo is null) return Problem(statusCode: 404, title: "No photo is attached to this leave request.");
        Response.Headers.CacheControl = "private, no-store";
        return File(photo.Data, photo.ContentType);
    }

    /// <summary>Only a Manager or the Administrator decides leave, so a supervisor can never approve even their own request.</summary>
    [HttpPost("{id:int}/approve")]
    [Authorize(Policy = Policies.ManagerOrAdmin)]
    public async Task<IActionResult> Approve(int id, CancellationToken ct) => Map(await leave.ChangeAsync(id, "Approved", User.Identity!.Name!, CanDeleteAny(), ct));

    [HttpPost("{id:int}/reject")]
    [Authorize(Policy = Policies.ManagerOrAdmin)]
    public async Task<IActionResult> Reject(int id, CancellationToken ct) => Map(await leave.ChangeAsync(id, "Rejected", User.Identity!.Name!, CanDeleteAny(), ct));

    /// <summary>A Manager or the Administrator deletes any request; a supervisor only their own request while it is pending.</summary>
    [HttpDelete("{id:int}")]
    [Authorize(Policy = Policies.SupervisorOrAbove)]
    public async Task<IActionResult> Delete(int id, CancellationToken ct) => Map(await leave.ChangeAsync(id, null, User.Identity!.Name!, CanDeleteAny(), ct));

    private bool CanDeleteAny() => User.IsInRole(Roles.Manager) || User.IsInRole(Roles.Administrator);

    private IActionResult Map(LeaveResult r) => r.StatusCode switch
    {
        200 => Ok(r.Value),
        201 => StatusCode(201, r.Value),
        204 => NoContent(),
        400 => ValidationProblem(new ValidationProblemDetails(r.Errors!)),
        403 => Problem(statusCode: 403, title: "You can delete only your own pending leave requests."),
        404 => Problem(statusCode: 404, title: "Leave request not found."),
        _ => Problem(statusCode: 409, title: r.Value as string ?? "Leave overlaps another request or another change is in progress. Reload and try again."),
    };
}
