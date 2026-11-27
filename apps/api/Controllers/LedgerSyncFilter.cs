using HrPayroll.Api.Services.Finance;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace HrPayroll.Api.Controllers;

/// <summary>
/// After a finance write succeeds, brings the ledger up to date. If synchronization fails after the source is
/// saved, log it for recovery through the explicit Books sync or at the next startup.
/// </summary>
public sealed class LedgerSyncFilter(FinanceLedgerService ledger, IHostApplicationLifetime lifetime, ILogger<LedgerSyncFilter> log) : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var executed = await next();
        var method = context.HttpContext.Request.Method;
        if (HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || executed.Exception is not null) return;
        if (context.Controller is FinanceController && context.ActionArguments.TryGetValue("commit", out var commit) && commit is false) return;
        var status = executed.Result switch { ObjectResult o => o.StatusCode ?? 200, StatusCodeResult s => s.StatusCode, FileResult => 200, _ => 200 };
        if (status is < 200 or >= 300) return;
        try
        {
            await ledger.SyncAsync(lifetime.ApplicationStopping);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "The ledger could not be brought up to date after a finance change. Run the explicit Books sync.");
        }
    }
}
