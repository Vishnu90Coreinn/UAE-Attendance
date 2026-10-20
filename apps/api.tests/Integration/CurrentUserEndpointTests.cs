using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Integration;

public class CurrentUserEndpointTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    [Fact]
    public async Task Me_WithoutToken_IsUnauthorized()
    {
        var response = await api.GetAsync("/api/auth/me");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Me_WithValidToken_ReturnsTheUser()
    {
        var user = await TestUsers.CreateAsync(api.ConnectionString, role: Roles.HrStaff);
        var token = await TestUsers.LoginAsync(api.Client, user.Username);

        var response = await api.GetAsync("/api/auth/me", token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(user.Id, body.GetProperty("id").GetInt32());
        Assert.Equal(user.Username, body.GetProperty("username").GetString());
        Assert.Equal(Roles.HrStaff, body.GetProperty("role").GetString());
        Assert.False(body.TryGetProperty("passwordHash", out _));
    }

    [Fact]
    public async Task Me_ReadsTheRoleFromTheDatabaseNotTheToken()
    {
        var user = await TestUsers.CreateAsync(api.ConnectionString, role: Roles.Viewer);
        var token = await TestUsers.LoginAsync(api.Client, user.Username);
        await using (var db = TestUsers.NewContext(api.ConnectionString))
        {
            await db.Users.Where(u => u.Id == user.Id).ExecuteUpdateAsync(s => s.SetProperty(u => u.Role, Roles.Administrator));
        }

        var body = await (await api.GetAsync("/api/auth/me", token)).Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(Roles.Administrator, body.GetProperty("role").GetString());
    }

    [Fact]
    public async Task Me_ForAUserDeletedAfterSignIn_IsUnauthorized()
    {
        var user = await TestUsers.CreateAsync(api.ConnectionString);
        var token = await TestUsers.LoginAsync(api.Client, user.Username);
        await using (var db = TestUsers.NewContext(api.ConnectionString))
        {
            await db.Users.Where(u => u.Id == user.Id).ExecuteDeleteAsync();
        }

        var response = await api.GetAsync("/api/auth/me", token);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Me_ForAUserDeactivatedAfterSignIn_IsUnauthorized()
    {
        var user = await TestUsers.CreateAsync(api.ConnectionString);
        var token = await TestUsers.LoginAsync(api.Client, user.Username);
        await using (var db = TestUsers.NewContext(api.ConnectionString))
        {
            await db.Users.Where(u => u.Id == user.Id).ExecuteUpdateAsync(s => s.SetProperty(u => u.IsActive, false));
        }

        var response = await api.GetAsync("/api/auth/me", token);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Me_WithGarbageToken_IsUnauthorized()
    {
        var response = await api.GetAsync("/api/auth/me", "not.a.jwt");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // --- token validation (each part of a token must be checked) ---------------------------------------------

    [Fact]
    public async Task ATokenSignedWithAnotherKey_IsRejected()
    {
        var user = await TestUsers.CreateAsync(api.ConnectionString);
        var token = TestTokens.Forge(user.Id, user.Username, key: "another-signing-key-0123456789-abcdefghijkl");

        Assert.Equal(HttpStatusCode.Unauthorized, (await api.GetAsync("/api/auth/me", token)).StatusCode);
    }

    [Fact]
    public async Task ATokenForTheWrongIssuerOrAudience_IsRejected()
    {
        var user = await TestUsers.CreateAsync(api.ConnectionString);

        var wrongIssuer = TestTokens.Forge(user.Id, user.Username, issuer: "SomeoneElse");
        var wrongAudience = TestTokens.Forge(user.Id, user.Username, audience: "SomewhereElse");

        Assert.Equal(HttpStatusCode.Unauthorized, (await api.GetAsync("/api/auth/me", wrongIssuer)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await api.GetAsync("/api/auth/me", wrongAudience)).StatusCode);
    }

    [Fact]
    public async Task AnExpiredToken_IsRejected_ButAWellFormedOneIsAccepted()
    {
        var user = await TestUsers.CreateAsync(api.ConnectionString);
        var expired = TestTokens.Forge(
            user.Id, user.Username, notBeforeUtc: DateTime.UtcNow.AddHours(-3), expiresUtc: DateTime.UtcNow.AddHours(-2));
        var good = TestTokens.Forge(user.Id, user.Username);

        Assert.Equal(HttpStatusCode.Unauthorized, (await api.GetAsync("/api/auth/me", expired)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await api.GetAsync("/api/auth/me", good)).StatusCode);
    }
}
