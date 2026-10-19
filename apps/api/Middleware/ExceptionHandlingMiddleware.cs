using Microsoft.AspNetCore.Mvc;

namespace HrPayroll.Api.Middleware;

/// <summary>
/// Last line of defence for unexpected exceptions: logs the full exception and returns a generic
/// RFC 9457 problem document carrying only the correlation id. Nothing about the failure
/// (message, type, stack trace) is sent to the client.
/// </summary>
public sealed class ExceptionHandlingMiddleware(RequestDelegate next, ILogger<ExceptionHandlingMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await next(context);
        }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
        {
            // The client went away; there is nobody to answer and nothing to report.
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Unhandled exception for {Method} {Path}",
                context.Request.Method, context.Request.Path);

            if (context.Response.HasStarted)
            {
                throw;
            }

            var problem = new ProblemDetails
            {
                Status = StatusCodes.Status500InternalServerError,
                Title = "An unexpected error occurred.",
                Type = "https://www.rfc-editor.org/rfc/rfc9110#section-15.6.1",
            };

            if (context.Items.TryGetValue(CorrelationIdMiddleware.HeaderName, out var correlationId))
            {
                problem.Extensions["correlationId"] = correlationId;
            }

            context.Response.StatusCode = StatusCodes.Status500InternalServerError;
            await context.Response.WriteAsJsonAsync(
                problem, options: null, contentType: "application/problem+json");
        }
    }
}
