using System.Net;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>R9: a finalised month's attendance pay comes only from the payroll snapshot, never live rates.</summary>
public class AttendanceFinalisedSnapshotPayTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private static JsonElement RowFor(JsonElement day, int workerId) =>
        day.GetProperty("rows").EnumerateArray().Single(r => r.GetProperty("worker").GetProperty("id").GetInt32() == workerId);

    private async Task SeedAsync(int workerId, DateOnly date, decimal basic, decimal overtime)
    {
        await using var seed = TestUsers.NewContext(api.ConnectionString);
        seed.Attendance.Add(new() { WorkerId = workerId, WorkDate = date, Status = "Present", BasicHours = basic, OvertimeHours = overtime, UpdatedUtc = DateTime.UtcNow, UpdatedBy = "test" });
        await seed.SaveChangesAsync();
    }

    private async Task<JsonElement> FinaliseAsync(string month, string token)
    {
        var draft = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/payroll?month={month}", token));
        var response = await api.PostAsync($"/api/payroll/{month}/finalise", new { revision = draft.GetProperty("revision").GetString() }, token);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await TestWorkers.ReadJsonAsync(response);
    }

    private async Task ChangeRatesAsync(int workerId, decimal hourly, decimal? overtime, decimal company)
    {
        await using var db = TestUsers.NewContext(api.ConnectionString);
        await db.Workers.Where(w => w.Id == workerId).ExecuteUpdateAsync(s => s.SetProperty(w => w.HourlyRate, hourly).SetProperty(w => w.OvertimeRate, overtime));
        await db.PayrollSettings.ExecuteUpdateAsync(s => s.SetProperty(p => p.OvertimeRatePerHour, company));
    }

    [Fact]
    public async Task FinalisedDay_UsesFrozenRates_AndMatchesReport_ThenReopenFollowsLiveRates()
    {
        var admin = await TestWorkers.SignInAsync(api, Roles.Administrator);
        var basicOnly = await TestWorkers.CreateAsync(api.ConnectionString, fullName: "Frozen Basic", hourlyRate: 15m);
        var custom = await TestWorkers.CreateAsync(api.ConnectionString, fullName: "Frozen Custom", hourlyRate: 12m, overtimeRate: 7.25m);
        var companyRate = await TestWorkers.CreateAsync(api.ConnectionString, fullName: "Frozen Company", hourlyRate: 10m);
        var date = new DateOnly(2019, 3, 5);
        await SeedAsync(basicOnly.Id, date, 8, 0);
        await SeedAsync(custom.Id, date, 8, 2);
        await SeedAsync(companyRate.Id, date, 8, 2);
        var frozen = await FinaliseAsync("2019-03", admin.Token);
        await ChangeRatesAsync(basicOnly.Id, 20m, 9m, 99m);
        await ChangeRatesAsync(custom.Id, 50m, 30m, 99m);
        await ChangeRatesAsync(companyRate.Id, 40m, null, 99m);

        var day = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/attendance?date={date:yyyy-MM-dd}", admin.Token));
        Assert.True(day.GetProperty("isFinalised").GetBoolean());
        foreach (var worker in new[] { basicOnly, custom, companyRate })
        {
            var line = frozen.GetProperty("lines").EnumerateArray().Single(l => l.GetProperty("workerId").GetInt32() == worker.Id);
            var pay = RowFor(day, worker.Id).GetProperty("dailyPay");
            Assert.Equal(line.GetProperty("basicPay").GetDecimal(), pay.GetProperty("basicPay").GetDecimal());
            Assert.Equal(line.GetProperty("overtimePay").GetDecimal(), pay.GetProperty("overtimePay").GetDecimal());
            Assert.Equal(line.GetProperty("totalPay").GetDecimal(), pay.GetProperty("totalPay").GetDecimal());
        }
        Assert.Equal(120m, RowFor(day, basicOnly.Id).GetProperty("dailyPay").GetProperty("totalPay").GetDecimal());
        Assert.Equal(96m + 14.50m, RowFor(day, custom.Id).GetProperty("dailyPay").GetProperty("totalPay").GetDecimal());
        // The rates shown on the row are the frozen ones too, so the client preview cannot disagree.
        Assert.Equal(15m, RowFor(day, basicOnly.Id).GetProperty("worker").GetProperty("hourlyRate").GetDecimal());
        Assert.Equal(7.25m, RowFor(day, custom.Id).GetProperty("worker").GetProperty("effectiveOvertimeRate").GetDecimal());

        var reopen = await api.SendAsync(HttpMethod.Delete, "/api/payroll/2019-03/finalise", new { reason = "rate fix" }, admin.Token);
        Assert.Equal(HttpStatusCode.OK, reopen.StatusCode);
        var live = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/attendance?date={date:yyyy-MM-dd}", admin.Token));
        Assert.False(live.GetProperty("isFinalised").GetBoolean());
        Assert.Equal(160m, RowFor(live, basicOnly.Id).GetProperty("dailyPay").GetProperty("basicPay").GetDecimal());
        Assert.Equal(20m, RowFor(live, basicOnly.Id).GetProperty("worker").GetProperty("hourlyRate").GetDecimal());
    }

    [Fact]
    public async Task OpenMonth_FollowsLiveRates()
    {
        var hr = await TestWorkers.SignInAsync(api, Roles.HrStaff);
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, hourlyRate: 15m);
        var date = new DateOnly(2019, 4, 5);
        await SeedAsync(worker.Id, date, 8, 0);
        await ChangeRatesAsync(worker.Id, 20m, null, 5m);
        var day = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/attendance?date={date:yyyy-MM-dd}", hr.Token));
        Assert.False(day.GetProperty("isFinalised").GetBoolean());
        Assert.Equal(160m, RowFor(day, worker.Id).GetProperty("dailyPay").GetProperty("totalPay").GetDecimal());
    }

    [Fact]
    public async Task FinalisedDay_WorkerWithoutSnapshotRow_GetsZeroPay_ButStaysVisible()
    {
        var admin = await TestWorkers.SignInAsync(api, Roles.Administrator);
        var date = new DateOnly(2019, 5, 6);
        await FinaliseAsync("2019-05", admin.Token);
        var late = await TestWorkers.CreateAsync(api.ConnectionString, hourlyRate: 15m);
        await SeedAsync(late.Id, date, 8, 1);
        var day = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/attendance?date={date:yyyy-MM-dd}", admin.Token));
        var row = RowFor(day, late.Id);
        Assert.Equal("Present", row.GetProperty("record").GetProperty("status").GetString());
        Assert.Equal(0m, row.GetProperty("dailyPay").GetProperty("totalPay").GetDecimal());
        Assert.Equal(0, row.GetProperty("dailyPay").GetProperty("daysWorked").GetInt32());
    }

    [Fact]
    public async Task FinalisedDay_WritesStillConflict_ForHrStaff()
    {
        var admin = await TestWorkers.SignInAsync(api, Roles.Administrator);
        var hr = await TestWorkers.SignInAsync(api, Roles.HrStaff);
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, hourlyRate: 15m);
        var date = new DateOnly(2019, 6, 5);
        await SeedAsync(worker.Id, date, 8, 0);
        await FinaliseAsync("2019-06", admin.Token);
        var put = await api.SendAsync(HttpMethod.Put, $"/api/attendance/{date:yyyy-MM-dd}",
            new[] { new { workerId = worker.Id, status = "Present", basicHours = 7m, overtimeHours = 0m } }, hr.Token);
        Assert.Equal(HttpStatusCode.Conflict, put.StatusCode);
    }
}
