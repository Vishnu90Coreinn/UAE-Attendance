using HrPayroll.Api.Auth;
using HrPayroll.Api.Services.Finance;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace HrPayroll.Api.Controllers;

/// <summary>The top bar's search over finance records.</summary>
[ApiController]
[Route("api/finance/search")]
public sealed class FinanceSearchController(FinanceSearchService search) : ControllerBase
{
    [HttpGet]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> Get([FromQuery] string? q, CancellationToken ct) => Ok(await search.SearchAsync(q, ct));
}
