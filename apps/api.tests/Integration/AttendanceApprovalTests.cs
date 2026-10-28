using System.Net;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>Supervisors submit attendance; managers approve it; only approved entries reach payroll.</summary>
public class AttendanceApprovalTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private const string Date = "2025-03-12";
    private const string Month = "2025-03";

    private static object Present(int workerId, decimal basic = 8m, decimal overtime = 0m) =>
        new[] { new { workerId, status = "Present", basicHours = basic, overtimeHours = overtime } };

    private async Task<JsonElement> DayAsync(string token, string date = Date) =>
        await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/attendance?date={date}", token));

    private static JsonElement Row(JsonElement day, int workerId) => day.GetProperty("rows").EnumerateArray()
        .Single(r => r.GetProperty("worker").GetProperty("id").GetInt32() == workerId);

    private async Task<decimal?> PayrollTotalAsync(string managerToken, int workerId)
    {
        var report = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/payroll?month={Month}", managerToken));
        var line = report.GetProperty("lines").EnumerateArray().FirstOrDefault(l => l.GetProperty("workerId").GetInt32() == workerId);
        return line.ValueKind == JsonValueKind.Undefined ? null : line.GetProperty("totalPay").GetDecimal();
    }

    [Fact]
    public async Task SupervisorSave_IsSubmitted_AndPayrollIgnoresItUntilApproved()
    {
        var (_, supervisor) = await TestWorkers.SignInAsync(api, Roles.Supervisor);
        var (_, manager) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, hourlyRate: 10m);

        var saved = await api.SendAsync(HttpMethod.Put, $"/api/attendance/{Date}", Present(worker.Id), supervisor);
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var record = Row(await TestWorkers.ReadJsonAsync(saved), worker.Id).GetProperty("record");
        Assert.Equal("Submitted", record.GetProperty("approvalStatus").GetString());

        // Salary 2400; March 2025 has 26 non-Sunday days, all unpaid until one is approved: 2400 - 26 x 80.
        Assert.Equal(320m, await PayrollTotalAsync(manager, worker.Id));

        var approved = await api.SendAsync(HttpMethod.Post, $"/api/attendance/{Date}/approve", new { workerIds = new[] { worker.Id } }, manager);
        Assert.Equal(HttpStatusCode.OK, approved.StatusCode);
        Assert.Equal("Approved", Row(await DayAsync(manager), worker.Id).GetProperty("record").GetProperty("approvalStatus").GetString());
        Assert.Equal(400m, await PayrollTotalAsync(manager, worker.Id)); // the approved day is no longer deducted
    }

    [Fact]
    public async Task ManagerSave_IsApprovedDirectly_AndCountsInPayroll()
    {
        var (_, manager) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, hourlyRate: 10m);
        var saved = await api.SendAsync(HttpMethod.Put, $"/api/attendance/{Date}", Present(worker.Id, 6m), manager);
        Assert.Equal("Approved", Row(await TestWorkers.ReadJsonAsync(saved), worker.Id).GetProperty("record").GetProperty("approvalStatus").GetString());
        // The salary is fixed, so a 6-hour day is still a paid day: 2400 - 25 x 80.
        Assert.Equal(400m, await PayrollTotalAsync(manager, worker.Id));
    }

    [Fact]
    public async Task ApproveAll_ApprovesEverySubmittedEntryForTheDate()
    {
        var (_, supervisor) = await TestWorkers.SignInAsync(api, Roles.Supervisor);
        var (_, manager) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var first = await TestWorkers.CreateAsync(api.ConnectionString);
        var second = await TestWorkers.CreateAsync(api.ConnectionString);
        await api.SendAsync(HttpMethod.Put, "/api/attendance/2025-03-13", new object[]
        {
            new { workerId = first.Id, status = "Present", basicHours = 8m, overtimeHours = 0m },
            new { workerId = second.Id, status = "Absent", basicHours = 0m, overtimeHours = 0m },
        }, supervisor);

        Assert.Equal(HttpStatusCode.OK, (await api.SendAsync(HttpMethod.Post, "/api/attendance/2025-03-13/approve", new { }, manager)).StatusCode);

        var day = await DayAsync(manager, "2025-03-13");
        Assert.Equal("Approved", Row(day, first.Id).GetProperty("record").GetProperty("approvalStatus").GetString());
        Assert.Equal("Approved", Row(day, second.Id).GetProperty("record").GetProperty("approvalStatus").GetString());
        Assert.Equal(0, day.GetProperty("pendingCount").GetInt32());
    }

    [Fact]
    public async Task SupervisorCannotChangeAnApprovedEntry_ButMayResaveItUnchanged()
    {
        var (_, supervisor) = await TestWorkers.SignInAsync(api, Roles.Supervisor);
        var (_, manager) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        await api.SendAsync(HttpMethod.Put, $"/api/attendance/{Date}", Present(worker.Id), manager);

        var changed = await api.SendAsync(HttpMethod.Put, $"/api/attendance/{Date}", Present(worker.Id, 7m), supervisor);
        Assert.Equal(HttpStatusCode.BadRequest, changed.StatusCode);
        Assert.Contains("already approved", await changed.Content.ReadAsStringAsync());

        var cleared = await api.SendAsync(HttpMethod.Delete, $"/api/attendance/{Date}/{worker.Id}", token: supervisor);
        Assert.Equal(HttpStatusCode.BadRequest, cleared.StatusCode);

        var unchanged = await api.SendAsync(HttpMethod.Put, $"/api/attendance/{Date}", Present(worker.Id), supervisor);
        Assert.Equal(HttpStatusCode.OK, unchanged.StatusCode);
        var record = Row(await DayAsync(manager), worker.Id).GetProperty("record");
        Assert.Equal("Approved", record.GetProperty("approvalStatus").GetString());
        Assert.Equal(8m, record.GetProperty("basicHours").GetDecimal());
    }

    [Fact]
    public async Task Reject_NeedsAReason_AndSendsTheEntryBackToTheSupervisor()
    {
        var (_, supervisor) = await TestWorkers.SignInAsync(api, Roles.Supervisor);
        var (_, manager) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, hourlyRate: 10m);
        await api.SendAsync(HttpMethod.Put, $"/api/attendance/{Date}", Present(worker.Id), supervisor);

        var noReason = await api.SendAsync(HttpMethod.Post, $"/api/attendance/{Date}/reject", new { workerIds = new[] { worker.Id }, reason = " " }, manager);
        Assert.Equal(HttpStatusCode.BadRequest, noReason.StatusCode);
        Assert.Contains("reason", await noReason.Content.ReadAsStringAsync());

        var rejected = await api.SendAsync(HttpMethod.Post, $"/api/attendance/{Date}/reject", new { workerIds = new[] { worker.Id }, reason = "Check the overtime hours" }, manager);
        Assert.Equal(HttpStatusCode.OK, rejected.StatusCode);
        var record = Row(await DayAsync(supervisor), worker.Id).GetProperty("record");
        Assert.Equal("Rejected", record.GetProperty("approvalStatus").GetString());
        Assert.Equal("Check the overtime hours", record.GetProperty("rejectionReason").GetString());
        // Salary 2400; March 2025 has 26 non-Sunday days, all unpaid until one is approved: 2400 - 26 x 80.
        Assert.Equal(320m, await PayrollTotalAsync(manager, worker.Id));

        // The supervisor corrects it: it is resubmitted and the reason is cleared.
        await api.SendAsync(HttpMethod.Put, $"/api/attendance/{Date}", Present(worker.Id, 7m), supervisor);
        var resubmitted = Row(await DayAsync(supervisor), worker.Id).GetProperty("record");
        Assert.Equal("Submitted", resubmitted.GetProperty("approvalStatus").GetString());
        Assert.Equal(JsonValueKind.Null, resubmitted.GetProperty("rejectionReason").ValueKind);
    }

    [Fact]
    public async Task SupervisorResavingARejectedEntryUnchanged_ResubmitsIt()
    {
        var (_, supervisor) = await TestWorkers.SignInAsync(api, Roles.Supervisor);
        var (_, manager) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        await api.SendAsync(HttpMethod.Put, $"/api/attendance/{Date}", Present(worker.Id), supervisor);
        await api.SendAsync(HttpMethod.Post, $"/api/attendance/{Date}/reject", new { workerIds = new[] { worker.Id }, reason = "Wrong day" }, manager);

        await api.SendAsync(HttpMethod.Put, $"/api/attendance/{Date}", Present(worker.Id), supervisor);

        Assert.Equal("Submitted", Row(await DayAsync(manager), worker.Id).GetProperty("record").GetProperty("approvalStatus").GetString());
    }

    [Fact]
    public async Task ApproveAndReject_AreManagerOnly_AndRejectOnlyTouchesSubmittedEntries()
    {
        var (_, supervisor) = await TestWorkers.SignInAsync(api, Roles.Supervisor);
        var (_, manager) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var (_, administrator) = await TestWorkers.SignInAsync(api, Roles.Administrator);
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        await api.SendAsync(HttpMethod.Put, $"/api/attendance/{Date}", Present(worker.Id), supervisor);

        Assert.Equal(HttpStatusCode.Unauthorized, (await api.SendAsync(HttpMethod.Post, $"/api/attendance/{Date}/approve", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await api.SendAsync(HttpMethod.Post, $"/api/attendance/{Date}/approve", new { }, supervisor)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await api.SendAsync(HttpMethod.Post, $"/api/attendance/{Date}/reject",
            new { workerIds = new[] { worker.Id }, reason = "No" }, supervisor)).StatusCode);
        Assert.Equal("Submitted", Row(await DayAsync(manager), worker.Id).GetProperty("record").GetProperty("approvalStatus").GetString());

        Assert.Equal(HttpStatusCode.OK, (await api.SendAsync(HttpMethod.Post, $"/api/attendance/{Date}/approve",
            new { workerIds = new[] { worker.Id } }, administrator)).StatusCode);

        // An already-approved entry cannot be rejected.
        var late = await api.SendAsync(HttpMethod.Post, $"/api/attendance/{Date}/reject", new { workerIds = new[] { worker.Id }, reason = "Too late" }, manager);
        Assert.Equal(HttpStatusCode.BadRequest, late.StatusCode);
    }

    [Fact]
    public async Task Summary_ListsSubmittedAndRejectedDays_ForAnySignedInUser()
    {
        var (_, supervisor) = await TestWorkers.SignInAsync(api, Roles.Supervisor);
        var (_, manager) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        await api.SendAsync(HttpMethod.Put, "/api/attendance/2025-04-02", Present(worker.Id), supervisor);
        await api.SendAsync(HttpMethod.Put, "/api/attendance/2025-04-03", Present(worker.Id), supervisor);
        await api.SendAsync(HttpMethod.Post, "/api/attendance/2025-04-03/reject", new { workerIds = new[] { worker.Id }, reason = "Redo" }, manager);

        Assert.Equal(HttpStatusCode.Unauthorized, (await api.GetAsync("/api/attendance/summary")).StatusCode);
        var summary = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/attendance/summary", supervisor));
        Assert.Contains(summary.GetProperty("submitted").EnumerateArray(), d => d.GetProperty("date").GetString() == "2025-04-02");
        Assert.Contains(summary.GetProperty("rejected").EnumerateArray(), d => d.GetProperty("date").GetString() == "2025-04-03");
        Assert.True(summary.GetProperty("submittedTotal").GetInt32() >= 1);
        Assert.True(summary.GetProperty("rejectedTotal").GetInt32() >= 1);
    }

    [Fact]
    public async Task Finalise_IsBlockedWhileEntriesAreWaitingForApproval()
    {
        var (_, supervisor) = await TestWorkers.SignInAsync(api, Roles.Supervisor);
        var (_, manager) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        await api.SendAsync(HttpMethod.Put, "/api/attendance/2024-03-05", Present(worker.Id), supervisor);

        var report = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/payroll?month=2024-03", manager));
        Assert.True(report.GetProperty("pendingApprovalCount").GetInt32() >= 1);

        var finalise = await api.PostAsync("/api/payroll/2024-03/finalise", new { revision = report.GetProperty("revision").GetString() }, manager);
        Assert.Equal(HttpStatusCode.Conflict, finalise.StatusCode);
        Assert.Contains("waiting for approval", await finalise.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task ExistingRowsKeepCounting_BecauseTheColumnDefaultIsApproved()
    {
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        await using (var db = TestUsers.NewContext(api.ConnectionString))
        {
            await db.Database.ExecuteSqlRawAsync(
                "INSERT INTO Attendance (WorkerId, WorkDate, Status, BasicHours, OvertimeHours, UpdatedUtc, UpdatedBy) VALUES ({0}, '2025-05-06', 'Present', 8, 0, SYSUTCDATETIME(), 'legacy')", worker.Id);
        }
        var (_, manager) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var row = Row(await DayAsync(manager, "2025-05-06"), worker.Id).GetProperty("record");
        Assert.Equal("Approved", row.GetProperty("approvalStatus").GetString());
    }
}
