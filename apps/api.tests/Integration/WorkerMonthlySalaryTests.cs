using System.Net;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

public class WorkerMonthlySalaryTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    [Theory]
    [InlineData(1600, 6.67)]
    [InlineData(1700, 7.08)]
    [InlineData(1400, 5.83)]
    public async Task Create_WithAMonthlySalary_StoresItAndDerivesTheHourlyRate(decimal salary, decimal hourly)
    {
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var response = await api.SendAsync(HttpMethod.Post, "/api/workers",
            new { workerCode = "MS" + Guid.NewGuid().ToString("N")[..8], fullName = "Salary Worker", designation = "Fitter", monthlySalary = salary }, token);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var json = await TestWorkers.ReadJsonAsync(response);
        Assert.Equal(salary, json.GetProperty("monthlySalary").GetDecimal());
        Assert.Equal(hourly, json.GetProperty("hourlyRate").GetDecimal());
    }

    [Fact]
    public async Task Update_RepeatingTheStoredHourlyRate_KeepsTheSalary()
    {
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var created = await TestWorkers.ReadJsonAsync(await api.SendAsync(HttpMethod.Post, "/api/workers",
            new { workerCode = "MS" + Guid.NewGuid().ToString("N")[..8], fullName = "Salary Worker", designation = "Fitter", monthlySalary = 1600m }, token));
        var id = created.GetProperty("id").GetInt32();

        var updated = await TestWorkers.ReadJsonAsync(await api.SendAsync(HttpMethod.Put, $"/api/workers/{id}",
            new { workerCode = created.GetProperty("workerCode").GetString(), fullName = "Salary Worker", designation = "Fitter", hourlyRate = 6.67m }, token));

        Assert.Equal(1600m, updated.GetProperty("monthlySalary").GetDecimal());
    }

    [Fact]
    public async Task Supervisors_DoNotSeeTheSalary()
    {
        var (_, manager) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        var (_, supervisor) = await TestWorkers.SignInAsync(api, Roles.Supervisor);
        var json = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/workers/{worker.Id}", supervisor));
        Assert.Equal(System.Text.Json.JsonValueKind.Null, json.GetProperty("monthlySalary").ValueKind);
        _ = manager;
    }
}
