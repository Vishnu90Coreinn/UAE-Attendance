using System.Net;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

public class AttendanceEndpointTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private const string Date = "2026-01-15";
    public static TheoryData<string, string?, HttpStatusCode> RolesMatrix => new()
    {
        {"GET", null, HttpStatusCode.Unauthorized}, {"PUT", null, HttpStatusCode.Unauthorized}, {"DELETE", null, HttpStatusCode.Unauthorized},
        {"GET", Roles.Viewer, HttpStatusCode.OK}, {"PUT", Roles.Viewer, HttpStatusCode.Forbidden}, {"DELETE", Roles.Viewer, HttpStatusCode.Forbidden},
        {"GET", Roles.HrStaff, HttpStatusCode.OK}, {"PUT", Roles.HrStaff, HttpStatusCode.OK}, {"DELETE", Roles.HrStaff, HttpStatusCode.NoContent},
        {"GET", Roles.Administrator, HttpStatusCode.OK}, {"PUT", Roles.Administrator, HttpStatusCode.OK}, {"DELETE", Roles.Administrator, HttpStatusCode.NoContent},
    };

    [Theory, MemberData(nameof(RolesMatrix))]
    public async Task EveryRoute_EnforcesRoles(string method, string? role, HttpStatusCode expected)
    {
        var token = role is null ? null : (await TestWorkers.SignInAsync(api, role)).Token;
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        var path = method == "GET" ? $"/api/attendance?date={Date}" : $"/api/attendance/{Date}";
        if (method == "DELETE") path += $"/{worker.Id}";
        var response = await api.SendAsync(new HttpMethod(method), path,
            method == "PUT" ? new[] { new { workerId = worker.Id, status = "Present", basicHours = 8m, overtimeHours = 2m } } : null, token);
        Assert.Equal(expected, response.StatusCode);
    }

    [Fact]
    public async Task Save_ReturnsComputedPay_AndDeleteRestoresNotRecorded()
    {
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.HrStaff);
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, overtimeRate: 3m);
        var response = await api.SendAsync(HttpMethod.Put, $"/api/attendance/{Date}",
            new[] { new { workerId = worker.Id, status = "Present", basicHours = 8m, overtimeHours = 2m } }, token);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var json = await TestWorkers.ReadJsonAsync(response);
        var row = json.GetProperty("rows").EnumerateArray().Single(r => r.GetProperty("worker").GetProperty("id").GetInt32() == worker.Id);
        Assert.Equal(106m, row.GetProperty("dailyPay").GetProperty("totalPay").GetDecimal());
        Assert.Equal(HttpStatusCode.NoContent, (await api.SendAsync(HttpMethod.Delete, $"/api/attendance/{Date}/{worker.Id}", token: token)).StatusCode);
        var day = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/attendance?date={Date}", token));
        Assert.Equal(System.Text.Json.JsonValueKind.Null, day.GetProperty("rows").EnumerateArray().Single(r => r.GetProperty("worker").GetProperty("id").GetInt32() == worker.Id).GetProperty("record").ValueKind);
    }
}
