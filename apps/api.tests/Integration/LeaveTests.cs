using System.Net;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Integration;

public sealed class LeaveTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private static Task<JsonElement> Json(HttpResponseMessage r) => TestWorkers.ReadJsonAsync(r);
    private async Task<(int Worker, string Token)> Setup(string role = Roles.Manager)
    {
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        var (_, token) = await TestWorkers.SignInAsync(api, role);
        return (worker.Id, token);
    }
    private Task<HttpResponseMessage> Create(int worker, string token, string start = "2028-02-28", string end = "2028-03-01", string type = "Annual Leave") =>
        api.PostAsync("/api/leave", new { workerId = worker, leaveType = type, startDate = start, endDate = end }, token);

    [Theory]
    [InlineData("2028-02-28", "2028-03-01", 3)]
    [InlineData("2026-10-20", "2026-10-20", 1)]
    [InlineData("0001-01-01", "9999-12-31", 3652059)]
    [InlineData("2026-01-31", "2026-02-01", 2)]
    public async Task Creation_computes_days_and_audits(string start, string end, int days)
    {
        var (worker, token) = await Setup();
        var r = await Create(worker, token, start, end);
        Assert.Equal(HttpStatusCode.Created, r.StatusCode);
        var body = await Json(r);
        Assert.Equal(days, body.GetProperty("days").GetInt32());
        Assert.Equal("Pending", body.GetProperty("status").GetString());
        Assert.Equal(start, body.GetProperty("startDate").GetString());
        Assert.EndsWith("Z", body.GetProperty("createdUtc").GetString());
        Assert.Equal(JsonValueKind.Null, body.GetProperty("decidedBy").ValueKind);
        await using var db = TestUsers.NewContext(api.ConnectionString);
        Assert.True(await db.AuditLogs.AnyAsync(a => a.Action == "LeaveCreated" && a.EntityId == body.GetProperty("id").GetInt32().ToString()));
    }

    [Theory]
    [InlineData(0, "Bad", "bad", "bad", "workerId,leaveType,startDate,endDate")]
    [InlineData(1, "Annual Leave", "2026-1-01", "2026-02-01", "startDate")]
    [InlineData(1, "Sick Leave", "2026-02-30", "2026-03-01", "startDate")]
    [InlineData(1, "Unpaid Leave", "2026-02-02", "2026-02-01", "endDate")]
    public async Task Invalid_fields_are_mapped(int worker, string type, string start, string end, string fields)
    {
        var (id, token) = await Setup();
        var r = await Create(worker == 0 ? 0 : id, token, start, end, type);
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        var errors = (await Json(r)).GetProperty("errors");
        foreach (var field in fields.Split(',')) Assert.True(errors.TryGetProperty(field, out _), field);
    }

    [Fact]
    public async Task Closed_overlap_reject_reapprove_and_delete_follow_policy()
    {
        var (worker, token) = await Setup();
        var (_, supervisor) = await TestWorkers.SignInAsync(api, Roles.Supervisor);
        var id = (await Json(await Create(worker, supervisor))).GetProperty("id").GetInt32();
        Assert.Equal(HttpStatusCode.Conflict, (await Create(worker, token, "2028-03-01", "2028-03-02")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await api.PostAsync($"/api/leave/{id}/approve", new { }, token)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await api.SendAsync(HttpMethod.Delete, $"/api/leave/{id}", token: supervisor)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await api.PostAsync($"/api/leave/{id}/reject", new { }, token)).StatusCode);
        var second = (await Json(await Create(worker, token))).GetProperty("id").GetInt32();
        Assert.Equal(HttpStatusCode.Conflict, (await api.PostAsync($"/api/leave/{id}/approve", new { }, token)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await api.SendAsync(HttpMethod.Delete, $"/api/leave/{second}", token: token)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await api.PostAsync($"/api/leave/{id}/approve", new { }, token)).StatusCode);
        var (_, admin) = await TestWorkers.SignInAsync(api, Roles.Administrator);
        Assert.Equal(HttpStatusCode.NoContent, (await api.SendAsync(HttpMethod.Delete, $"/api/leave/{id}", token: admin)).StatusCode);
    }

    [Fact]
    public async Task Concurrent_creations_cannot_reserve_the_same_interval()
    {
        var (worker, token) = await Setup();
        var responses = await Task.WhenAll(Create(worker, token), Create(worker, token));
        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.Created);
        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task Anonymous_callers_are_rejected_on_every_route()
    {
        foreach (var path in new[] { "/api/leave", "/api/leave/1/approve", "/api/leave/1/reject" })
            Assert.Equal(HttpStatusCode.Unauthorized, (await api.PostAsync(path, new { }, null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await api.SendAsync(HttpMethod.Delete, "/api/leave/1")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await api.GetAsync("/api/leave")).StatusCode);
    }

    [Fact]
    public async Task Supervisor_can_read_and_raise_but_never_decide()
    {
        var (worker, supervisor) = await Setup(Roles.Supervisor);
        Assert.Equal(HttpStatusCode.OK, (await api.GetAsync("/api/leave", supervisor)).StatusCode);
        var id = (await Json(await Create(worker, supervisor))).GetProperty("id").GetInt32();
        foreach (var action in new[] { "approve", "reject" })
        {
            // Not even their own request, and not a request that does not exist: the policy answers first.
            Assert.Equal(HttpStatusCode.Forbidden, (await api.PostAsync($"/api/leave/{id}/{action}", new { }, supervisor)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await api.PostAsync($"/api/leave/2147483647/{action}", new { }, supervisor)).StatusCode);
        }
        var stored = (await Json(await api.GetAsync($"/api/leave?workerId={worker}", supervisor))).EnumerateArray().Single();
        Assert.Equal("Pending", stored.GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null, stored.GetProperty("decidedBy").ValueKind);
    }

    [Fact]
    public async Task Supervisor_cannot_decide_a_request_raised_by_someone_else()
    {
        var (worker, manager) = await Setup(Roles.Manager);
        var (_, supervisor) = await TestWorkers.SignInAsync(api, Roles.Supervisor);
        var id = (await Json(await Create(worker, manager))).GetProperty("id").GetInt32();
        Assert.Equal(HttpStatusCode.Forbidden, (await api.PostAsync($"/api/leave/{id}/approve", new { }, supervisor)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await api.PostAsync($"/api/leave/{id}/reject", new { }, supervisor)).StatusCode);
    }

    [Fact]
    public async Task Supervisor_deletes_only_their_own_pending_request()
    {
        var worker = (await TestWorkers.CreateAsync(api.ConnectionString)).Id;
        var (_, owner) = await TestWorkers.SignInAsync(api, Roles.Supervisor);
        var (_, other) = await TestWorkers.SignInAsync(api, Roles.Supervisor);
        var (_, manager) = await TestWorkers.SignInAsync(api, Roles.Manager);

        var mine = (await Json(await Create(worker, owner, "2030-01-01", "2030-01-02"))).GetProperty("id").GetInt32();
        Assert.Equal(HttpStatusCode.Forbidden, (await api.SendAsync(HttpMethod.Delete, $"/api/leave/{mine}", token: other)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await api.PostAsync($"/api/leave/{mine}/reject", new { }, manager)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await api.SendAsync(HttpMethod.Delete, $"/api/leave/{mine}", token: owner)).StatusCode);

        var pending = (await Json(await Create(worker, owner, "2030-02-01", "2030-02-02"))).GetProperty("id").GetInt32();
        Assert.Equal(HttpStatusCode.NoContent, (await api.SendAsync(HttpMethod.Delete, $"/api/leave/{pending}", token: owner)).StatusCode);

        var managers = (await Json(await Create(worker, manager, "2030-03-01", "2030-03-02"))).GetProperty("id").GetInt32();
        Assert.Equal(HttpStatusCode.Forbidden, (await api.SendAsync(HttpMethod.Delete, $"/api/leave/{managers}", token: owner)).StatusCode);

        await using var db = TestUsers.NewContext(api.ConnectionString);
        Assert.True(await db.LeaveRequests.AnyAsync(x => x.Id == mine));
        Assert.True(await db.LeaveRequests.AnyAsync(x => x.Id == managers));
        Assert.False(await db.LeaveRequests.AnyAsync(x => x.Id == pending));
    }

    [Fact]
    public async Task Manager_deletes_any_request_in_any_state()
    {
        var worker = (await TestWorkers.CreateAsync(api.ConnectionString)).Id;
        var (_, supervisor) = await TestWorkers.SignInAsync(api, Roles.Supervisor);
        var (_, manager) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var pending = (await Json(await Create(worker, supervisor, "2031-01-01", "2031-01-02"))).GetProperty("id").GetInt32();
        var approved = (await Json(await Create(worker, supervisor, "2031-02-01", "2031-02-02"))).GetProperty("id").GetInt32();
        Assert.Equal(HttpStatusCode.OK, (await api.PostAsync($"/api/leave/{approved}/approve", new { }, manager)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await api.SendAsync(HttpMethod.Delete, $"/api/leave/{pending}", token: manager)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await api.SendAsync(HttpMethod.Delete, $"/api/leave/{approved}", token: manager)).StatusCode);
    }

    [Theory]
    [InlineData("?status=approved")]
    [InlineData("?status=Unknown")]
    [InlineData("?workerId=0")]
    [InlineData("?workerId=-1")]
    [InlineData("?workerId=abc")]
    public async Task Filters_are_strict(string query)
    {
        var (_, token) = await Setup();
        Assert.Equal(HttpStatusCode.BadRequest, (await api.GetAsync("/api/leave" + query, token)).StatusCode);
    }

    [Fact]
    public async Task Missing_ids_return_problem_404()
    {
        var (_, token) = await Setup();
        foreach (var action in new[] { "approve", "reject" })
        {
            var r = await api.PostAsync($"/api/leave/2147483647/{action}", new { }, token);
            Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
            Assert.Equal("application/problem+json", r.Content.Headers.ContentType?.MediaType);
        }
        Assert.Equal(HttpStatusCode.NotFound, (await api.SendAsync(HttpMethod.Delete, "/api/leave/2147483647", token: token)).StatusCode);
    }
}
