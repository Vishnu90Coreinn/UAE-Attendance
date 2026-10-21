using System.Net;
using System.Text.Json;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Integration;

public class ChangePasswordEndpointTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private const string NewPassword = "Brand-New-Passphrase-42";
    private const string WrongPassword = "Definitely-Not-It-9";

    private Task<HttpResponseMessage> PostChange(string? token, object body) =>
        api.PostAsync("/api/auth/change-password", body, token);

    private Task<HttpResponseMessage> PostLogin(string username, string password) =>
        api.PostAsync("/api/auth/login", new { username, password });

    private static async Task<JsonElement> ErrorsOf(HttpResponseMessage response)
    {
        var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
        return body.GetProperty("errors");
    }

    private async Task<(Data.Entities.User User, string Token)> SignedInUserAsync(string password = TestUsers.DefaultPassword)
    {
        var user = await TestUsers.CreateAsync(api.ConnectionString, password: password);
        var token = await TestUsers.LoginAsync(api.Client, user.Username, password);
        return (user, token);
    }

    // --- authentication ------------------------------------------------------------------------------------

    [Fact]
    public async Task ChangePassword_WithoutAToken_IsUnauthorized()
    {
        var response = await PostChange(null, new { currentPassword = TestUsers.DefaultPassword, newPassword = NewPassword });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task ChangePassword_ForAUserDeletedAfterSignIn_IsUnauthorized()
    {
        var (user, token) = await SignedInUserAsync();
        await using (var db = TestUsers.NewContext(api.ConnectionString))
        {
            await db.Users.Where(u => u.Id == user.Id).ExecuteDeleteAsync();
        }

        var response = await PostChange(token, new { currentPassword = TestUsers.DefaultPassword, newPassword = NewPassword });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // --- field errors --------------------------------------------------------------------------------------

    [Fact]
    public async Task ChangePassword_WithAWrongCurrentPassword_IsABadRequestWithAFieldErrorOnCurrentPassword()
    {
        var (_, token) = await SignedInUserAsync();

        var response = await PostChange(token, new { currentPassword = WrongPassword, newPassword = NewPassword });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var errors = await ErrorsOf(response);
        Assert.Equal("Current password is incorrect.", errors.GetProperty("currentPassword")[0].GetString());
        Assert.False(errors.TryGetProperty("newPassword", out _));
    }

    [Fact]
    public async Task ChangePassword_WithATooShortNewPassword_IsABadRequestWithAFieldErrorOnNewPassword()
    {
        var (_, token) = await SignedInUserAsync();

        var response = await PostChange(token, new { currentPassword = TestUsers.DefaultPassword, newPassword = "short-9ch" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var errors = await ErrorsOf(response);
        Assert.Equal("Password must be at least 10 characters.", errors.GetProperty("newPassword")[0].GetString());
        Assert.False(errors.TryGetProperty("currentPassword", out _));
    }

    [Fact]
    public async Task ChangePassword_WithANewPasswordEqualToTheUsername_IsABadRequestWithAFieldErrorOnNewPassword()
    {
        var (user, token) = await SignedInUserAsync();
        // Same name in a different case; the username is 30 characters, so the length rule is met.
        var response = await PostChange(token, new { currentPassword = TestUsers.DefaultPassword, newPassword = user.Username.ToUpperInvariant() });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.True((await ErrorsOf(response)).TryGetProperty("newPassword", out _));
    }

    [Fact]
    public async Task ChangePassword_WithANewPasswordEqualToTheCurrentOne_IsABadRequestWithAFieldErrorOnNewPassword()
    {
        var (_, token) = await SignedInUserAsync();

        var response = await PostChange(token, new { currentPassword = TestUsers.DefaultPassword, newPassword = TestUsers.DefaultPassword });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var errors = await ErrorsOf(response);
        Assert.Equal("New password must be different from the current password.", errors.GetProperty("newPassword")[0].GetString());
    }

    [Fact]
    public async Task ChangePassword_WithAWrongCurrentPasswordAndABadNewPassword_ReportsOnlyTheCurrentPassword()
    {
        var (_, token) = await SignedInUserAsync();

        var response = await PostChange(token, new { currentPassword = WrongPassword, newPassword = "short" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var errors = await ErrorsOf(response);
        Assert.True(errors.TryGetProperty("currentPassword", out _));
        Assert.False(errors.TryGetProperty("newPassword", out _));
    }

    [Theory]
    [InlineData("", "")]
    [InlineData("", NewPassword)]
    [InlineData(TestUsers.DefaultPassword, "")]
    public async Task ChangePassword_WithMissingFields_IsABadRequestWithCamelCaseFieldKeys(string current, string next)
    {
        var (_, token) = await SignedInUserAsync();

        var response = await PostChange(token, new { currentPassword = current, newPassword = next });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var errors = await ErrorsOf(response);
        foreach (var property in errors.EnumerateObject())
        {
            Assert.Contains(property.Name, new[] { "currentPassword", "newPassword" });
        }

        if (current.Length == 0)
        {
            Assert.True(errors.TryGetProperty("currentPassword", out _));
        }

        if (next.Length == 0)
        {
            Assert.True(errors.TryGetProperty("newPassword", out _));
        }
    }

    [Fact]
    public async Task ChangePassword_WithAnEmptyBody_IsABadRequest()
    {
        var (_, token) = await SignedInUserAsync();

        var response = await PostChange(token, new { });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task ChangePassword_WithOversizedFields_IsABadRequest()
    {
        var (_, token) = await SignedInUserAsync();

        var tooLongCurrent = await PostChange(token, new { currentPassword = new string('p', 129), newPassword = NewPassword });
        var tooLongNew = await PostChange(token, new { currentPassword = TestUsers.DefaultPassword, newPassword = new string('p', 129) });

        Assert.Equal(HttpStatusCode.BadRequest, tooLongCurrent.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, tooLongNew.StatusCode);
    }

    // --- success -------------------------------------------------------------------------------------------

    [Fact]
    public async Task ChangePassword_Success_IsNoContent_AndOnlyTheNewPasswordSignsInAfterwards()
    {
        var (user, token) = await SignedInUserAsync();

        var response = await PostChange(token, new { currentPassword = TestUsers.DefaultPassword, newPassword = NewPassword });

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Empty(await response.Content.ReadAsStringAsync());

        Assert.Equal(HttpStatusCode.Unauthorized, (await PostLogin(user.Username, TestUsers.DefaultPassword)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await PostLogin(user.Username, NewPassword)).StatusCode);

        var reloaded = await TestUsers.ReloadAsync(api.ConnectionString, user.Id);
        Assert.NotEqual(user.PasswordHash, reloaded.PasswordHash);
        Assert.DoesNotContain(NewPassword, reloaded.PasswordHash);
    }

    [Fact]
    public async Task ChangePassword_Success_KeepsTheExistingTokenValid()
    {
        var (_, token) = await SignedInUserAsync();

        await PostChange(token, new { currentPassword = TestUsers.DefaultPassword, newPassword = NewPassword });

        Assert.Equal(HttpStatusCode.OK, (await api.GetAsync("/api/auth/me", token)).StatusCode);
    }

    [Fact]
    public async Task ChangePassword_Success_WritesOnePasswordChangedAuditRowWithTheUserAsActor()
    {
        var (user, token) = await SignedInUserAsync();

        await PostChange(token, new { currentPassword = TestUsers.DefaultPassword, newPassword = NewPassword });

        await using var db = TestUsers.NewContext(api.ConnectionString);
        var row = await db.AuditLogs.SingleAsync(a => a.Action == "PasswordChanged" && a.ActorUsername == user.Username);
        Assert.Equal("User", row.EntityType);
        Assert.Equal(user.Id.ToString(), row.EntityId);
    }

    [Fact]
    public async Task ChangePassword_NeverPutsEitherPasswordInAuditRowsOrResponses()
    {
        var current = $"Current-{Guid.NewGuid():N}";
        var next = $"Replacement-{Guid.NewGuid():N}";
        var wrong = $"Wrong-{Guid.NewGuid():N}";
        var (user, token) = await SignedInUserAsync(current);

        var responses = new List<HttpResponseMessage>
        {
            await PostChange(token, new { currentPassword = wrong, newPassword = next }),
            await PostChange(token, new { currentPassword = current, newPassword = "short" }),
            await PostChange(token, new { currentPassword = current, newPassword = current }),
            await PostChange(token, new { currentPassword = current, newPassword = next }),
        };

        await using var db = TestUsers.NewContext(api.ConnectionString);
        var rows = await db.AuditLogs.Where(a => a.ActorUsername == user.Username).ToListAsync();
        Assert.Contains(rows, r => r.Action == "PasswordChanged");
        foreach (var row in rows)
        {
            var text = string.Join('|', row.ActorUsername, row.Action, row.EntityType, row.EntityId, row.DetailsJson);
            Assert.DoesNotContain(current, text);
            Assert.DoesNotContain(next, text);
            Assert.DoesNotContain(wrong, text);
        }

        foreach (var response in responses)
        {
            var text = await response.Content.ReadAsStringAsync();
            Assert.DoesNotContain(current, text);
            Assert.DoesNotContain(next, text);
            Assert.DoesNotContain(wrong, text);
        }
    }

    [Fact]
    public async Task ChangePassword_Failures_WriteNoAuditRow()
    {
        var (user, token) = await SignedInUserAsync();

        await PostChange(token, new { currentPassword = WrongPassword, newPassword = NewPassword });
        await PostChange(token, new { currentPassword = TestUsers.DefaultPassword, newPassword = "short" });

        await using var db = TestUsers.NewContext(api.ConnectionString);
        Assert.False(await db.AuditLogs.AnyAsync(a => a.Action == "PasswordChanged" && a.ActorUsername == user.Username));
    }

    // --- lockout -------------------------------------------------------------------------------------------

    [Fact]
    public async Task ChangePassword_WithAWrongCurrentPassword_DoesNotCountTowardTheLoginLockout()
    {
        var (user, token) = await SignedInUserAsync();

        for (var attempt = 1; attempt <= 6; attempt++)
        {
            var response = await PostChange(token, new { currentPassword = WrongPassword, newPassword = NewPassword });
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        }

        var reloaded = await TestUsers.ReloadAsync(api.ConnectionString, user.Id);
        Assert.Equal(0, reloaded.FailedLoginCount);
        Assert.Null(reloaded.LockoutEndUtc);
        Assert.Equal(HttpStatusCode.OK, (await PostLogin(user.Username, TestUsers.DefaultPassword)).StatusCode);
    }

    [Fact]
    public async Task ChangePassword_WithAWrongCurrentPassword_LeavesAnExistingFailureCountAlone()
    {
        var user = await TestUsers.CreateAsync(api.ConnectionString, failedLoginCount: 3);
        var token = await TestUsers.LoginAsync(api.Client, user.Username); // resets the counter to 0
        await using (var db = TestUsers.NewContext(api.ConnectionString))
        {
            await db.Users.Where(u => u.Id == user.Id).ExecuteUpdateAsync(s => s.SetProperty(u => u.FailedLoginCount, 2));
        }

        await PostChange(token, new { currentPassword = WrongPassword, newPassword = NewPassword });

        Assert.Equal(2, (await TestUsers.ReloadAsync(api.ConnectionString, user.Id)).FailedLoginCount);
    }
}
