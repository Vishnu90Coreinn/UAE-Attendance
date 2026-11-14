using System.Security.Claims;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Dtos;
using HrPayroll.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace HrPayroll.Api.Controllers;

/// <summary>
/// The certificate workflow. A Supervisor (or above) raises a request and sees the ones they raised; HR (or the
/// Administrator) adds the details and sends it for approval; a Manager (or the Administrator) approves or sends it back.
/// </summary>
[ApiController]
[Route("api/certificate-requests")]
public sealed class CertificateRequestsController(CertificateRequestService requests) : ControllerBase
{
    [HttpPost]
    [Authorize(Policy = Policies.SupervisorOrAbove)]
    public async Task<IActionResult> Create(CertificateRequestCreate request, CancellationToken ct) => Map(await requests.CreateAsync(request, ct));

    /// <summary>Everyone who may see requests; a Supervisor only sees the ones they raised.</summary>
    [HttpGet]
    [Authorize(Policy = Policies.AnyUser)]
    public async Task<IActionResult> List([FromQuery] string? status, CancellationToken ct)
    {
        var supervisorOnly = User.IsInRole(Roles.Supervisor) ? User.Identity?.Name ?? "" : null;
        return Ok(await requests.ListAsync(status, supervisorOnly, ct));
    }

    [HttpGet("{id:int}")]
    [Authorize(Policy = Policies.ManagerAdminOrHr)]
    public async Task<IActionResult> Get(int id, CancellationToken ct) => Map(await requests.GetAsync(id, ct));

    // HR and the Administrator prepare any request; a Manager may prepare only a request they raised themselves
    // (the service refuses the rest).
    [HttpPut("{id:int}/details")]
    [Authorize(Policy = Policies.ManagerAdminOrHr)]
    public async Task<IActionResult> SaveDetails(int id, LetterRequest details, CancellationToken ct) => Map(await requests.SaveDetailsAsync(id, details, ct));

    [HttpPost("{id:int}/submit")]
    [Authorize(Policy = Policies.ManagerAdminOrHr)]
    public async Task<IActionResult> Submit(int id, CancellationToken ct) => Map(await requests.SubmitAsync(id, ct));

    [HttpPost("{id:int}/approve")]
    [Authorize(Policy = Policies.ManagerOrAdmin)]
    public async Task<IActionResult> Approve(int id, CancellationToken ct) => Map(await requests.ApproveAsync(id, ct));

    [HttpPost("{id:int}/reject")]
    [Authorize(Policy = Policies.ManagerOrAdmin)]
    public async Task<IActionResult> Reject(int id, CertificateRejectRequest request, CancellationToken ct) => Map(await requests.RejectAsync(id, request.Reason, ct));

    private IActionResult Map(LetterResult r) => r.StatusCode switch
    {
        200 => Ok(r.Body),
        201 => StatusCode(201, r.Body),
        400 => ValidationProblem(new ValidationProblemDetails(r.Errors!)),
        403 => Problem(statusCode: 403, title: r.Message ?? "You cannot prepare this request."),
        404 => Problem(statusCode: 404, title: "Request not found."),
        _ => Problem(statusCode: 409, title: r.Message ?? "The request could not be changed. Reload and try again."),
    };
}
