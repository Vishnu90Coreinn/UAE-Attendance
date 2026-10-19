using System.Text.RegularExpressions;
using Serilog.Context;

namespace HrPayroll.Api.Middleware;

/// <summary>
/// Gives every request a correlation id: reuses a safe incoming X-Correlation-ID header,
/// otherwise generates one. The id is returned in the response, stored in HttpContext.Items
/// and attached to every log event written while the request runs.
/// </summary>
public sealed partial class CorrelationIdMiddleware(RequestDelegate next)
{
    public const string HeaderName = "X-Correlation-ID";

    [GeneratedRegex(@"^[A-Za-z0-9_-]{1,64}\z")]
    private static partial Regex SafeIdPattern();

    public async Task InvokeAsync(HttpContext context)
    {
        var incoming = context.Request.Headers[HeaderName].FirstOrDefault();
        var correlationId = incoming is not null && SafeIdPattern().IsMatch(incoming)
            ? incoming
            : Guid.NewGuid().ToString("N");

        context.Items[HeaderName] = correlationId;
        context.Response.Headers[HeaderName] = correlationId;

        using (LogContext.PushProperty("CorrelationId", correlationId))
        {
            await next(context);
        }
    }
}
