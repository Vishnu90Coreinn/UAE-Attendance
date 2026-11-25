using HrPayroll.Api.Auth;
using HrPayroll.Api.Dtos;
using HrPayroll.Api.Services.Finance;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace HrPayroll.Api.Controllers;

/// <summary>The books: chart of accounts, ledger, journals, trial balance and the safety checks. Managers and Administrators and the read-only Partner see them.</summary>
[ApiController]
[Route("api/finance/ledger")]
public sealed class LedgerController(FinanceLedgerService ledger) : ControllerBase
{
    private static DateOnly? Date(string? text) => FinanceRules.TryParseDate(text, out var d) ? d : null;

    [HttpGet("accounts")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> Chart([FromQuery] string? asOf, CancellationToken ct) => Ok(await ledger.ChartAsync(Date(asOf), ct));

    [HttpGet("trial-balance")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> TrialBalance([FromQuery] string? asOf, CancellationToken ct) => Ok(await ledger.TrialBalanceAsync(Date(asOf), ct));

    [HttpGet("accounts/{id:int}/statement")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> Statement(int id, [FromQuery] string? from, [FromQuery] string? to, CancellationToken ct)
    {
        var result = await ledger.StatementAsync(id, from, to, ct);
        return result.Status switch
        {
            200 => Ok(result.Value),
            400 => ValidationProblem(new ValidationProblemDetails(result.Errors!)),
            404 => Problem(statusCode: 404, title: result.Title),
            _ => Problem(statusCode: result.Status, title: result.Title),
        };
    }

    [HttpGet("journals")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> Journals([FromQuery] string? from, [FromQuery] string? to, [FromQuery] string? source, [FromQuery] int? sourceId, CancellationToken ct) =>
        Ok(await ledger.JournalsAsync(from, to, source, sourceId, ct));

    /// <summary>Whether the ledger agrees with the finance screens, account by account and partner by partner.</summary>
    [HttpGet("check")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> Check(CancellationToken ct) => Ok(await ledger.CheckAsync(ct));

    [HttpPost("sync")]
    [Authorize(Policy = Policies.Finance)]
    public async Task<IActionResult> Sync(CancellationToken ct) => Ok(await ledger.SyncAsync(ct));

    /// <summary>Administrator only: derive every journal again, for when the mapping changed before the books went live.</summary>
    [HttpPost("rebuild")]
    [Authorize(Policy = Policies.AdminOnly)]
    public async Task<IActionResult> Rebuild(CancellationToken ct)
    {
        var result = await ledger.RebuildAsync(ct);
        return result.Status == 200 ? Ok(result.Value) : Problem(statusCode: result.Status, title: result.Title);
    }
}
