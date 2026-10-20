using System.Net;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Integration;

public sealed class LeaveTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private static Task<JsonElement> Json(HttpResponseMessage r) => TestWorkers.ReadJsonAsync(r);
    private async Task<(int Worker, string Token)> Setup(string role = Roles.HrStaff)
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
        var id = (await Json(await Create(worker, token))).GetProperty("id").GetInt32();
        Assert.Equal(HttpStatusCode.Conflict, (await Create(worker, token, "2028-03-01", "2028-03-02")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await api.PostAsync($"/api/leave/{id}/approve", new { }, token)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await api.SendAsync(HttpMethod.Delete, $"/api/leave/{id}", token: token)).StatusCode);
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

    [Theory]
    [InlineData(null, 401)]
    [InlineData(Roles.Viewer, 403)]
    public async Task All_mutations_are_protected(string? role, int status)
    {
        string? token = role is null ? null : (await TestWorkers.SignInAsync(api, role)).Token;
        foreach (var path in new[] { "/api/leave", "/api/leave/1/approve", "/api/leave/1/reject" })
            Assert.Equal(status, (int)(await api.PostAsync(path, new { }, token)).StatusCode);
        Assert.Equal(status, (int)(await api.SendAsync(HttpMethod.Delete, "/api/leave/1", token: token)).StatusCode);
        Assert.Equal(role is null ? 401 : 200, (int)(await api.GetAsync("/api/leave", token)).StatusCode);
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
