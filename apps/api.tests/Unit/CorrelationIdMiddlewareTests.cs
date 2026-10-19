using HrPayroll.Api.Middleware;
using Microsoft.AspNetCore.Http;

namespace HrPayroll.Api.Tests.Unit;

public class CorrelationIdMiddlewareTests
{
    private static async Task<DefaultHttpContext> InvokeAsync(string? incomingId)
    {
        var context = new DefaultHttpContext();
        if (incomingId is not null)
        {
            context.Request.Headers[CorrelationIdMiddleware.HeaderName] = incomingId;
        }

        var middleware = new CorrelationIdMiddleware(_ => Task.CompletedTask);
        await middleware.InvokeAsync(context);
        return context;
    }

    [Fact]
    public async Task InvokeAsync_WithoutIncomingHeader_GeneratesIdAndReturnsItInResponse()
    {
        var context = await InvokeAsync(null);

        var responseId = context.Response.Headers[CorrelationIdMiddleware.HeaderName].ToString();
        Assert.False(string.IsNullOrWhiteSpace(responseId));
        Assert.Equal(responseId, context.Items[CorrelationIdMiddleware.HeaderName]);
    }

    [Fact]
    public async Task InvokeAsync_WithValidIncomingHeader_KeepsIt()
    {
        var context = await InvokeAsync("abc-123_XYZ");

        Assert.Equal("abc-123_XYZ", context.Response.Headers[CorrelationIdMiddleware.HeaderName].ToString());
        Assert.Equal("abc-123_XYZ", context.Items[CorrelationIdMiddleware.HeaderName]);
    }

    [Theory]
    [InlineData("")]
    [InlineData("has space")]
    [InlineData("line\r\nbreak")]
    [InlineData("<script>")]
    [InlineData("trailing-newline\n")]
    public async Task InvokeAsync_WithUnsafeIncomingHeader_ReplacesIt(string unsafeId)
    {
        var context = await InvokeAsync(unsafeId);

        var responseId = context.Response.Headers[CorrelationIdMiddleware.HeaderName].ToString();
        Assert.NotEqual(unsafeId, responseId);
        Assert.Matches(@"^[A-Za-z0-9_-]{1,64}\z", responseId);
    }

    [Fact]
    public async Task InvokeAsync_WithOverlongIncomingHeader_ReplacesIt()
    {
        var overlong = new string('a', 65);

        var context = await InvokeAsync(overlong);

        Assert.NotEqual(overlong, context.Response.Headers[CorrelationIdMiddleware.HeaderName].ToString());
    }
}
