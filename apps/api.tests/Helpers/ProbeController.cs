using HrPayroll.Api.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace HrPayroll.Api.Tests.Helpers;

/// <summary>
/// Test-only endpoints, one per policy plus one with no authorization attribute at all, used to prove
/// the role matrix and the secure-by-default fallback policy. Registered by <see cref="ApiFactory"/> only.
/// </summary>
[ApiController]
[Route("api/_probe")]
public sealed class ProbeController : ControllerBase
{
    [HttpGet("any")]
    [Authorize(Policy = Policies.AnyUser)]
    public IActionResult Any() => Ok(new { probe = "any" });

    [HttpGet("supervisor")]
    [Authorize(Policy = Policies.SupervisorOrAbove)]
    public IActionResult Supervisor() => Ok(new { probe = "supervisor" });

    [HttpGet("manager")]
    [Authorize(Policy = Policies.ManagerOrAdmin)]
    public IActionResult Manager() => Ok(new { probe = "manager" });

    [HttpGet("admin")]
    [Authorize(Policy = Policies.AdminOnly)]
    public IActionResult Admin() => Ok(new { probe = "admin" });

    // Deliberately unmarked: only the fallback policy can protect this one.
    [HttpGet("unmarked")]
    public IActionResult Unmarked() => Ok(new { probe = "unmarked" });
}
