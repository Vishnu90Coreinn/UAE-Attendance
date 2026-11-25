using HrPayroll.Api.Auth;
using HrPayroll.Api.Services.Finance;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace HrPayroll.Api.Controllers;

/// <summary>The "needs attention" panel of the finance overview.</summary>
[ApiController]
[Route("api/finance/attention")]
public sealed class FinanceAttentionController(FinanceAttentionService attention) : ControllerBase
{
    [HttpGet]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> Get(CancellationToken ct) => Ok(await attention.BuildAsync(ct));
}
