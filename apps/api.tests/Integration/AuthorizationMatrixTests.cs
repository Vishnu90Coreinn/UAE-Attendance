using System.Net;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

public class AuthorizationMatrixTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    [Theory]
    [InlineData(Roles.Supervisor, "any", HttpStatusCode.OK)]
    [InlineData(Roles.Supervisor, "supervisor", HttpStatusCode.OK)]
    [InlineData(Roles.Supervisor, "manager", HttpStatusCode.Forbidden)]
    [InlineData(Roles.Supervisor, "admin", HttpStatusCode.Forbidden)]
    [InlineData(Roles.Manager, "any", HttpStatusCode.OK)]
    [InlineData(Roles.Manager, "supervisor", HttpStatusCode.OK)]
    [InlineData(Roles.Manager, "manager", HttpStatusCode.OK)]
    [InlineData(Roles.Manager, "admin", HttpStatusCode.Forbidden)]
    [InlineData(Roles.Administrator, "any", HttpStatusCode.OK)]
    [InlineData(Roles.Administrator, "supervisor", HttpStatusCode.OK)]
    [InlineData(Roles.Administrator, "manager", HttpStatusCode.OK)]
    [InlineData(Roles.Administrator, "admin", HttpStatusCode.OK)]
    public async Task RoleMatrix_EnforcesEachPolicy(string role, string probe, HttpStatusCode expected)
    {
        var user = await TestUsers.CreateAsync(api.ConnectionString, role: role);
        var token = await TestUsers.LoginAsync(api.Client, user.Username);

        var response = await api.GetAsync($"/api/_probe/{probe}", token);

        Assert.Equal(expected, response.StatusCode);
    }

    [Theory]
    [InlineData(Roles.Supervisor)]
    [InlineData(Roles.Manager)]
    [InlineData(Roles.Administrator)]
    public async Task UnmarkedEndpoint_IsOpenToAnySignedInUser(string role)
    {
        var user = await TestUsers.CreateAsync(api.ConnectionString, role: role);
        var token = await TestUsers.LoginAsync(api.Client, user.Username);

        var response = await api.GetAsync("/api/_probe/unmarked", token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Theory]
    [InlineData("any")]
    [InlineData("supervisor")]
    [InlineData("manager")]
    [InlineData("admin")]
    [InlineData("unmarked")]
    public async Task Anonymous_IsUnauthorizedEverywhere_IncludingUnmarkedEndpoints(string probe)
    {
        var response = await api.GetAsync($"/api/_probe/{probe}");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Health_StaysAnonymous()
    {
        var response = await api.GetAsync("/api/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task UnknownRoute_StaysNotFound_ForAnonymousAndSignedInCallers()
    {
        var user = await TestUsers.CreateAsync(api.ConnectionString);
        var token = await TestUsers.LoginAsync(api.Client, user.Username);

        Assert.Equal(HttpStatusCode.NotFound, (await api.GetAsync("/api/does-not-exist")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await api.GetAsync("/api/does-not-exist", token)).StatusCode);
    }
}
