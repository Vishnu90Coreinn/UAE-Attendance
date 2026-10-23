using System.Net;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Services;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>Paid leave: 30 annual (after 10 months), 15 sick and 5 emergency days per year from the join date.</summary>
public class LeaveEntitlementTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private static object Row(int id, string? status) => new { workerId = id, status, basicHours = 0m, overtimeHours = 0m };

    private async Task<Worker> WorkerAsync(DateOnly? joined)
    {
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        await using var db = TestUsers.NewContext(api.ConnectionString);
        await db.Workers.Where(w => w.Id == worker.Id).ExecuteUpdateAsync(s => s.SetProperty(w => w.JoinDate, joined));
        return worker;
    }

    private async Task<decimal> SaveAsync(string token, int workerId, string date, string status)
    {
        var response = await api.SendAsync(HttpMethod.Put, $"/api/attendance/{date}", new[] { Row(workerId, status) }, token);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        await using var db = TestUsers.NewContext(api.ConnectionString);
        return (await db.Attendance.SingleAsync(a => a.WorkerId == workerId && a.WorkDate == DateOnly.Parse(date))).BasicHours;
    }

    private async Task<decimal> Shift()
    {
        await using var db = TestUsers.NewContext(api.ConnectionString);
        return (await db.PayrollSettings.SingleAsync()).MaxBasicHoursPerDay;
    }

    [Fact]
    public async Task EmergencyLeave_IsPaidAtTheStandardShiftForFiveDays_ThenUnpaid()
    {
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var worker = await WorkerAsync(new DateOnly(2020, 1, 1));
        var shift = await Shift();
        for (var day = 4; day <= 8; day++)
            Assert.Equal(shift, await SaveAsync(token, worker.Id, $"2026-05-{day:00}", "Emergency Leave"));
        Assert.Equal(0m, await SaveAsync(token, worker.Id, "2026-05-09", "Emergency Leave"));
        // Re-saving an earlier paid day keeps its hours.
        Assert.Equal(shift, await SaveAsync(token, worker.Id, "2026-05-04", "Emergency Leave"));
    }

    [Fact]
    public async Task AnnualLeave_NeedsTenMonthsOfService()
    {
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var shift = await Shift();
        var early = await WorkerAsync(new DateOnly(2026, 1, 1));
        Assert.Equal(0m, await SaveAsync(token, early.Id, "2026-05-04", "Annual Leave"));
        var settled = await WorkerAsync(new DateOnly(2025, 6, 1));
        Assert.Equal(shift, await SaveAsync(token, settled.Id, "2026-05-04", "Annual Leave"));
        var unknown = await WorkerAsync(null);
        Assert.Equal(0m, await SaveAsync(token, unknown.Id, "2026-05-04", "Annual Leave"));
        Assert.Equal(shift, await SaveAsync(token, unknown.Id, "2026-05-05", "Sick Leave"));
    }

    [Fact]
    public async Task Balances_ShowAllowanceUsedAndRemaining()
    {
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var worker = await WorkerAsync(new DateOnly(2020, 1, 1));
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var year = today.Year;
        await SaveAsync(token, worker.Id, $"{year}-01-02", "Sick Leave");
        await SaveAsync(token, worker.Id, $"{year}-01-03", "Sick Leave");
        var json = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/leave/balances", token));
        var mine = json.EnumerateArray().First(w => w.GetProperty("workerId").GetInt32() == worker.Id);
        var sick = mine.GetProperty("balances").EnumerateArray().First(b => b.GetProperty("leaveType").GetString() == "Sick Leave");
        Assert.Equal(15, sick.GetProperty("allowance").GetInt32());
        Assert.Equal(2, sick.GetProperty("used").GetInt32());
        Assert.Equal(13, sick.GetProperty("remaining").GetInt32());
        var annual = mine.GetProperty("balances").EnumerateArray().First(b => b.GetProperty("leaveType").GetString() == "Annual Leave");
        Assert.Equal(30, annual.GetProperty("remaining").GetInt32());
    }

    [Theory]
    [InlineData("Annual Leave")]
    [InlineData("Sick Leave")]
    [InlineData("Emergency Leave")]
    public void PaidLeave_CountsAsAWorkedDay_AtBasicHoursOnly(string status)
    {
        var pay = PayrollCalculator.DailyPay(status, 8m, 3m, 10m, 6m);
        Assert.Equal(1, pay.DaysWorked);
        Assert.Equal(80m, pay.BasicPay);
        Assert.Equal(0m, pay.OvertimePay);
        var unpaid = PayrollCalculator.DailyPay(status, 0m, 0m, 10m, 6m);
        Assert.Equal(0, unpaid.DaysWorked);
        Assert.Equal(0m, unpaid.TotalPay);
    }

    [Fact]
    public void Periods_FollowTheJoinDateAnniversary()
    {
        var join = new DateOnly(2024, 3, 15);
        Assert.Null(LeaveEntitlements.Period(LeaveEntitlements.Annual, join, new DateOnly(2025, 1, 14)));
        Assert.Equal((new DateOnly(2025, 3, 15), new DateOnly(2026, 3, 14)),
            LeaveEntitlements.Period(LeaveEntitlements.Annual, join, new DateOnly(2025, 3, 15)));
        Assert.Equal((new DateOnly(2024, 3, 15), new DateOnly(2025, 3, 14)),
            LeaveEntitlements.Period(LeaveEntitlements.Sick, join, new DateOnly(2025, 3, 14)));
        Assert.Equal((new DateOnly(2026, 1, 1), new DateOnly(2026, 12, 31)),
            LeaveEntitlements.Period(LeaveEntitlements.Sick, null, new DateOnly(2026, 6, 1)));
    }
}
