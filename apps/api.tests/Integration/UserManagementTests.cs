using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Integration;

public class UserManagementTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private async Task<(Data.Entities.User User, string Token)> AdminAsync()
    {
        var user = await TestUsers.CreateAsync(api.ConnectionString, role: Roles.Administrator);
        return (user, await TestUsers.LoginAsync(api.Client, user.Username));
    }

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.Clone();

    [Theory]
    [InlineData(null, HttpStatusCode.Unauthorized)]
    [InlineData(Roles.Supervisor, HttpStatusCode.Forbidden)]
    public async Task EveryUserRoute_RejectsAnonymousAndSupervisor(string? role, HttpStatusCode expected)
    {
        string? token = null;
        if (role is not null)
        {
            var user = await TestUsers.CreateAsync(api.ConnectionString, role: role);
            token = await TestUsers.LoginAsync(api.Client, user.Username);
        }

        var target = await TestUsers.CreateAsync(api.ConnectionString);
        var calls = new[]
        {
            await api.GetAsync("/api/users", token),
            await api.SendAsync(HttpMethod.Post, "/api/users", new { username = TestUsers.UniqueName(), password = TestUsers.DefaultPassword, role = Roles.Supervisor }, token),
            await api.SendAsync(HttpMethod.Put, $"/api/users/{target.Id}", new { role = Roles.Manager, active = true }, token),
            await api.SendAsync(HttpMethod.Post, $"/api/users/{target.Id}/reset-password", new { password = "Replacement-Password-42" }, token),
            await api.SendAsync(HttpMethod.Delete, $"/api/users/{target.Id}", null, token),
        };

        Assert.All(calls, response => Assert.Equal(expected, response.StatusCode));
    }

    [Fact]
    public async Task Administrator_CanCreateListUpdateResetAndDelete_AuditedWithoutExposingHashes()
    {
        var (_, token) = await AdminAsync();
        var username = TestUsers.UniqueName("managed");
        const string replacement = "Replacement-Password-42";

        var create = await api.SendAsync(HttpMethod.Post, "/api/users",
            new { username = $"  {username}  ", password = TestUsers.DefaultPassword, role = Roles.Supervisor }, token);
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var created = await JsonAsync(create);
        var id = created.GetProperty("id").GetInt32();
        Assert.Equal(username, created.GetProperty("username").GetString());
        Assert.False(created.TryGetProperty("passwordHash", out _));

        var list = await api.GetAsync("/api/users", token);
        Assert.Equal(HttpStatusCode.OK, list.StatusCode);
        Assert.DoesNotContain("passwordHash", await list.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);

        var update = await api.SendAsync(HttpMethod.Put, $"/api/users/{id}", new { role = Roles.Manager, active = false }, token);
        Assert.Equal(HttpStatusCode.OK, update.StatusCode);
        var updated = await JsonAsync(update);
        Assert.Equal(Roles.Manager, updated.GetProperty("role").GetString());
        Assert.False(updated.GetProperty("isActive").GetBoolean());

        var reset = await api.SendAsync(HttpMethod.Post, $"/api/users/{id}/reset-password", new { password = replacement }, token);
        Assert.Equal(HttpStatusCode.NoContent, reset.StatusCode);

        var reactivate = await api.SendAsync(HttpMethod.Put, $"/api/users/{id}", new { role = Roles.Manager, active = true }, token);
        Assert.Equal(HttpStatusCode.OK, reactivate.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await api.PostAsync("/api/auth/login", new { username, password = replacement })).StatusCode);

        var delete = await api.SendAsync(HttpMethod.Delete, $"/api/users/{id}", null, token);
        Assert.Equal(HttpStatusCode.NoContent, delete.StatusCode);

        await using var db = TestUsers.NewContext(api.ConnectionString);
        Assert.Null(await db.Users.FindAsync(id));
        var actions = await db.AuditLogs.Where(a => a.EntityType == "User" && a.EntityId == id.ToString())
            .Select(a => a.Action).ToListAsync();
        Assert.Contains("UserCreated", actions);
        Assert.Contains("UserRoleChanged", actions);
        Assert.Contains("UserDeactivated", actions);
        Assert.Contains("PasswordReset", actions);
        Assert.Contains("UserActivated", actions);
        Assert.Contains("UserDeleted", actions);
        Assert.DoesNotContain(replacement, string.Join('|', await db.AuditLogs.Where(a => a.EntityId == id.ToString()).Select(a => a.DetailsJson).ToListAsync()));
    }

    [Theory]
    [InlineData("short", Roles.Supervisor, "password")]
    [InlineData("valid-password-42", "Owner", "role")]
    [InlineData("valid-password-42", "HR Staff", "role")]
    [InlineData("valid-password-42", "Viewer", "role")]
    public async Task Create_RejectsInvalidFields(string password, string role, string field)
    {
        var (_, token) = await AdminAsync();
        var response = await api.SendAsync(HttpMethod.Post, "/api/users",
            new { username = TestUsers.UniqueName(), password, role }, token);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.True((await JsonAsync(response)).GetProperty("errors").TryGetProperty(field, out _));
    }

    [Fact]
    public async Task Create_RejectsPasswordEqualToUsername_AndCaseInsensitiveDuplicate()
    {
        var (_, token) = await AdminAsync();
        var username = TestUsers.UniqueName("duplicate");
        await TestUsers.CreateAsync(api.ConnectionString, username: username);

        var equal = await api.SendAsync(HttpMethod.Post, "/api/users",
            new { username = "LongUsername42", password = "longusername42", role = Roles.Supervisor }, token);
        var duplicate = await api.SendAsync(HttpMethod.Post, "/api/users",
            new { username = username.ToUpperInvariant(), password = TestUsers.DefaultPassword, role = Roles.Supervisor }, token);

        Assert.Equal(HttpStatusCode.BadRequest, equal.StatusCode);
        Assert.True((await JsonAsync(equal)).GetProperty("errors").TryGetProperty("password", out _));
        Assert.Equal(HttpStatusCode.BadRequest, duplicate.StatusCode);
        Assert.True((await JsonAsync(duplicate)).GetProperty("errors").TryGetProperty("username", out _));
    }

    [Fact]
    public async Task Administrator_CannotDeleteOrDeactivateSelf()
    {
        var (admin, token) = await AdminAsync();

        var deactivate = await api.SendAsync(HttpMethod.Put, $"/api/users/{admin.Id}",
            new { role = Roles.Administrator, active = false }, token);
        var delete = await api.SendAsync(HttpMethod.Delete, $"/api/users/{admin.Id}", null, token);

        Assert.Equal(HttpStatusCode.Conflict, deactivate.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, delete.StatusCode);
        Assert.True((await TestUsers.ReloadAsync(api.ConnectionString, admin.Id)).IsActive);
    }

    [Fact]
    public async Task LastActiveAdministrator_CannotBeDemotedDeactivatedOrDeleted()
    {
        var target = await TestUsers.CreateAsync(api.ConnectionString, role: Roles.Administrator);
        await using (var db = TestUsers.NewContext(api.ConnectionString))
        {
            await db.Users.Where(u => u.Id != target.Id && u.Role == Roles.Administrator)
                .ExecuteUpdateAsync(s => s.SetProperty(u => u.IsActive, false));
        }

        var targetToken = await TestUsers.LoginAsync(api.Client, target.Username);
        var demote = await api.SendAsync(HttpMethod.Put, $"/api/users/{target.Id}", new { role = Roles.Supervisor, active = true }, targetToken);
        Assert.Equal(HttpStatusCode.Conflict, demote.StatusCode);
    }

    // --- Manager: supervisors only ---------------------------------------------------------------------------

    private async Task<(Data.Entities.User User, string Token)> ManagerAsync()
    {
        var user = await TestUsers.CreateAsync(api.ConnectionString, role: Roles.Manager);
        return (user, await TestUsers.LoginAsync(api.Client, user.Username));
    }

    [Fact]
    public async Task Manager_ListsOnlySupervisors_AndNeverSeesAdministratorsOrManagers()
    {
        var (_, token) = await ManagerAsync();
        var administrator = await TestUsers.CreateAsync(api.ConnectionString, role: Roles.Administrator);
        var otherManager = await TestUsers.CreateAsync(api.ConnectionString, role: Roles.Manager);
        var supervisor = await TestUsers.CreateAsync(api.ConnectionString, role: Roles.Supervisor);

        var response = await api.GetAsync("/api/users", token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var rows = (await JsonAsync(response)).EnumerateArray().ToList();
        Assert.Contains(rows, r => r.GetProperty("id").GetInt32() == supervisor.Id);
        Assert.DoesNotContain(rows, r => r.GetProperty("id").GetInt32() == administrator.Id);
        Assert.DoesNotContain(rows, r => r.GetProperty("id").GetInt32() == otherManager.Id);
        Assert.All(rows, r => Assert.Equal(Roles.Supervisor, r.GetProperty("role").GetString()));
    }

    [Fact]
    public async Task Administrator_ListsEveryRole()
    {
        var (_, token) = await AdminAsync();
        var manager = await TestUsers.CreateAsync(api.ConnectionString, role: Roles.Manager);
        var supervisor = await TestUsers.CreateAsync(api.ConnectionString, role: Roles.Supervisor);

        var rows = (await JsonAsync(await api.GetAsync("/api/users", token))).EnumerateArray().Select(r => r.GetProperty("id").GetInt32()).ToList();

        Assert.Contains(manager.Id, rows);
        Assert.Contains(supervisor.Id, rows);
    }

    [Fact]
    public async Task Manager_ManagesSupervisorAccounts_Audited()
    {
        var (manager, token) = await ManagerAsync();
        var username = TestUsers.UniqueName("site");

        var create = await api.SendAsync(HttpMethod.Post, "/api/users",
            new { username, password = TestUsers.DefaultPassword, role = Roles.Supervisor }, token);
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var id = (await JsonAsync(create)).GetProperty("id").GetInt32();

        var deactivate = await api.SendAsync(HttpMethod.Put, $"/api/users/{id}", new { role = Roles.Supervisor, active = false }, token);
        Assert.Equal(HttpStatusCode.OK, deactivate.StatusCode);
        Assert.False((await JsonAsync(deactivate)).GetProperty("isActive").GetBoolean());
        var reactivate = await api.SendAsync(HttpMethod.Put, $"/api/users/{id}", new { role = Roles.Supervisor, active = true }, token);
        Assert.Equal(HttpStatusCode.OK, reactivate.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent,
            (await api.SendAsync(HttpMethod.Post, $"/api/users/{id}/reset-password", new { password = "Replacement-Password-42" }, token)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await api.PostAsync("/api/auth/login", new { username, password = "Replacement-Password-42" })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await api.SendAsync(HttpMethod.Delete, $"/api/users/{id}", null, token)).StatusCode);

        await using var db = TestUsers.NewContext(api.ConnectionString);
        Assert.Null(await db.Users.FindAsync(id));
        var logs = await db.AuditLogs.Where(a => a.EntityType == "User" && a.EntityId == id.ToString()).ToListAsync();
        Assert.Contains(logs, l => l.Action == "UserCreated" && l.ActorUsername == manager.Username);
        Assert.Contains(logs, l => l.Action == "UserDeleted" && l.ActorUsername == manager.Username);
    }

    [Fact]
    public async Task SeveralSupervisorsAndSeveralManagersAreAllowed()
    {
        var (_, token) = await AdminAsync();
        foreach (var role in new[] { Roles.Supervisor, Roles.Supervisor, Roles.Manager, Roles.Manager })
        {
            var response = await api.SendAsync(HttpMethod.Post, "/api/users",
                new { username = TestUsers.UniqueName("multi"), password = TestUsers.DefaultPassword, role }, token);
            Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        }
    }

    [Theory]
    [InlineData(Roles.Manager)]
    [InlineData(Roles.Administrator)]
    public async Task Manager_CannotCreateManagerOrAdministratorAccounts(string role)
    {
        var (_, token) = await ManagerAsync();
        var username = TestUsers.UniqueName("grab");

        var response = await api.SendAsync(HttpMethod.Post, "/api/users",
            new { username, password = TestUsers.DefaultPassword, role }, token);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        await using var db = TestUsers.NewContext(api.ConnectionString);
        Assert.False(await db.Users.AnyAsync(u => u.Username == username));
    }

    [Theory]
    [InlineData(Roles.Manager)]
    [InlineData(Roles.Administrator)]
    public async Task Manager_CannotPromoteASupervisor(string role)
    {
        var (_, token) = await ManagerAsync();
        var supervisor = await TestUsers.CreateAsync(api.ConnectionString, role: Roles.Supervisor);

        var response = await api.SendAsync(HttpMethod.Put, $"/api/users/{supervisor.Id}", new { role, active = true }, token);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal(Roles.Supervisor, (await TestUsers.ReloadAsync(api.ConnectionString, supervisor.Id)).Role);
    }

    [Theory]
    [InlineData(Roles.Manager)]
    [InlineData(Roles.Administrator)]
    public async Task Manager_CannotTouchManagerOrAdministratorAccounts(string targetRole)
    {
        var (_, token) = await ManagerAsync();
        var target = await TestUsers.CreateAsync(api.ConnectionString, role: targetRole);
        var hashBefore = target.PasswordHash;

        var calls = new[]
        {
            await api.SendAsync(HttpMethod.Put, $"/api/users/{target.Id}", new { role = Roles.Supervisor, active = true }, token),
            await api.SendAsync(HttpMethod.Put, $"/api/users/{target.Id}", new { role = targetRole, active = false }, token),
            await api.SendAsync(HttpMethod.Post, $"/api/users/{target.Id}/reset-password", new { password = "Replacement-Password-42" }, token),
            await api.SendAsync(HttpMethod.Delete, $"/api/users/{target.Id}", null, token),
        };

        Assert.All(calls, response => Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode));
        var reloaded = await TestUsers.ReloadAsync(api.ConnectionString, target.Id);
        Assert.Equal(targetRole, reloaded.Role);
        Assert.True(reloaded.IsActive);
        Assert.Equal(hashBefore, reloaded.PasswordHash);
    }

    [Fact]
    public async Task Manager_CannotDeactivateOrDeleteThemselves()
    {
        var (manager, token) = await ManagerAsync();

        var deactivate = await api.SendAsync(HttpMethod.Put, $"/api/users/{manager.Id}", new { role = Roles.Manager, active = false }, token);
        var delete = await api.SendAsync(HttpMethod.Delete, $"/api/users/{manager.Id}", null, token);

        Assert.Equal(HttpStatusCode.Forbidden, deactivate.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, delete.StatusCode);
        Assert.True((await TestUsers.ReloadAsync(api.ConnectionString, manager.Id)).IsActive);
    }

    [Fact]
    public async Task Manager_RejectsRemovedRoleNamesWithAValidationError()
    {
        var (_, token) = await ManagerAsync();
        var supervisor = await TestUsers.CreateAsync(api.ConnectionString, role: Roles.Supervisor);

        var create = await api.SendAsync(HttpMethod.Post, "/api/users",
            new { username = TestUsers.UniqueName(), password = TestUsers.DefaultPassword, role = "HR Staff" }, token);
        var update = await api.SendAsync(HttpMethod.Put, $"/api/users/{supervisor.Id}", new { role = "Viewer", active = true }, token);

        Assert.Equal(HttpStatusCode.BadRequest, create.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, update.StatusCode);
    }

    [Fact]
    public async Task Manager_GetsNotFoundForAMissingUser()
    {
        var (_, token) = await ManagerAsync();
        var missing = int.MaxValue;
        Assert.Equal(HttpStatusCode.NotFound, (await api.SendAsync(HttpMethod.Put, $"/api/users/{missing}", new { role = Roles.Supervisor, active = true }, token)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await api.SendAsync(HttpMethod.Post, $"/api/users/{missing}/reset-password", new { password = TestUsers.DefaultPassword }, token)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await api.SendAsync(HttpMethod.Delete, $"/api/users/{missing}", null, token)).StatusCode);
    }

    [Fact]
    public async Task Administrator_ManagesManagerAndAdministratorAccounts()
    {
        var (_, token) = await AdminAsync();
        foreach (var role in new[] { Roles.Manager, Roles.Administrator })
        {
            var create = await api.SendAsync(HttpMethod.Post, "/api/users",
                new { username = TestUsers.UniqueName("boss"), password = TestUsers.DefaultPassword, role }, token);
            Assert.Equal(HttpStatusCode.Created, create.StatusCode);
            var id = (await JsonAsync(create)).GetProperty("id").GetInt32();
            Assert.Equal(HttpStatusCode.OK, (await api.SendAsync(HttpMethod.Put, $"/api/users/{id}", new { role, active = false }, token)).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await api.SendAsync(HttpMethod.Post, $"/api/users/{id}/reset-password", new { password = "Replacement-Password-42" }, token)).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await api.SendAsync(HttpMethod.Delete, $"/api/users/{id}", null, token)).StatusCode);
        }
    }

    [Fact]
    public async Task Administrator_CanDeactivateAnotherAdministrator()
    {
        var (_, token) = await AdminAsync();
        var other = await TestUsers.CreateAsync(api.ConnectionString, role: Roles.Administrator);
        var ok = await api.SendAsync(HttpMethod.Put, $"/api/users/{other.Id}", new { role = Roles.Administrator, active = false }, token);
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
    }

    [Fact]
    public async Task MissingUser_ReturnsNotFoundForEveryMutation()
    {
        var (_, token) = await AdminAsync();
        var missing = int.MaxValue;
        Assert.Equal(HttpStatusCode.NotFound, (await api.SendAsync(HttpMethod.Put, $"/api/users/{missing}", new { role = Roles.Supervisor, active = true }, token)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await api.SendAsync(HttpMethod.Post, $"/api/users/{missing}/reset-password", new { password = TestUsers.DefaultPassword }, token)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await api.SendAsync(HttpMethod.Delete, $"/api/users/{missing}", null, token)).StatusCode);
    }
}
