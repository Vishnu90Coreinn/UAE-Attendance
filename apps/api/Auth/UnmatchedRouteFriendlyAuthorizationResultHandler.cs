using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Policy;

namespace HrPayroll.Api.Auth;

/// <summary>
/// The fallback policy (authenticated user required) is also evaluated for requests that match no endpoint, which would
/// turn every unknown route into a 401. This handler lets those requests continue, so they end as a plain 404, and
/// leaves the default challenge/forbid behaviour for every real endpoint.
/// </summary>
public sealed class UnmatchedRouteFriendlyAuthorizationResultHandler : IAuthorizationMiddlewareResultHandler
{
    private readonly AuthorizationMiddlewareResultHandler _default = new();

    public Task HandleAsync(
        RequestDelegate next, HttpContext context, AuthorizationPolicy policy, PolicyAuthorizationResult authorizeResult) =>
        context.GetEndpoint() is null
            ? next(context)
            : _default.HandleAsync(next, context, policy, authorizeResult);
}
