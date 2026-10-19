using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using HrPayroll.Api.Middleware;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.Data.SqlClient;

namespace HrPayroll.Api.Tests.Integration;

public class HealthEndpointTests(TestDatabase database) : IClassFixture<TestDatabase>
{
    [Fact]
    public async Task Get_WhenDatabaseIsReachable_ReturnsOk()
    {
        await using var factory = new ApiFactory(database.ConnectionString);
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/api/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("ok", body.GetProperty("status").GetString());
        Assert.Equal("ok", body.GetProperty("database").GetString());
    }

    [Fact]
    public async Task Get_WithoutCorrelationIdHeader_ReturnsAGeneratedOne()
    {
        await using var factory = new ApiFactory(database.ConnectionString);
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/api/health");

        Assert.True(response.Headers.TryGetValues(CorrelationIdMiddleware.HeaderName, out var values));
        Assert.False(string.IsNullOrWhiteSpace(values!.Single()));
    }

    [Fact]
    public async Task Get_WithCorrelationIdHeader_EchoesIt()
    {
        await using var factory = new ApiFactory(database.ConnectionString);
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/health");
        request.Headers.Add(CorrelationIdMiddleware.HeaderName, "from-the-client-1");

        var response = await client.SendAsync(request);

        Assert.Equal("from-the-client-1", response.Headers.GetValues(CorrelationIdMiddleware.HeaderName).Single());
    }

    [Fact]
    public async Task Get_WhenDatabaseIsUnreachable_ReturnsServiceUnavailableWithoutDetails()
    {
        var unreachable = new SqlConnectionStringBuilder(database.ConnectionString)
        {
            InitialCatalog = $"HrPayroll_DoesNotExist_{Guid.NewGuid():N}",
            ConnectTimeout = 3,
        }.ConnectionString;
        await using var factory = new ApiFactory(unreachable);
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/api/health");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        var text = await response.Content.ReadAsStringAsync();
        var body = JsonDocument.Parse(text).RootElement;
        Assert.Equal("degraded", body.GetProperty("status").GetString());
        Assert.Equal("unreachable", body.GetProperty("database").GetString());
        Assert.DoesNotContain("DoesNotExist", text);
    }

    [Fact]
    public async Task Get_UnknownRoute_ReturnsNotFound()
    {
        await using var factory = new ApiFactory(database.ConnectionString);
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/api/does-not-exist");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
