using System.Net;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Integration;

public class AttendanceRulesTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private const string Date = "2026-02-10";
    private static object Row(int id, string? status = "Present", decimal basic = 8, decimal overtime = 0) => new { workerId = id, status, basicHours = basic, overtimeHours = overtime };
    private async Task<string> Token() => (await TestWorkers.SignInAsync(api, Roles.HrStaff)).Token;

    [Theory]
    [InlineData("Present", 0, 0)]
    [InlineData("Present", 9, 0)]
    [InlineData("Present", 8, 17)]
    [InlineData("Present", -1, 0)]
    [InlineData("Present", 8, -1)]
    [InlineData("Present", 7.751, 0)]
    [InlineData("Present", 8, 0.001)]
    [InlineData("Absent", -1, 0)]
    [InlineData("Absent", 0, -1)]
    [InlineData("Absent", 0.001, 0)]
    [InlineData("present", 8, 0)]
    [InlineData("Not recorded", 0, 0)]
    [InlineData(null, 8, 0)]
    public async Task InvalidBatch_ChangesNoRowsOrAudit(string? status, double basic, double overtime)
    {
        var (actor, token) = await TestWorkers.SignInAsync(api, Roles.HrStaff);
        var first = await TestWorkers.CreateAsync(api.ConnectionString);
        var second = await TestWorkers.CreateAsync(api.ConnectionString);
        var result = await api.SendAsync(HttpMethod.Put, $"/api/attendance/{Date}",
            new[] { Row(first.Id), Row(second.Id, status, (decimal)basic, (decimal)overtime) }, token);
        Assert.Equal(HttpStatusCode.BadRequest, result.StatusCode);
        var json = await TestWorkers.ReadJsonAsync(result);
        Assert.NotEmpty(json.GetProperty("errors").EnumerateObject());
        await using var db = TestUsers.NewContext(api.ConnectionString);
        Assert.False(await db.Attendance.AnyAsync(a => a.WorkerId == first.Id || a.WorkerId == second.Id));
        Assert.False(await db.AuditLogs.AnyAsync(a => a.ActorUsername == actor && a.Action == "AttendanceSaved"));
    }

    [Theory]
    [InlineData("2026-2-10")]
    [InlineData("2026-02-30")]
    [InlineData("10/02/2026")]
    [InlineData("9999-12-31")]
    [InlineData("2026-02-10T00:00:00")]
    public async Task InvalidOrFutureDate_RejectedOnEveryRoute(string date)
    {
        var token = await Token();
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        Assert.Equal(HttpStatusCode.BadRequest, (await api.GetAsync($"/api/attendance?date={date}", token)).StatusCode);
        var routeDate = Uri.EscapeDataString(date);
        Assert.Equal(HttpStatusCode.BadRequest, (await api.SendAsync(HttpMethod.Put, $"/api/attendance/{routeDate}", new[] { Row(worker.Id) }, token)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await api.SendAsync(HttpMethod.Delete, $"/api/attendance/{routeDate}/{worker.Id}", token: token)).StatusCode);
    }

    [Theory]
    [InlineData("duplicate")]
    [InlineData("unknown")]
    [InlineData("null-row")]
    public async Task BadWorkers_RejectWholeBatch(string kind)
    {
        var token = await Token();
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        object? invalid = kind switch { "duplicate" => Row(worker.Id), "unknown" => Row(int.MaxValue), _ => null };
        Assert.Equal(HttpStatusCode.BadRequest, (await api.SendAsync(HttpMethod.Put, $"/api/attendance/{Date}", new object?[] { Row(worker.Id), invalid }, token)).StatusCode);
        await using var db = TestUsers.NewContext(api.ConnectionString);
        Assert.False(await db.Attendance.AnyAsync(a => a.WorkerId == worker.Id));
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("{\"status\":\"Present\",\"basicHours\":8}")]
    [InlineData("{\"basicHours\":0,\"overtimeHours\":0}")]
    [InlineData("null")]
    public async Task MissingFields_AndNullRowsRejected(string fields)
    {
        var token = await Token();
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        var row = fields == "null" ? fields : fields.Insert(1, $"\"workerId\":{worker.Id},");
        // The {} case is otherwise malformed by insertion; test a valid object with just workerId.
        if (fields == "{}") row = $"{{\"workerId\":{worker.Id}}}";
        Assert.Equal(HttpStatusCode.BadRequest, (await api.SendJsonAsync(HttpMethod.Put, $"/api/attendance/{Date}", $"[{row}]", token)).StatusCode);
    }

    [Fact]
    public async Task Absent_NormalisesHours_UpsertIsUnique_AndAuditContainsChangedWorkers()
    {
        var (actor, token) = await TestWorkers.SignInAsync(api, Roles.HrStaff);
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        foreach (var row in new[] { Row(worker.Id), Row(worker.Id, "Absent", 8, 2), Row(worker.Id, "Absent", 0, 0) })
            Assert.Equal(HttpStatusCode.OK, (await api.SendAsync(HttpMethod.Put, $"/api/attendance/{Date}", new[] { row }, token)).StatusCode);
        await using var db = TestUsers.NewContext(api.ConnectionString);
        var record = await db.Attendance.SingleAsync(a => a.WorkerId == worker.Id);
        Assert.Equal("Absent", record.Status);
        Assert.Equal(0, record.BasicHours);
        Assert.Equal(0, record.OvertimeHours);
        Assert.Equal(actor, record.UpdatedBy);
        var audits = await db.AuditLogs.Where(a => a.ActorUsername == actor && a.Action == "AttendanceSaved").ToListAsync();
        Assert.Equal(2, audits.Count);
        foreach (var audit in audits)
        {
            var details = JsonDocument.Parse(audit.DetailsJson!).RootElement;
            Assert.Equal(Date, details.GetProperty("date").GetString());
            Assert.Equal(1, details.GetProperty("numberOfRows").GetInt32());
            Assert.Equal(worker.Id, details.GetProperty("workersChanged")[0].GetInt32());
        }
        var deletion = await api.SendAsync(HttpMethod.Delete, $"/api/workers/{worker.Id}", token: token);
        Assert.Equal(HttpStatusCode.Conflict, deletion.StatusCode);
        Assert.Contains("Deactivate", await deletion.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task InactiveWorkers_OnlyAppearAndCanEditWhenDateAlreadyRecorded()
    {
        var token = await Token();
        var recorded = await TestWorkers.CreateAsync(api.ConnectionString);
        var inactive = await TestWorkers.CreateAsync(api.ConnectionString, isActive: false);
        await api.SendAsync(HttpMethod.Put, $"/api/attendance/{Date}", new[] { Row(recorded.Id) }, token);
        await api.SendAsync(HttpMethod.Post, $"/api/workers/{recorded.Id}/deactivate", token: token);
        var day = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/attendance?date={Date}", token));
        var ids = day.GetProperty("rows").EnumerateArray().Select(r => r.GetProperty("worker").GetProperty("id").GetInt32()).ToArray();
        Assert.Contains(recorded.Id, ids);
        Assert.DoesNotContain(inactive.Id, ids);
        Assert.Equal(HttpStatusCode.OK, (await api.SendAsync(HttpMethod.Put, $"/api/attendance/{Date}", new[] { Row(recorded.Id, "Absent") }, token)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await api.SendAsync(HttpMethod.Put, $"/api/attendance/{Date}", new[] { Row(inactive.Id) }, token)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await api.SendAsync(HttpMethod.Put, "/api/attendance/2026-02-11", new[] { Row(recorded.Id) }, token)).StatusCode);
    }

    [Fact]
    public async Task ExplicitNull_ClearsInSameBatch_AndInvalidPeerRollsClearBack()
    {
        var token = await Token();
        var first = await TestWorkers.CreateAsync(api.ConnectionString);
        var second = await TestWorkers.CreateAsync(api.ConnectionString);
        await api.SendAsync(HttpMethod.Put, $"/api/attendance/{Date}", new[] { Row(first.Id) }, token);
        Assert.Equal(HttpStatusCode.BadRequest, (await api.SendAsync(HttpMethod.Put, $"/api/attendance/{Date}", new[] { Row(first.Id, null, 0), Row(second.Id, basic: 9) }, token)).StatusCode);
        await using var db = TestUsers.NewContext(api.ConnectionString);
        Assert.True(await db.Attendance.AnyAsync(a => a.WorkerId == first.Id));
        Assert.Equal(HttpStatusCode.OK, (await api.SendAsync(HttpMethod.Put, $"/api/attendance/{Date}", new[] { Row(first.Id, null, 0), Row(second.Id) }, token)).StatusCode);
        Assert.False(await db.Attendance.AnyAsync(a => a.WorkerId == first.Id));
        Assert.True(await db.Attendance.AnyAsync(a => a.WorkerId == second.Id));
    }

    [Fact]
    public async Task ConcurrentUpserts_DoNotLeakDuplicateOrDeadlockAs500()
    {
        var token = await Token();
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        var responses = await Task.WhenAll(Enumerable.Range(0, 4).Select(_ => api.SendAsync(HttpMethod.Put,
            $"/api/attendance/{Date}", new[] { Row(worker.Id) }, token)));
        Assert.All(responses, r => Assert.True(r.StatusCode is HttpStatusCode.OK or HttpStatusCode.Conflict, $"Unexpected {r.StatusCode}"));
        Assert.Contains(responses, r => r.StatusCode == HttpStatusCode.OK);
        await using var db = TestUsers.NewContext(api.ConnectionString);
        Assert.Equal(1, await db.Attendance.CountAsync(a => a.WorkerId == worker.Id));
    }
}
