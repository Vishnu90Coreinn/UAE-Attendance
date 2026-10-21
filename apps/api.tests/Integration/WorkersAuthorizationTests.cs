using System.Net;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>W7: every worker route and the settings route against anonymous, Supervisor, Manager and Administrator.</summary>
public class WorkersAuthorizationTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private static readonly string[] ReadRoutes = ["list", "get", "next-code", "settings"];
    private static readonly string[] WriteRoutes = ["create", "update", "deactivate", "activate", "delete"];

    public static TheoryData<string> AllRoutes()
    {
        var data = new TheoryData<string>();
        foreach (var route in ReadRoutes.Concat(WriteRoutes))
        {
            data.Add(route);
        }

        return data;
    }

    public static TheoryData<string, string> ReadsByRole()
    {
        var data = new TheoryData<string, string>();
        foreach (var role in Roles.All)
        {
            foreach (var route in ReadRoutes)
            {
                data.Add(role, route);
            }
        }

        return data;
    }

    public static TheoryData<string, string> WritesByRole()
    {
        var data = new TheoryData<string, string>();
        foreach (var role in new[] { Roles.Manager, Roles.Administrator })
        {
            foreach (var route in WriteRoutes)
            {
                data.Add(role, route);
            }
        }

        return data;
    }

    private static HttpStatusCode SuccessFor(string route) => route switch
    {
        "create" => HttpStatusCode.Created,
        "delete" => HttpStatusCode.NoContent,
        _ => HttpStatusCode.OK,
    };

    private async Task<HttpResponseMessage> CallAsync(string route, string? token)
    {
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        var body = new { workerCode = TestWorkers.UniqueCode(), fullName = "New Person", designation = "Fabricator", hourlyRate = 15.25m };
        var update = new { workerCode = worker.WorkerCode, fullName = "Renamed", designation = "Fabricator", hourlyRate = 16m };

        return route switch
        {
            "list" => await api.GetAsync("/api/workers", token),
            "get" => await api.GetAsync($"/api/workers/{worker.Id}", token),
            "next-code" => await api.GetAsync("/api/workers/next-code", token),
            "settings" => await api.GetAsync("/api/settings/payroll", token),
            "create" => await api.SendAsync(HttpMethod.Post, "/api/workers", body, token),
            "update" => await api.SendAsync(HttpMethod.Put, $"/api/workers/{worker.Id}", update, token),
            "deactivate" => await api.SendAsync(HttpMethod.Post, $"/api/workers/{worker.Id}/deactivate", null, token),
            "activate" => await api.SendAsync(HttpMethod.Post, $"/api/workers/{worker.Id}/activate", null, token),
            "delete" => await api.SendAsync(HttpMethod.Delete, $"/api/workers/{worker.Id}", null, token),
            _ => throw new ArgumentOutOfRangeException(nameof(route)),
        };
    }

    [Theory]
    [MemberData(nameof(AllRoutes))]
    public async Task Anonymous_IsUnauthorized_OnEveryRoute(string route)
    {
        var response = await CallAsync(route, token: null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Theory]
    [MemberData(nameof(ReadsByRole))]
    public async Task Reads_AreOpenToEverySignedInRole(string role, string route)
    {
        var (_, token) = await TestWorkers.SignInAsync(api, role);

        var response = await CallAsync(route, token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Theory]
    [InlineData("create")]
    [InlineData("update")]
    [InlineData("deactivate")]
    [InlineData("activate")]
    [InlineData("delete")]
    public async Task Writes_AreForbiddenForSupervisor(string route)
    {
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Supervisor);

        var response = await CallAsync(route, token);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Theory]
    [MemberData(nameof(WritesByRole))]
    public async Task Writes_SucceedForManagerAndAdministrator(string role, string route)
    {
        var (_, token) = await TestWorkers.SignInAsync(api, role);

        var response = await CallAsync(route, token);

        Assert.Equal(SuccessFor(route), response.StatusCode);
    }

    [Fact]
    public async Task SupervisorWrites_ChangeNothing()
    {
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Supervisor);
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, fullName: "Untouched", hourlyRate: 10m);

        var responses = new[]
        {
            await api.SendAsync(HttpMethod.Put, $"/api/workers/{worker.Id}",
                new { workerCode = worker.WorkerCode, fullName = "Hacked", designation = "X", hourlyRate = 99m }, token),
            await api.SendAsync(HttpMethod.Post, $"/api/workers/{worker.Id}/deactivate", null, token),
            await api.SendAsync(HttpMethod.Delete, $"/api/workers/{worker.Id}", null, token),
        };

        Assert.All(responses, response => Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode));

        var reloaded = await TestWorkers.FindAsync(api.ConnectionString, worker.Id);
        Assert.NotNull(reloaded);
        Assert.Equal("Untouched", reloaded.FullName);
        Assert.Equal(10m, reloaded.HourlyRate);
        Assert.True(reloaded.IsActive);
    }
}
