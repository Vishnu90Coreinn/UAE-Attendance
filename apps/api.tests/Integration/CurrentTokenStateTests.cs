using System.Net;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Integration;

public class CurrentTokenStateTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    [Theory]
    [InlineData("deactivated")]
    [InlineData("deleted")]
    public async Task ExistingToken_IsUnauthorizedWhenAccountStopsBeingActive(string change)
    {
        var user = await TestUsers.CreateAsync(api.ConnectionString, role: Roles.Administrator);
        var token = await TestUsers.LoginAsync(api.Client, user.Username);
        await using (var db = TestUsers.NewContext(api.ConnectionString))
        {
            if (change == "deleted")
                await db.Users.Where(u => u.Id == user.Id).ExecuteDeleteAsync();
            else
                await db.Users.Where(u => u.Id == user.Id).ExecuteUpdateAsync(s => s.SetProperty(u => u.IsActive, false));
        }

        Assert.Equal(HttpStatusCode.Unauthorized, (await api.GetAsync("/api/auth/me", token)).StatusCode);
    }

    [Fact]
    public async Task ExistingToken_UsesCurrentRoleForAuthorizationAndMeResponse()
    {
        var user = await TestUsers.CreateAsync(api.ConnectionString, role: Roles.Administrator);
        var token = await TestUsers.LoginAsync(api.Client, user.Username);
        await using (var db = TestUsers.NewContext(api.ConnectionString))
        {
            await db.Users.Where(u => u.Id == user.Id).ExecuteUpdateAsync(s => s.SetProperty(u => u.Role, Roles.Supervisor));
        }

        Assert.Equal(HttpStatusCode.Forbidden, (await api.GetAsync("/api/users", token)).StatusCode);
        var me = await api.GetAsync("/api/auth/me", token);
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
        Assert.Contains(Roles.Supervisor, await me.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task ExistingToken_IsUnauthorizedWhenUsernameNoLongerMatchesSubjectAccount()
    {
        var user = await TestUsers.CreateAsync(api.ConnectionString);
        var token = await TestUsers.LoginAsync(api.Client, user.Username);
        await using (var db = TestUsers.NewContext(api.ConnectionString))
        {
            await db.Users.Where(u => u.Id == user.Id).ExecuteUpdateAsync(s => s.SetProperty(u => u.Username, TestUsers.UniqueName("renamed")));
        }

        Assert.Equal(HttpStatusCode.Unauthorized, (await api.GetAsync("/api/auth/me", token)).StatusCode);
    }
}
