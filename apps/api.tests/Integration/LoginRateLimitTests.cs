using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

public class LoginRateLimitTests(TestDatabase database) : IClassFixture<TestDatabase>
{
    private const int Limit = 3;

    private ApiFactory NewFactory(string? limit = "3") =>
        new(database.ConnectionString, new Dictionary<string, string?> { ["RateLimiting:LoginPerMinute"] = limit });

    private static Task<HttpResponseMessage> PostLogin(HttpClient client, string username, string password) =>
        client.PostAsJsonAsync("/api/auth/login", new { username, password });

    [Fact]
    public async Task Login_AfterTheConfiguredNumberOfAttempts_IsTooManyRequests_WithAProblemBody()
    {
        await using var factory = NewFactory();
        using var client = factory.CreateClient();
        var ghost = TestUsers.UniqueName("ghost");

        for (var attempt = 1; attempt <= Limit; attempt++)
        {
            var allowed = await PostLogin(client, ghost, "whatever-password");
            Assert.Equal(HttpStatusCode.Unauthorized, allowed.StatusCode);
        }

        var limited = await PostLogin(client, ghost, "whatever-password");

        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
        Assert.Equal("application/problem+json", limited.Content.Headers.ContentType?.MediaType);
        var problem = await limited.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Too many attempts. Try again later.", problem.GetProperty("title").GetString());
        Assert.Equal(429, problem.GetProperty("status").GetInt32());
    }

    [Fact]
    public async Task Login_WhenRateLimited_DoesNotReachTheAuthenticationCode_SoACorrectPasswordIsStillRefused()
    {
        var user = await TestUsers.CreateAsync(database.ConnectionString);
        await using var factory = NewFactory();
        using var client = factory.CreateClient();

        for (var attempt = 1; attempt <= Limit; attempt++)
        {
            await PostLogin(client, user.Username, "Definitely-Not-It-9");
        }

        var limited = await PostLogin(client, user.Username, TestUsers.DefaultPassword);

        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
        // Only the three counted attempts reached the service.
        Assert.Equal(3, (await TestUsers.ReloadAsync(database.ConnectionString, user.Id)).FailedLoginCount);
    }

    [Fact]
    public async Task TheLoginLimit_DoesNotAffectHealthOrTheCurrentUserEndpoint()
    {
        var user = await TestUsers.CreateAsync(database.ConnectionString);
        await using var factory = NewFactory();
        using var client = factory.CreateClient();
        var token = await TestUsers.LoginAsync(client, user.Username);
        for (var attempt = 1; attempt < Limit; attempt++)
        {
            await PostLogin(client, user.Username, "Definitely-Not-It-9");
        }

        Assert.Equal(HttpStatusCode.TooManyRequests, (await PostLogin(client, user.Username, TestUsers.DefaultPassword)).StatusCode);

        for (var request = 1; request <= Limit + 2; request++)
        {
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/health")).StatusCode);

            var me = new HttpRequestMessage(HttpMethod.Get, "/api/auth/me");
            me.Headers.Authorization = new("Bearer", token);
            Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(me)).StatusCode);
        }
    }

    [Fact]
    public async Task TheLoginLimit_DoesNotAffectChangePassword()
    {
        var user = await TestUsers.CreateAsync(database.ConnectionString);
        await using var factory = NewFactory();
        using var client = factory.CreateClient();
        var token = await TestUsers.LoginAsync(client, user.Username);

        for (var request = 1; request <= Limit + 2; request++)
        {
            var message = new HttpRequestMessage(HttpMethod.Post, "/api/auth/change-password")
            {
                Content = JsonContent.Create(new { currentPassword = "Definitely-Not-It-9", newPassword = "Brand-New-Passphrase-42" }),
            };
            message.Headers.Authorization = new("Bearer", token);
            Assert.Equal(HttpStatusCode.BadRequest, (await client.SendAsync(message)).StatusCode);
        }
    }

    [Fact]
    public async Task Login_WithoutAConfiguredLimit_AllowsTenAttemptsAndRefusesTheEleventh()
    {
        await using var factory = NewFactory(limit: null);
        using var client = factory.CreateClient();
        var ghost = TestUsers.UniqueName("ghost");

        for (var attempt = 1; attempt <= 10; attempt++)
        {
            Assert.Equal(HttpStatusCode.Unauthorized, (await PostLogin(client, ghost, "whatever-password")).StatusCode);
        }

        Assert.Equal(HttpStatusCode.TooManyRequests, (await PostLogin(client, ghost, "whatever-password")).StatusCode);
    }
}
