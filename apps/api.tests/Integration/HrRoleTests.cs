using System.Net;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>HR sees everything a manager sees, including pay, but cannot change or approve anything.</summary>
public class HrRoleTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private async Task<string> HrToken() => (await TestWorkers.SignInAsync(api, Roles.HR)).Token;

    [Theory]
    [InlineData("/api/workers")]
    [InlineData("/api/attendance?date=2026-02-10")]
    [InlineData("/api/attendance/summary")]
    [InlineData("/api/leave")]
    [InlineData("/api/settings/payroll")]
    [InlineData("/api/payroll?month=2026-02")]
    [InlineData("/api/payroll/pdf?month=2026-02")]
    [InlineData("/api/deductions?month=2026-02")]
    [InlineData("/api/deduction-types")]
    public async Task Hr_CanRead(string url)
    {
        var response = await api.GetAsync(url, await HrToken());
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Hr_SeesWagesAndPay()
    {
        var token = await HrToken();
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        var workers = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/workers", token));
        var mine = workers.EnumerateArray().First(w => w.GetProperty("id").GetInt32() == worker.Id);
        Assert.NotEqual(System.Text.Json.JsonValueKind.Null, mine.GetProperty("hourlyRate").ValueKind);
        var settings = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/settings/payroll", token));
        Assert.NotEqual(System.Text.Json.JsonValueKind.Null, settings.GetProperty("overtimeRatePerHour").ValueKind);
    }

    [Theory]
    [InlineData("PUT", "/api/attendance/2026-02-10")]
    [InlineData("DELETE", "/api/attendance/2026-02-10/1")]
    [InlineData("POST", "/api/attendance/2026-02-10/approve")]
    [InlineData("POST", "/api/attendance/2026-02-10/reject")]
    [InlineData("POST", "/api/leave")]
    [InlineData("POST", "/api/leave/1/approve")]
    [InlineData("POST", "/api/leave/1/reject")]
    [InlineData("DELETE", "/api/leave/1")]
    [InlineData("DELETE", "/api/workers/1")]
    [InlineData("PUT", "/api/settings/payroll")]
    [InlineData("POST", "/api/payroll/2026-02/finalise")]
    [InlineData("DELETE", "/api/payroll/2026-02/finalise")]
    [InlineData("GET", "/api/users")]
    [InlineData("POST", "/api/users")]
    public async Task Hr_CannotChangeOrApprove(string verb, string url)
    {
        var response = await api.SendAsync(new HttpMethod(verb), url, verb == "GET" ? null : new { }, await HrToken());
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Hr_CanEditWorkersWithoutChangingPay_ButNotAddDeactivateOrDelete()
    {
        var token = await HrToken();
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, hourlyRate: 10m);

        var added = await api.SendAsync(HttpMethod.Post, "/api/workers",
            new { workerCode = TestWorkers.UniqueCode(), fullName = "Hr Added", designation = "Glazier", hourlyRate = 10m }, token);
        Assert.Equal(HttpStatusCode.Forbidden, added.StatusCode);

        var edited = await api.SendAsync(HttpMethod.Put, $"/api/workers/{worker.Id}",
            new { workerCode = worker.WorkerCode, fullName = "Hr Edited", designation = "Glazier", hourlyRate = 99m, monthlySalary = 9999m, overtimeRate = 50m, housingAllowance = 777m, exchangeName = "Al Ansari" }, token);
        Assert.Equal(HttpStatusCode.OK, edited.StatusCode);
        var json = await TestWorkers.ReadJsonAsync(edited);
        Assert.Equal("Hr Edited", json.GetProperty("fullName").GetString());
        Assert.Equal("Al Ansari", json.GetProperty("exchangeName").GetString());
        Assert.Equal(10m, json.GetProperty("hourlyRate").GetDecimal());
        Assert.Equal(0m, json.GetProperty("housingAllowance").GetDecimal());
        Assert.NotEqual(9999m, json.GetProperty("monthlySalary").GetDecimal());
        Assert.Equal(System.Text.Json.JsonValueKind.Null, json.GetProperty("overtimeRate").ValueKind);

        Assert.Equal(HttpStatusCode.Forbidden, (await api.SendAsync(HttpMethod.Post, $"/api/workers/{worker.Id}/deactivate", null, token)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await api.SendAsync(HttpMethod.Delete, $"/api/workers/{worker.Id}", null, token)).StatusCode);
    }
    [Fact]
    public async Task Hr_CanAddDeductionsAndTypes()
    {
        var token = await HrToken();
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        var type = await api.SendAsync(HttpMethod.Post, "/api/deduction-types", new { name = $"HR type {Guid.NewGuid():N}"[..20] }, token);
        Assert.Equal(HttpStatusCode.Created, type.StatusCode);
        var save = await api.SendAsync(HttpMethod.Put, "/api/deductions/2026-01", new { workers = Array.Empty<object>() }, token);
        Assert.Equal(HttpStatusCode.OK, save.StatusCode);
    }

    [Fact]
    public async Task Supervisor_StillCannotReadPayroll()
    {
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Supervisor);
        Assert.Equal(HttpStatusCode.Forbidden, (await api.GetAsync("/api/payroll?month=2026-02", token)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await api.GetAsync("/api/deductions?month=2026-02", token)).StatusCode);
    }
}
