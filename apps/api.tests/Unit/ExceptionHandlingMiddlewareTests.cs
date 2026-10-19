using System.Text.Json;
using HrPayroll.Api.Middleware;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace HrPayroll.Api.Tests.Unit;

public class ExceptionHandlingMiddlewareTests
{
    private static DefaultHttpContext NewContext()
    {
        var context = new DefaultHttpContext();
        context.Response.Body = new MemoryStream();
        context.Items[CorrelationIdMiddleware.HeaderName] = "test-correlation-id";
        return context;
    }

    private static async Task<string> ReadBodyAsync(HttpContext context)
    {
        context.Response.Body.Seek(0, SeekOrigin.Begin);
        return await new StreamReader(context.Response.Body).ReadToEndAsync();
    }

    [Fact]
    public async Task InvokeAsync_WhenNextThrows_ReturnsProblemDetailsWithoutLeakingTheMessage()
    {
        var logger = new CapturingLogger<ExceptionHandlingMiddleware>();
        var middleware = new ExceptionHandlingMiddleware(
            _ => throw new InvalidOperationException("secret connection detail"), logger);
        var context = NewContext();

        await middleware.InvokeAsync(context);

        Assert.Equal(StatusCodes.Status500InternalServerError, context.Response.StatusCode);
        Assert.StartsWith("application/problem+json", context.Response.ContentType);

        var body = await ReadBodyAsync(context);
        Assert.DoesNotContain("secret connection detail", body);
        Assert.DoesNotContain("InvalidOperationException", body);

        using var json = JsonDocument.Parse(body);
        Assert.Equal(500, json.RootElement.GetProperty("status").GetInt32());
        Assert.Equal("An unexpected error occurred.", json.RootElement.GetProperty("title").GetString());
        Assert.Equal("test-correlation-id", json.RootElement.GetProperty("correlationId").GetString());
    }

    [Fact]
    public async Task InvokeAsync_WhenNextThrows_LogsTheExceptionAsAnError()
    {
        var logger = new CapturingLogger<ExceptionHandlingMiddleware>();
        var failure = new InvalidOperationException("boom");
        var middleware = new ExceptionHandlingMiddleware(_ => throw failure, logger);

        await middleware.InvokeAsync(NewContext());

        var entry = Assert.Single(logger.Entries);
        Assert.Equal(LogLevel.Error, entry.Level);
        Assert.Same(failure, entry.Exception);
    }

    [Fact]
    public async Task InvokeAsync_WhenRequestWasAborted_DoesNotReportAnError()
    {
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        var logger = new CapturingLogger<ExceptionHandlingMiddleware>();
        var middleware = new ExceptionHandlingMiddleware(
            _ => throw new OperationCanceledException(cancellation.Token), logger);
        var context = NewContext();
        context.RequestAborted = cancellation.Token;

        await middleware.InvokeAsync(context);

        Assert.Equal(StatusCodes.Status200OK, context.Response.StatusCode);
        Assert.Empty(logger.Entries);
    }

    [Fact]
    public async Task InvokeAsync_WhenNextSucceeds_LeavesTheResponseAlone()
    {
        var logger = new CapturingLogger<ExceptionHandlingMiddleware>();
        var middleware = new ExceptionHandlingMiddleware(_ => Task.CompletedTask, logger);
        var context = NewContext();

        await middleware.InvokeAsync(context);

        Assert.Equal(StatusCodes.Status200OK, context.Response.StatusCode);
        Assert.Empty(logger.Entries);
    }
}
