using System.Net;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>Approved leave fills Daily Attendance for each day and locks those days; losing the approval clears them.</summary>
public class LeaveAttendanceLinkTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private static object Row(int id, string? status, decimal basic = 0) => new { workerId = id, status, basicHours = basic, overtimeHours = 0m };

    private async Task<Worker> WorkerAsync()
    {
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        await using var db = TestUsers.NewContext(api.ConnectionString);
        await db.Workers.Where(w => w.Id == worker.Id).ExecuteUpdateAsync(s => s.SetProperty(w => w.JoinDate, new DateOnly(2020, 1, 1)));
        return worker;
    }

    private async Task<int> ApprovedLeaveAsync(string token, int workerId, string type, string start, string end)
    {
        var created = await api.SendAsync(HttpMethod.Post, "/api/leave", new { workerId, leaveType = type, startDate = start, endDate = end }, token);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var id = (await TestWorkers.ReadJsonAsync(created)).GetProperty("id").GetInt32();
        Assert.Equal(HttpStatusCode.OK, (await api.SendAsync(HttpMethod.Post, $"/api/leave/{id}/approve", token: token)).StatusCode);
        return id;
    }

    private async Task<List<Attendance>> RecordsAsync(int workerId)
    {
        await using var db = TestUsers.NewContext(api.ConnectionString);
        return await db.Attendance.AsNoTracking().Where(a => a.WorkerId == workerId).OrderBy(a => a.WorkDate).ToListAsync();
    }

    [Fact]
    public async Task ApprovingLeave_MarksEveryDay_AtTheStandardShift()
    {
        var (_, manager) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var worker = await WorkerAsync();
        await ApprovedLeaveAsync(manager, worker.Id, "Annual Leave", "2026-06-01", "2026-06-03");
        var records = await RecordsAsync(worker.Id);
        Assert.Equal(3, records.Count);
        Assert.All(records, r =>
        {
            Assert.Equal("Annual Leave", r.Status);
            Assert.True(r.BasicHours > 0);
            Assert.Equal(0m, r.OvertimeHours);
            Assert.Equal(ApprovalStatuses.Approved, r.ApprovalStatus);
        });
    }

    [Fact]
    public async Task PendingLeave_DoesNotTouchAttendance()
    {
        var (_, manager) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var worker = await WorkerAsync();
        var created = await api.SendAsync(HttpMethod.Post, "/api/leave", new { workerId = worker.Id, leaveType = "Annual Leave", startDate = "2026-06-10", endDate = "2026-06-11" }, manager);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Empty(await RecordsAsync(worker.Id));
    }

    [Theory]
    [InlineData(Roles.Supervisor)]
    [InlineData(Roles.Manager)]
    [InlineData(Roles.Administrator)]
    public async Task CoveredDay_CannotBeMarkedPresentOrCleared_ByAnyone(string role)
    {
        var (_, manager) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var (_, token) = await TestWorkers.SignInAsync(api, role);
        var worker = await WorkerAsync();
        await ApprovedLeaveAsync(manager, worker.Id, "Sick Leave", "2026-06-15", "2026-06-16");
        var present = await api.SendAsync(HttpMethod.Put, "/api/attendance/2026-06-15", new[] { Row(worker.Id, "Present", 8) }, token);
        Assert.Equal(HttpStatusCode.BadRequest, present.StatusCode);
        Assert.Contains("approved Sick Leave", await present.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.BadRequest, (await api.SendAsync(HttpMethod.Delete, $"/api/attendance/2026-06-15/{worker.Id}", token: token)).StatusCode);
        Assert.All(await RecordsAsync(worker.Id), r => Assert.Equal("Sick Leave", r.Status));
    }

    [Fact]
    public async Task Attendance_ShowsWhichDaysAreOnApprovedLeave()
    {
        var (_, manager) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var worker = await WorkerAsync();
        await ApprovedLeaveAsync(manager, worker.Id, "Emergency Leave", "2026-06-20", "2026-06-20");
        var day = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/attendance?date=2026-06-20", manager));
        var mine = day.GetProperty("rows").EnumerateArray().First(r => r.GetProperty("worker").GetProperty("id").GetInt32() == worker.Id);
        Assert.Equal("Emergency Leave", mine.GetProperty("approvedLeave").GetString());
        Assert.Equal("Emergency Leave", mine.GetProperty("record").GetProperty("status").GetString());
    }

    [Fact]
    public async Task DeletingApprovedLeave_FreesTheDays()
    {
        var (_, manager) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var worker = await WorkerAsync();
        var id = await ApprovedLeaveAsync(manager, worker.Id, "Annual Leave", "2026-07-01", "2026-07-02");
        Assert.Equal(2, (await RecordsAsync(worker.Id)).Count);
        Assert.Equal(HttpStatusCode.NoContent, (await api.SendAsync(HttpMethod.Delete, $"/api/leave/{id}", token: manager)).StatusCode);
        Assert.Empty(await RecordsAsync(worker.Id));
        var present = await api.SendAsync(HttpMethod.Put, "/api/attendance/2026-07-01", new[] { Row(worker.Id, "Present", 8) }, manager);
        Assert.Equal(HttpStatusCode.OK, present.StatusCode);
    }

    [Fact]
    public async Task RejectingApprovedLeave_ClearsTheDays()
    {
        var (_, manager) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var worker = await WorkerAsync();
        var id = await ApprovedLeaveAsync(manager, worker.Id, "Annual Leave", "2026-07-10", "2026-07-11");
        Assert.Equal(HttpStatusCode.OK, (await api.SendAsync(HttpMethod.Post, $"/api/leave/{id}/reject", token: manager)).StatusCode);
        Assert.Empty(await RecordsAsync(worker.Id));
    }

    [Fact]
    public async Task ApprovedUnpaidLeave_IsRecordedAsAbsent()
    {
        var (_, manager) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var worker = await WorkerAsync();
        await ApprovedLeaveAsync(manager, worker.Id, "Unpaid Leave", "2026-07-20", "2026-07-21");
        var records = await RecordsAsync(worker.Id);
        Assert.Equal(2, records.Count);
        Assert.All(records, r =>
        {
            Assert.Equal("Absent", r.Status);
            Assert.Equal(0m, r.BasicHours);
        });
    }

    [Fact]
    public async Task ApprovingLeave_ReplacesAnEarlierPresentMark()
    {
        var (_, manager) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var worker = await WorkerAsync();
        Assert.Equal(HttpStatusCode.OK, (await api.SendAsync(HttpMethod.Put, "/api/attendance/2026-08-03", new[] { Row(worker.Id, "Present", 8) }, manager)).StatusCode);
        await ApprovedLeaveAsync(manager, worker.Id, "Annual Leave", "2026-08-03", "2026-08-04");
        var records = await RecordsAsync(worker.Id);
        Assert.Equal(2, records.Count);
        Assert.All(records, r => Assert.Equal("Annual Leave", r.Status));
    }
}
