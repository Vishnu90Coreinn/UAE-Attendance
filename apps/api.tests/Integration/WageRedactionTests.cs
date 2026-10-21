using System.Net;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>
/// A supervisor works on a remote site and must never see pay information: hourly and overtime rates, daily pay and the
/// company overtime rate. Managers and administrators see everything, as before.
/// </summary>
public class WageRedactionTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private const string Date = "2026-02-10";
    private const decimal Hourly = 37.77m;
    private const decimal Overtime = 4.56m;

    private static readonly string[] RateFields = ["hourlyRate", "overtimeRate", "effectiveOvertimeRate"];

    private async Task<int> SeedWorkerWithAttendanceAsync()
    {
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, hourlyRate: Hourly, overtimeRate: Overtime);
        var (_, manager) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var saved = await api.SendAsync(HttpMethod.Put, $"/api/attendance/{Date}",
            new[] { new { workerId = worker.Id, status = "Present", basicHours = 8m, overtimeHours = 2m } }, manager);
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        return worker.Id;
    }

    private static void AssertRatesHidden(JsonElement worker)
    {
        foreach (var field in RateFields)
        {
            Assert.Equal(JsonValueKind.Null, worker.GetProperty(field).ValueKind);
        }
    }

    private static void AssertNoPayNumbers(string body)
    {
        Assert.DoesNotContain("37.77", body);
        Assert.DoesNotContain("4.56", body);
        Assert.DoesNotContain("2.22", body);
        Assert.DoesNotContain("302.16", body);
        Assert.DoesNotContain("311.28", body);
    }

    [Fact]
    public async Task Supervisor_WorkerList_HasNoRates_ButKeepsIdentity()
    {
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, fullName: "Redacted Person", hourlyRate: Hourly, overtimeRate: Overtime);
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Supervisor);

        var response = await api.GetAsync("/api/workers?includeInactive=true", token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        AssertNoPayNumbers(body);
        var row = JsonDocument.Parse(body).RootElement.EnumerateArray().Single(w => w.GetProperty("id").GetInt32() == worker.Id);
        AssertRatesHidden(row);
        Assert.Equal("Redacted Person", row.GetProperty("fullName").GetString());
        Assert.Equal(worker.WorkerCode, row.GetProperty("workerCode").GetString());
    }

    [Fact]
    public async Task Supervisor_SingleWorker_HasNoRates()
    {
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, hourlyRate: Hourly, overtimeRate: Overtime);
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Supervisor);

        var response = await api.GetAsync($"/api/workers/{worker.Id}", token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        AssertNoPayNumbers(await response.Content.ReadAsStringAsync());
        AssertRatesHidden(await TestWorkers.ReadJsonAsync(response));
    }

    [Theory]
    [InlineData(Roles.Manager)]
    [InlineData(Roles.Administrator)]
    public async Task ManagerAndAdministrator_StillSeeWorkerRates(string role)
    {
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, hourlyRate: Hourly, overtimeRate: Overtime);
        var (_, token) = await TestWorkers.SignInAsync(api, role);

        var single = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/workers/{worker.Id}", token));
        var list = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/workers", token));

        Assert.Equal(Hourly, single.GetProperty("hourlyRate").GetDecimal());
        Assert.Equal(Overtime, single.GetProperty("overtimeRate").GetDecimal());
        Assert.Equal(Overtime, single.GetProperty("effectiveOvertimeRate").GetDecimal());
        var row = list.EnumerateArray().Single(w => w.GetProperty("id").GetInt32() == worker.Id);
        Assert.Equal(Hourly, row.GetProperty("hourlyRate").GetDecimal());
    }

    [Fact]
    public async Task Supervisor_AttendanceDay_HasNoRatesAndNoDailyPay_ButKeepsHours()
    {
        var workerId = await SeedWorkerWithAttendanceAsync();
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Supervisor);

        var response = await api.GetAsync($"/api/attendance?date={Date}", token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        AssertNoPayNumbers(body);
        var row = JsonDocument.Parse(body).RootElement.GetProperty("rows").EnumerateArray()
            .Single(r => r.GetProperty("worker").GetProperty("id").GetInt32() == workerId);
        AssertRatesHidden(row.GetProperty("worker"));
        Assert.Equal(JsonValueKind.Null, row.GetProperty("dailyPay").ValueKind);
        Assert.Equal("Present", row.GetProperty("record").GetProperty("status").GetString());
        Assert.Equal(8m, row.GetProperty("record").GetProperty("basicHours").GetDecimal());
        Assert.Equal(2m, row.GetProperty("record").GetProperty("overtimeHours").GetDecimal());
    }

    [Fact]
    public async Task Supervisor_SavingAttendance_ReturnsTheDayWithoutPay()
    {
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, hourlyRate: Hourly, overtimeRate: Overtime);
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Supervisor);

        var response = await api.SendAsync(HttpMethod.Put, "/api/attendance/2026-02-11",
            new[] { new { workerId = worker.Id, status = "Present", basicHours = 8m, overtimeHours = 2m } }, token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        AssertNoPayNumbers(body);
        var row = JsonDocument.Parse(body).RootElement.GetProperty("rows").EnumerateArray()
            .Single(r => r.GetProperty("worker").GetProperty("id").GetInt32() == worker.Id);
        Assert.Equal(JsonValueKind.Null, row.GetProperty("dailyPay").ValueKind);
        AssertRatesHidden(row.GetProperty("worker"));
    }

    [Fact]
    public async Task Supervisor_SavingInvalidAttendance_DoesNotLeakRatesInTheErrors()
    {
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, hourlyRate: Hourly, overtimeRate: Overtime);
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Supervisor);

        var response = await api.SendAsync(HttpMethod.Put, "/api/attendance/2026-02-12",
            new[] { new { workerId = worker.Id, status = "Present", basicHours = 99m, overtimeHours = 2m } }, token);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        AssertNoPayNumbers(await response.Content.ReadAsStringAsync());
    }

    [Theory]
    [InlineData(Roles.Manager)]
    [InlineData(Roles.Administrator)]
    public async Task ManagerAndAdministrator_StillSeeAttendancePay(string role)
    {
        var workerId = await SeedWorkerWithAttendanceAsync();
        var (_, token) = await TestWorkers.SignInAsync(api, role);

        var day = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/attendance?date={Date}", token));

        var row = day.GetProperty("rows").EnumerateArray().Single(r => r.GetProperty("worker").GetProperty("id").GetInt32() == workerId);
        Assert.Equal(Hourly, row.GetProperty("worker").GetProperty("hourlyRate").GetDecimal());
        Assert.Equal(Overtime, row.GetProperty("worker").GetProperty("effectiveOvertimeRate").GetDecimal());
        // 8 x 37.77 + 2 x 4.56 = 302.16 + 9.12
        Assert.Equal(311.28m, row.GetProperty("dailyPay").GetProperty("totalPay").GetDecimal());
    }

    [Fact]
    public async Task Supervisor_Settings_HaveNoOvertimeRate()
    {
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Supervisor);

        var response = await api.GetAsync("/api/settings/payroll", token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var json = await TestWorkers.ReadJsonAsync(response);
        Assert.Equal(JsonValueKind.Null, json.GetProperty("overtimeRatePerHour").ValueKind);
        Assert.Equal(JsonValueKind.Number, json.GetProperty("maxBasicHoursPerDay").ValueKind);
    }

    [Theory]
    [InlineData(Roles.Manager)]
    [InlineData(Roles.Administrator)]
    public async Task ManagerAndAdministrator_StillSeeTheOvertimeRate(string role)
    {
        var (_, token) = await TestWorkers.SignInAsync(api, role);

        var json = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/settings/payroll", token));

        Assert.Equal(JsonValueKind.Number, json.GetProperty("overtimeRatePerHour").ValueKind);
    }
}
