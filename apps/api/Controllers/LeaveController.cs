using HrPayroll.Api.Auth;
using HrPayroll.Api.Dtos;
using HrPayroll.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace HrPayroll.Api.Controllers;

[ApiController]
[Route("api/leave")]
public sealed class LeaveController(LeaveService leave) : ControllerBase
{
    [HttpGet]
    [Authorize(Policy = Policies.AnyUser)]
    public async Task<IActionResult> List([FromQuery] string? status, [FromQuery] string? workerId, CancellationToken ct) => Map(await leave.ListAsync(status, workerId, ct));

    [HttpPost]
    [Authorize(Policy = Policies.HrOrAdmin)]
    public async Task<IActionResult> Create(CreateLeaveRequest request, CancellationToken ct) => Map(await leave.CreateAsync(request, User.Identity!.Name!, ct));

    [HttpPost("{id:int}/approve")]
    [Authorize(Policy = Policies.HrOrAdmin)]
    public async Task<IActionResult> Approve(int id, CancellationToken ct) => Map(await leave.ChangeAsync(id, "Approved", User.Identity!.Name!, User.IsInRole(Roles.Administrator), ct));

    [HttpPost("{id:int}/reject")]
    [Authorize(Policy = Policies.HrOrAdmin)]
    public async Task<IActionResult> Reject(int id, CancellationToken ct) => Map(await leave.ChangeAsync(id, "Rejected", User.Identity!.Name!, User.IsInRole(Roles.Administrator), ct));

    [HttpDelete("{id:int}")]
    [Authorize(Policy = Policies.HrOrAdmin)]
    public async Task<IActionResult> Delete(int id, CancellationToken ct) => Map(await leave.ChangeAsync(id, null, User.Identity!.Name!, User.IsInRole(Roles.Administrator), ct));

    private IActionResult Map(LeaveResult r) => r.StatusCode switch
    {
        200 => Ok(r.Value),
        201 => StatusCode(201, r.Value),
        204 => NoContent(),
        400 => ValidationProblem(new ValidationProblemDetails(r.Errors!)),
        403 => Problem(statusCode: 403, title: "HR staff can delete only pending leave requests."),
        404 => Problem(statusCode: 404, title: "Leave request not found."),
        _ => Problem(statusCode: 409, title: "Leave overlaps another request or another change is in progress. Reload and try again."),
    };
}
