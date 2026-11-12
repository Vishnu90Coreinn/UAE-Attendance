using Microsoft.AspNetCore.Authorization;

namespace HrPayroll.Api.Auth;

/// <summary>The Viewer role is read-only: it passes a role policy for a read and never for a write.</summary>
public static class ViewerReadOnly
{
    public static bool IsRead(string method) =>
        HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method);

    /// <summary>The listed roles, or a Viewer when the request only reads.</summary>
    public static AuthorizationPolicyBuilder RequireRoleOrViewerRead(this AuthorizationPolicyBuilder policy, params string[] roles) =>
        policy.RequireAssertion(context =>
            roles.Any(context.User.IsInRole)
            || (context.User.IsInRole(Roles.Viewer) && context.Resource is HttpContext http && IsRead(http.Request.Method)));
}

/// <summary>
/// Refuses every write from a Viewer before it reaches a controller, whatever policy the endpoint uses (an endpoint open
/// to any signed-in user included). Only a Viewer's own sign-in, sign-out and password change are let through.
/// </summary>
public sealed class ViewerReadOnlyMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context)
    {
        var path = context.Request.Path;
        if (context.User.IsInRole(Roles.Viewer) && !ViewerReadOnly.IsRead(context.Request.Method) && !path.StartsWithSegments("/api/auth"))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsJsonAsync(new { title = "This account is read-only.", status = 403 });
            return;
        }
        await next(context);
    }
}
