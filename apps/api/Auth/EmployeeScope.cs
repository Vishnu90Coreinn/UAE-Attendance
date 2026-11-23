namespace HrPayroll.Api.Auth;

/// <summary>
/// An account with the Employee role may use only its own sign-in, attendance and leave pages and the sign-in, password and
/// phone-notification endpoints. Every other endpoint is refused before it reaches a controller, including those open to any signed-in user.
/// </summary>
public sealed class EmployeeScopeMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context)
    {
        var path = context.Request.Path;
        if (context.User.IsInRole(Roles.Employee)
            && !path.StartsWithSegments("/api/auth")
            && !path.StartsWithSegments("/api/staff/me")
            && !path.StartsWithSegments("/api/staff/punches")
            && !path.StartsWithSegments("/api/push")
            && !path.StartsWithSegments("/api/health"))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsJsonAsync(new { title = "This account can only use its own attendance and leave.", status = 403 });
            return;
        }

        await next(context);
    }
}
