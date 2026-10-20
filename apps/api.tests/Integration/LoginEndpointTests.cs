using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Integration;

public class LoginEndpointTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private const string WrongPassword = "Definitely-Not-It-9";

    private Task<HttpResponseMessage> PostLogin(string username, string password) =>
        api.Client.PostAsJsonAsync("/api/auth/login", new { username, password });

    // --- success -----------------------------------------------------------------------------------------

    [Fact]
    public async Task Login_WithValidCredentials_ReturnsTokenExpiryAndUser()
    {
        var user = await TestUsers.CreateAsync(api.ConnectionString, role: Roles.HrStaff);

        var response = await PostLogin(user.Username, TestUsers.DefaultPassword);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(string.IsNullOrWhiteSpace(body.GetProperty("token").GetString()));
        Assert.True(body.GetProperty("expiresUtc").GetDateTime() > DateTime.UtcNow.AddHours(7));
        var returned = body.GetProperty("user");
        Assert.Equal(user.Id, returned.GetProperty("id").GetInt32());
        Assert.Equal(user.Username, returned.GetProperty("username").GetString());
        Assert.Equal(Roles.HrStaff, returned.GetProperty("role").GetString());
        Assert.False(body.TryGetProperty("passwordHash", out _));
        Assert.DoesNotContain(user.PasswordHash, await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Login_Token_AuthenticatesMeAndTheProbeEndpoint()
    {
        var user = await TestUsers.CreateAsync(api.ConnectionString, role: Roles.Viewer);
        var token = await TestUsers.LoginAsync(api.Client, user.Username);

        var me = await api.GetAsync("/api/auth/me", token);
        var probe = await api.GetAsync("/api/_probe/any", token);

        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
        Assert.Equal(HttpStatusCode.OK, probe.StatusCode);
    }

    [Fact]
    public async Task Login_Token_CarriesSubjectNameRoleIssuerAudienceAndEightHourExpiry()
    {
        var user = await TestUsers.CreateAsync(api.ConnectionString, role: Roles.Administrator);

        var response = await PostLogin(user.Username, TestUsers.DefaultPassword);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var payload = TestTokens.Payload(body.GetProperty("token").GetString()!);

        Assert.Equal(user.Id.ToString(), payload.GetProperty("sub").GetString());
        Assert.Equal(user.Username, payload.GetProperty(ClaimTypes.Name).GetString());
        Assert.Equal(Roles.Administrator, payload.GetProperty(ClaimTypes.Role).GetString());
        Assert.Equal("HrPayroll", payload.GetProperty("iss").GetString());
        Assert.Equal("HrPayrollWeb", payload.GetProperty("aud").GetString());

        var expires = DateTimeOffset.FromUnixTimeSeconds(payload.GetProperty("exp").GetInt64()).UtcDateTime;
        var lifetime = expires - DateTime.UtcNow;
        Assert.InRange(lifetime, TimeSpan.FromHours(8) - TimeSpan.FromMinutes(2), TimeSpan.FromHours(8) + TimeSpan.FromMinutes(1));
        Assert.True(Math.Abs((body.GetProperty("expiresUtc").GetDateTime().ToUniversalTime() - expires).TotalSeconds) < 2);
    }

    [Fact]
    public async Task Login_UsernameIsMatchedCaseInsensitively()
    {
        var user = await TestUsers.CreateAsync(api.ConnectionString, username: $"MixedCase{Guid.NewGuid():N}"[..25]);

        var response = await PostLogin(user.Username.ToUpperInvariant(), TestUsers.DefaultPassword);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(user.Username, body.GetProperty("user").GetProperty("username").GetString());
    }

    [Theory]
    [InlineData("", "password")]
    [InlineData("someone", "")]
    public async Task Login_WithMissingFields_IsABadRequest(string username, string password)
    {
        var response = await PostLogin(username, password);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Login_WithOversizedFields_IsABadRequest()
    {
        var tooLongName = await PostLogin(new string('u', 51), "password");
        var tooLongPassword = await PostLogin("someone", new string('p', 129));

        Assert.Equal(HttpStatusCode.BadRequest, tooLongName.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, tooLongPassword.StatusCode);
    }

    // --- failures look identical ---------------------------------------------------------------------------

    [Fact]
    public async Task Login_WrongPasswordUnknownUserAndInactiveUser_GiveIdenticalUnauthorizedBodies()
    {
        var active = await TestUsers.CreateAsync(api.ConnectionString);
        var inactive = await TestUsers.CreateAsync(api.ConnectionString, isActive: false);

        var wrongPassword = await PostLogin(active.Username, WrongPassword);
        var unknownUser = await PostLogin(TestUsers.UniqueName("ghost"), TestUsers.DefaultPassword);
        var inactiveUser = await PostLogin(inactive.Username, TestUsers.DefaultPassword);

        foreach (var response in new[] { wrongPassword, unknownUser, inactiveUser })
        {
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }

        var expected = await wrongPassword.Content.ReadAsByteArrayAsync();
        Assert.Equal(expected, await unknownUser.Content.ReadAsByteArrayAsync());
        Assert.Equal(expected, await inactiveUser.Content.ReadAsByteArrayAsync());

        var problem = JsonDocument.Parse(expected).RootElement;
        Assert.Equal("Invalid username or password.", problem.GetProperty("title").GetString());
        Assert.Equal(401, problem.GetProperty("status").GetInt32());
        Assert.Equal("application/problem+json", wrongPassword.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Login_InactiveUserWithCorrectPassword_DoesNotGetIn()
    {
        var inactive = await TestUsers.CreateAsync(api.ConnectionString, isActive: false);

        var response = await PostLogin(inactive.Username, TestUsers.DefaultPassword);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // --- lockout -------------------------------------------------------------------------------------------

    [Fact]
    public async Task Login_FailuresIncrementTheCounter()
    {
        var user = await TestUsers.CreateAsync(api.ConnectionString);

        await PostLogin(user.Username, WrongPassword);
        await PostLogin(user.Username, WrongPassword);

        var reloaded = await TestUsers.ReloadAsync(api.ConnectionString, user.Id);
        Assert.Equal(2, reloaded.FailedLoginCount);
        Assert.Null(reloaded.LockoutEndUtc);
    }

    [Fact]
    public async Task Login_FiveWrongPasswords_LockTheAccountEvenForTheCorrectPassword()
    {
        var user = await TestUsers.CreateAsync(api.ConnectionString);

        for (var attempt = 1; attempt <= 5; attempt++)
        {
            var failed = await PostLogin(user.Username, WrongPassword);
            Assert.Equal(HttpStatusCode.Unauthorized, failed.StatusCode);
        }

        var locked = await PostLogin(user.Username, TestUsers.DefaultPassword);

        Assert.Equal(HttpStatusCode.Locked, locked.StatusCode);
        var problem = await locked.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Account temporarily locked. Try again later.", problem.GetProperty("title").GetString());
        Assert.Equal(423, problem.GetProperty("status").GetInt32());

        var reloaded = await TestUsers.ReloadAsync(api.ConnectionString, user.Id);
        var remaining = reloaded.LockoutEndUtc!.Value - DateTime.UtcNow;
        Assert.InRange(remaining, TimeSpan.FromMinutes(14), TimeSpan.FromMinutes(15.5));
    }

    [Fact]
    public async Task Login_WhileLocked_DoesNotCheckThePasswordOrCountFurtherFailures()
    {
        var user = await TestUsers.CreateAsync(
            api.ConnectionString, failedLoginCount: 5, lockoutEndUtc: DateTime.UtcNow.AddMinutes(10));

        var wrong = await PostLogin(user.Username, WrongPassword);

        Assert.Equal(HttpStatusCode.Locked, wrong.StatusCode);
        var reloaded = await TestUsers.ReloadAsync(api.ConnectionString, user.Id);
        Assert.Equal(5, reloaded.FailedLoginCount);
    }

    [Fact]
    public async Task Login_AfterTheLockoutHasExpired_SucceedsAndResetsTheCounter()
    {
        var user = await TestUsers.CreateAsync(api.ConnectionString);
        for (var attempt = 1; attempt <= 5; attempt++)
        {
            await PostLogin(user.Username, WrongPassword);
        }

        Assert.Equal(HttpStatusCode.Locked, (await PostLogin(user.Username, TestUsers.DefaultPassword)).StatusCode);

        await using (var db = TestUsers.NewContext(api.ConnectionString))
        {
            await db.Users.Where(u => u.Id == user.Id)
                .ExecuteUpdateAsync(s => s.SetProperty(u => u.LockoutEndUtc, DateTime.UtcNow.AddMinutes(-1)));
        }

        var response = await PostLogin(user.Username, TestUsers.DefaultPassword);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var reloaded = await TestUsers.ReloadAsync(api.ConnectionString, user.Id);
        Assert.Equal(0, reloaded.FailedLoginCount);
        Assert.Null(reloaded.LockoutEndUtc);
    }

    [Fact]
    public async Task Login_ExpiredLockoutThenWrongPassword_StartsCountingAgainFromOne()
    {
        var user = await TestUsers.CreateAsync(
            api.ConnectionString, failedLoginCount: 5, lockoutEndUtc: DateTime.UtcNow.AddMinutes(-1));

        var response = await PostLogin(user.Username, WrongPassword);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var reloaded = await TestUsers.ReloadAsync(api.ConnectionString, user.Id);
        Assert.Equal(1, reloaded.FailedLoginCount);
        Assert.Null(reloaded.LockoutEndUtc);
    }

    [Fact]
    public async Task Login_Success_ResetsANonZeroFailureCount()
    {
        var user = await TestUsers.CreateAsync(api.ConnectionString, failedLoginCount: 3);

        var response = await PostLogin(user.Username, TestUsers.DefaultPassword);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(0, (await TestUsers.ReloadAsync(api.ConnectionString, user.Id)).FailedLoginCount);
    }

    // --- audit ---------------------------------------------------------------------------------------------

    [Fact]
    public async Task Login_Success_WritesALoginSucceededAuditRowForTheUser()
    {
        var user = await TestUsers.CreateAsync(api.ConnectionString);

        await PostLogin(user.Username, TestUsers.DefaultPassword);

        await using var db = TestUsers.NewContext(api.ConnectionString);
        var row = await db.AuditLogs.SingleAsync(a => a.ActorUsername == user.Username);
        Assert.Equal("LoginSucceeded", row.Action);
        Assert.Equal("User", row.EntityType);
        Assert.Equal(user.Id.ToString(), row.EntityId);
    }

    [Fact]
    public async Task Login_Failures_WriteLoginFailedRowsWithTheAttemptedUsernameAsActor()
    {
        var existing = await TestUsers.CreateAsync(api.ConnectionString);
        var inactive = await TestUsers.CreateAsync(api.ConnectionString, isActive: false);
        var ghost = TestUsers.UniqueName("ghost");

        await PostLogin(existing.Username, WrongPassword);
        await PostLogin(ghost, WrongPassword);
        await PostLogin(inactive.Username, TestUsers.DefaultPassword);

        await using var db = TestUsers.NewContext(api.ConnectionString);
        foreach (var name in new[] { existing.Username, ghost, inactive.Username })
        {
            var row = await db.AuditLogs.SingleAsync(a => a.ActorUsername == name);
            Assert.Equal("LoginFailed", row.Action);
        }
    }

    [Fact]
    public async Task Login_TheFifthFailure_WritesAnAccountLockedRow()
    {
        var user = await TestUsers.CreateAsync(api.ConnectionString);

        for (var attempt = 1; attempt <= 4; attempt++)
        {
            await PostLogin(user.Username, WrongPassword);
        }

        await using (var db = TestUsers.NewContext(api.ConnectionString))
        {
            Assert.False(await db.AuditLogs.AnyAsync(a => a.ActorUsername == user.Username && a.Action == "AccountLocked"));
        }

        await PostLogin(user.Username, WrongPassword);

        await using var after = TestUsers.NewContext(api.ConnectionString);
        var locked = await after.AuditLogs.SingleAsync(a => a.ActorUsername == user.Username && a.Action == "AccountLocked");
        Assert.Equal(user.Id.ToString(), locked.EntityId);
        Assert.Equal(5, await after.AuditLogs.CountAsync(a => a.ActorUsername == user.Username && a.Action == "LoginFailed"));
    }

    [Fact]
    public async Task Login_NeverPutsThePasswordInAuditRowsOrResponses()
    {
        var secret = $"Secret-{Guid.NewGuid():N}";
        var wrongSecret = $"Wrong-{Guid.NewGuid():N}";
        var user = await TestUsers.CreateAsync(api.ConnectionString, password: secret);
        var ghost = TestUsers.UniqueName("ghost");

        var responses = new List<HttpResponseMessage>
        {
            await PostLogin(user.Username, wrongSecret),
            await PostLogin(ghost, wrongSecret),
            await PostLogin(user.Username, secret),
        };
        for (var attempt = 1; attempt <= 5; attempt++)
        {
            await PostLogin(user.Username, wrongSecret);
        }

        responses.Add(await PostLogin(user.Username, secret)); // locked

        await using var db = TestUsers.NewContext(api.ConnectionString);
        var rows = await db.AuditLogs
            .Where(a => a.ActorUsername == user.Username || a.ActorUsername == ghost)
            .ToListAsync();
        Assert.NotEmpty(rows);
        foreach (var row in rows)
        {
            var text = string.Join('|', row.ActorUsername, row.Action, row.EntityType, row.EntityId, row.DetailsJson);
            Assert.DoesNotContain(secret, text);
            Assert.DoesNotContain(wrongSecret, text);
        }

        foreach (var response in responses)
        {
            var text = await response.Content.ReadAsStringAsync();
            Assert.DoesNotContain(wrongSecret, text);
            Assert.DoesNotContain(user.PasswordHash, text);
        }
    }
}
