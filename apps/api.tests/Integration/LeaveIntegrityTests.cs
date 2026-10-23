using System.Data;
using System.Data.Common;
using HrPayroll.Api.Data;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.AspNetCore.Http;
using System.Net;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using HrPayroll.Api.Services;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Integration;

public sealed class LeaveIntegrityTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private Task<HttpResponseMessage> Create(int worker, string token, string start = "2028-02-28", string end = "2028-03-01", string type = "Emergency Leave") =>
        api.PostAsync("/api/leave", new { workerId = worker, leaveType = type, startDate = start, endDate = end }, token);
    private static async Task<int> Id(HttpResponseMessage r)
    {
        Assert.Equal(HttpStatusCode.Created, r.StatusCode);
        return (await TestWorkers.ReadJsonAsync(r)).GetProperty("id").GetInt32();
    }

    [Fact]
    public async Task History_uses_current_worker_identity_and_inactive_workers_can_be_decided()
    {
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        var (username, token) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var id = await Id(await Create(worker.Id, token));
        await using (var db = TestUsers.NewContext(api.ConnectionString))
        {
            var row = await db.Workers.FindAsync(worker.Id);
            row!.IsActive = false;
            row.FullName = "Changed Name";
            row.WorkerCode = TestWorkers.UniqueCode();
            await db.SaveChangesAsync();
        }
        Assert.Equal(HttpStatusCode.BadRequest, (await Create(worker.Id, token, "2029-01-01", "2029-01-02")).StatusCode);
        foreach (var action in new[] { "approve", "approve", "reject", "reject", "approve" })
        {
            var r = await api.PostAsync($"/api/leave/{id}/{action}", new { }, token);
            Assert.Equal(HttpStatusCode.OK, r.StatusCode);
            var body = await TestWorkers.ReadJsonAsync(r);
            Assert.Equal(username, body.GetProperty("decidedBy").GetString());
            Assert.EndsWith("Z", body.GetProperty("decidedUtc").GetString());
            Assert.False(body.GetProperty("workerIsActive").GetBoolean());
        }
        var (_, viewer) = await TestWorkers.SignInAsync(api, Roles.Supervisor);
        var list = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/leave?status=Approved&workerId={worker.Id}", viewer));
        var item = Assert.Single(list.EnumerateArray());
        Assert.Equal("Changed Name", item.GetProperty("workerName").GetString());
        await using var verify = TestUsers.NewContext(api.ConnectionString);
        var logs = await verify.AuditLogs.Where(x => x.EntityType == nameof(LeaveRequest) && x.EntityId == id.ToString()).ToListAsync();
        Assert.Equal(6, logs.Count);
        Assert.Equal(3, logs.Count(x => x.Action == "LeaveApproved"));
        Assert.All(logs, l => Assert.Equal(username, l.ActorUsername));
        Assert.All(logs, l => Assert.Equal(worker.Id, JsonDocument.Parse(l.DetailsJson!).RootElement.GetProperty("workerId").GetInt32()));
    }

    [Fact]
    public async Task Adjacent_dates_and_different_workers_allowed_and_listing_is_stable()
    {
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        var other = await TestWorkers.CreateAsync(api.ConnectionString);
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Administrator);
        var first = await Id(await Create(worker.Id, token));
        var second = await Id(await Create(worker.Id, token, "2028-03-02", "2028-03-02", "Sick Leave"));
        await Id(await Create(other.Id, token));
        var list = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/leave?status=&workerId={worker.Id}", token));
        Assert.Equal(new[] { second, first }, list.EnumerateArray().Select(x => x.GetProperty("id").GetInt32()));
        var rejected = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/leave?status=Rejected&workerId={worker.Id}", token));
        Assert.Empty(rejected.EnumerateArray());
    }

    [Fact]
    public async Task Leave_reference_alone_prevents_worker_deletion_without_partial_audit()
    {
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Administrator);
        var id = await Id(await Create(worker.Id, token));
        Assert.Equal(HttpStatusCode.Conflict, (await api.SendAsync(HttpMethod.Delete, $"/api/workers/{worker.Id}", token: token)).StatusCode);
        await using (var db = TestUsers.NewContext(api.ConnectionString))
        {
            Assert.False(await db.Attendance.AnyAsync(x => x.WorkerId == worker.Id));
            Assert.False(await db.AuditLogs.AnyAsync(x => x.Action == "WorkerDeleted" && x.EntityId == worker.Id.ToString()));
        }
        Assert.Equal(HttpStatusCode.NoContent, (await api.SendAsync(HttpMethod.Delete, $"/api/leave/{id}", token: token)).StatusCode);
        await using (var db = TestUsers.NewContext(api.ConnectionString))
        {
            var log = await db.AuditLogs.SingleAsync(x => x.Action == "LeaveDeleted" && x.EntityId == id.ToString());
            var details = JsonDocument.Parse(log.DetailsJson!).RootElement;
            Assert.Equal("Pending", details.GetProperty("status").GetString());
            Assert.Equal(worker.WorkerCode, details.GetProperty("workerCode").GetString());
        }
        Assert.Equal(HttpStatusCode.NoContent, (await api.SendAsync(HttpMethod.Delete, $"/api/workers/{worker.Id}", token: token)).StatusCode);
    }

    [Fact]
    public async Task Concurrent_reapproval_and_creation_allow_only_one_active_overlap()
    {
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var id = await Id(await Create(worker.Id, token));
        Assert.Equal(HttpStatusCode.OK, (await api.PostAsync($"/api/leave/{id}/reject", new { }, token)).StatusCode);
        var responses = await Task.WhenAll(api.PostAsync($"/api/leave/{id}/approve", new { }, token), Create(worker.Id, token));
        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.Conflict);
        Assert.Single(responses, r => r.IsSuccessStatusCode);
        await using var db = TestUsers.NewContext(api.ConnectionString);
        Assert.Equal(1, await db.LeaveRequests.CountAsync(x => x.WorkerId == worker.Id && x.Status != "Rejected"));
    }

    [Fact]
    public async Task Decision_delete_race_never_allows_a_supervisor_to_delete_approved_state()
    {
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        var (_, manager) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Supervisor);
        var id = await Id(await Create(worker.Id, token));
        var responses = await Task.WhenAll(api.PostAsync($"/api/leave/{id}/approve", new { }, manager), api.SendAsync(HttpMethod.Delete, $"/api/leave/{id}", token: token));
        if (responses[1].StatusCode == HttpStatusCode.NoContent) Assert.Equal(HttpStatusCode.NotFound, responses[0].StatusCode);
        else
        {
            Assert.Equal(HttpStatusCode.Forbidden, responses[1].StatusCode);
            Assert.Equal(HttpStatusCode.OK, responses[0].StatusCode);
        }
    }

    [Fact]
    public async Task Audit_failure_rolls_back_create_and_decision()
    {
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        await using (var db = TestUsers.NewContext(api.ConnectionString))
        {
            var service = new LeaveService(db, new ThrowingAudit(), TimeProvider.System, new LeaveAttendanceSync(db, new PayrollPeriodLock()));
            await Assert.ThrowsAsync<InvalidOperationException>(() => service.CreateAsync(new CreateLeaveRequest(worker.Id, "Annual Leave", "2028-01-01", "2028-01-01"), "actor", default));
        }
        await using (var db = TestUsers.NewContext(api.ConnectionString)) Assert.False(await db.LeaveRequests.AnyAsync(x => x.WorkerId == worker.Id));
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var id = await Id(await Create(worker.Id, token));
        await using (var db = TestUsers.NewContext(api.ConnectionString))
        {
            var service = new LeaveService(db, new ThrowingAudit(), TimeProvider.System, new LeaveAttendanceSync(db, new PayrollPeriodLock()));
            await Assert.ThrowsAsync<InvalidOperationException>(() => service.ChangeAsync(id, "Approved", "actor", false, default));
        }
        await using (var db = TestUsers.NewContext(api.ConnectionString))
        {
            var row = await db.LeaveRequests.SingleAsync(x => x.Id == id);
            Assert.Equal("Pending", row.Status);
            Assert.Null(row.DecidedBy);
            Assert.Null(row.DecidedUtc);
        }
    }

    [Theory]
    [InlineData("Status", "Pending ")]
    [InlineData("LeaveType", "Annual Leave ")]
    [InlineData("Status", "Bogus")]
    [InlineData("Status", "approved")]
    [InlineData("LeaveType", "Holiday")]
    [InlineData("LeaveType", "annual leave")]
    [InlineData("EndDate", "2028-02-01")]
    public async Task Sql_constraints_enforce_valid_records(string column, string value)
    {
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var id = await Id(await Create(worker.Id, token));
        await using var conn = new SqlConnection(api.ConnectionString);
        await conn.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"UPDATE LeaveRequests SET [{column}]=@value WHERE Id=@id";
        cmd.Parameters.AddWithValue("@value", value);
        cmd.Parameters.AddWithValue("@id", id);
        var ex = await Assert.ThrowsAsync<SqlException>(() => cmd.ExecuteNonQueryAsync());
        Assert.Equal(547, ex.Number);
    }

    [Fact]
    public async Task Worker_lock_timeout_returns_problem_conflict()
    {
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Manager);
        await using var conn = new SqlConnection(api.ConnectionString);
        await conn.OpenAsync();
        await using var tx = (SqlTransaction)await conn.BeginTransactionAsync(IsolationLevel.Serializable);
        await using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = "EXEC sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction'";
        cmd.Parameters.AddWithValue("@resource", "LeaveWorker:" + worker.Id);
        await cmd.ExecuteNonQueryAsync();
        var r = await Create(worker.Id, token);
        Assert.Equal(HttpStatusCode.Conflict, r.StatusCode);
        Assert.Equal("application/problem+json", r.Content.Headers.ContentType?.MediaType);
    }

    [Theory]
    [InlineData(Roles.Administrator)]
    [InlineData(Roles.Manager)]
    public async Task Manager_and_administrator_decide_all_states_and_delete_decided(string role)
    {
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        var (_, token) = await TestWorkers.SignInAsync(api, role);
        var id = await Id(await Create(worker.Id, token));
        Assert.Equal(HttpStatusCode.OK, (await api.PostAsync($"/api/leave/{id}/reject", new { }, token)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await api.SendAsync(HttpMethod.Delete, $"/api/leave/{id}", token: token)).StatusCode);
        id = await Id(await Create(worker.Id, token));
        foreach (var action in new[] { "approve", "approve", "reject", "approve", "reject", "reject" })
            Assert.Equal(HttpStatusCode.OK, (await api.PostAsync($"/api/leave/{id}/{action}", new { }, token)).StatusCode);
    }
    [Theory]
    [InlineData("Approved")]
    [InlineData("Rejected")]
    [InlineData(null)]
    public async Task Worker_deleted_after_initial_lookup_returns_404_without_audit(string? status)
    {
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var id = await Id(await Create(worker.Id, token));
        var pause = new PauseAfterLookup();
        var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(api.ConnectionString).AddInterceptors(pause).Options;
        await using var db = new AppDbContext(options);
        var service = new LeaveService(db, new AuditLogger(db, new HttpContextAccessor()), TimeProvider.System, new LeaveAttendanceSync(db, new PayrollPeriodLock()));
        var operation = service.ChangeAsync(id, status, "racing-editor", false, default);
        await pause.Reached.Task.WaitAsync(TimeSpan.FromSeconds(10));
        try
        {
            await using var deleting = TestUsers.NewContext(api.ConnectionString);
            await deleting.LeaveRequests.Where(x => x.Id == id).ExecuteDeleteAsync();
            await deleting.Workers.Where(x => x.Id == worker.Id).ExecuteDeleteAsync();
        }
        finally { pause.Resume.TrySetResult(); }
        var result = await operation.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.Equal(404, result.StatusCode);
        await using var verify = TestUsers.NewContext(api.ConnectionString);
        Assert.False(await verify.AuditLogs.AnyAsync(x => x.ActorUsername == "racing-editor" && x.EntityId == id.ToString()));
    }

    private sealed class PauseAfterLookup : DbTransactionInterceptor
    {
        public TaskCompletionSource Reached { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Resume { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public override async ValueTask<DbTransaction> TransactionStartedAsync(DbConnection connection, TransactionEndEventData eventData,
            DbTransaction result, CancellationToken cancellationToken = default)
        {
            Reached.TrySetResult();
            await Resume.Task.WaitAsync(TimeSpan.FromSeconds(10), cancellationToken);
            return result;
        }
    }
    private sealed class ThrowingAudit : IAuditLogger
    {
        public void Write(string action, string? actorUsername = null, string? entityType = null, string? entityId = null, object? details = null) => throw new InvalidOperationException("Audit failed");
    }
}
