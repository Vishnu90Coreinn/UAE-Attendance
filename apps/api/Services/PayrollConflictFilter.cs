using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace HrPayroll.Api.Services;

public sealed class PayrollConflictFilter : IExceptionFilter
{
    public void OnException(ExceptionContext context)
    {
        if (!PayrollPeriodLock.IsConflict(context.Exception)) return;
        context.Result = new ObjectResult(new ProblemDetails { Status = 409, Title = "Payroll is busy. Reload and try again." }) { StatusCode = 409 };
        context.ExceptionHandled = true;
    }
}
