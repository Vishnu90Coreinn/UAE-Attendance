using System.Data;
using System.Data.Common;
using System.Security.Claims;
using HrPayroll.Api.Data;
using HrPayroll.Api.Dtos;
using HrPayroll.Api.Services;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.AspNetCore.Http;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace HrPayroll.Api.Tests.Integration;

public sealed class PayrollSnapshotIntegrityTests : IAsyncLifetime
{
    private readonly TestDatabase database = new();
    public Task InitializeAsync() => database.InitializeAsync();
    public Task DisposeAsync() => database.DisposeAsync();
    private static readonly DateOnly Month = new(2020, 1, 1);
    private static readonly IHttpContextAccessor Context = new HttpContextAccessor { HttpContext = new DefaultHttpContext {
        User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Name, "payroll-admin")], "test")) } };
    private static PayrollService Payroll(AppDbContext db) => new(db, new AuditLogger(db, Context), TimeProvider.System, Context);
    private static AttendanceService Attendance(AppDbContext db) => new(db, new AuditLogger(db, Context), TimeProvider.System, new PayrollPeriodLock(), Context);
    private AppDbContext NewDb(params IInterceptor[] interceptors) => new(new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(database.ConnectionString).AddInterceptors(interceptors).Options);

    [Fact]
    public async Task EmptyMonth_FinalisesAndReopens_WithStableStoredRevision()
    {
        await using var db = NewDb();
        var service = Payroll(db);
        var draft = await service.ReadAsync(Month, default);
        var final = await service.FinaliseAsync(Month, draft.Revision, default);
        Assert.Equal(200, final.StatusCode);
        Assert.Empty(final.Report!.Lines);
        Assert.Equal(final.Report.Revision, (await service.ReadAsync(Month, default)).Revision);
        Assert.Equal(200, (await service.ReopenAsync(Month, "empty correction", default)).StatusCode);
        Assert.Empty(await db.PayrollDetails.ToListAsync());
        Assert.Empty(await db.PayrollPeriods.ToListAsync());
    }

    [Fact]
    public async Task SnapshotWorkerWithoutAttendance_CannotBeDeletedUntilReopen()
    {
        var worker = await TestWorkers.CreateAsync(database.ConnectionString);
        await using var db = NewDb();
        var service = Payroll(db);
        var draft = await service.ReadAsync(Month, default);
        var final = await service.FinaliseAsync(Month, draft.Revision, default);
        Assert.Equal(200, final.StatusCode);
        await using (var check = NewDb())
        {
            Assert.False(await check.Attendance.AnyAsync());
            var ex = await Assert.ThrowsAsync<SqlException>(() => check.Workers.Where(w => w.Id == worker.Id).ExecuteDeleteAsync());
            Assert.Equal(547, ex.Number);
        }
        await using (var reread = NewDb())
            Assert.Equal(final.Report!.Revision, (await Payroll(reread).ReadAsync(Month, default)).Revision);
        Assert.Equal(200, (await service.ReopenAsync(Month, "remove worker", default)).StatusCode);
        await using var delete = NewDb();
        Assert.Equal(1, await delete.Workers.Where(w => w.Id == worker.Id).ExecuteDeleteAsync());
    }

    [Theory]
    [InlineData("save")] [InlineData("clear")] [InlineData("delete")]
    public async Task FinalisedMonth_LocksActualAttendanceWritesAndRead(string operation)
    {
        var worker = await TestWorkers.CreateAsync(database.ConnectionString);
        await using (var seed = NewDb())
        {
            Assert.Equal(200, (await Attendance(seed).SaveAsync("2020-01-01", [new() { WorkerId = worker.Id, Status = "Present", BasicHours = 8, OvertimeHours = 1 }], default)).StatusCode);
            var draft = await Payroll(seed).ReadAsync(Month, default);
            Assert.Equal(200, (await Payroll(seed).FinaliseAsync(Month, draft.Revision, default)).StatusCode);
        }
        await using var db = NewDb();
        var auditCount = await db.AuditLogs.CountAsync();
        var service = Attendance(db);
        Assert.True((await service.GetAsync("2020-01-01", default)).Day!.IsFinalised);
        var result = operation == "delete" ? await service.DeleteAsync("2020-01-01", worker.Id, default) :
            await service.SaveAsync("2020-01-01", [new() { WorkerId = worker.Id, Status = operation == "clear" ? null : "Absent", BasicHours = 0, OvertimeHours = 0 }], default);
        Assert.Equal(409, result.StatusCode);
        Assert.Equal(8m, (await db.Attendance.SingleAsync()).BasicHours);
        Assert.Equal(auditCount, await db.AuditLogs.CountAsync());
    }

    [Fact]
    public async Task DuplicateConcurrentFinalise_CreatesOneSnapshotAndOneAudit()
    {
        await using var reader = NewDb();
        var revision = (await Payroll(reader).ReadAsync(Month, default)).Revision;
        await using var first = NewDb();
        await using var second = NewDb();
        var results = await Task.WhenAll(Payroll(first).FinaliseAsync(Month, revision, default), Payroll(second).FinaliseAsync(Month, revision, default));
        Assert.Equal(new[] { 200, 409 }, results.Select(r => r.StatusCode).Order());
        Assert.Equal(1, await reader.PayrollPeriods.CountAsync());
        Assert.Equal(1, await reader.AuditLogs.CountAsync(a => a.Action == "PayrollFinalised"));
    }

    [Theory]
    [InlineData(false)] [InlineData(true)]
    public async Task AuditFailure_RollsBackEntireLifecycleMutation(bool reopening)
    {
        await TestWorkers.CreateAsync(database.ConnectionString);
        string revision;
        await using (var seed = NewDb())
        {
            revision = (await Payroll(seed).ReadAsync(Month, default)).Revision;
            if (reopening) Assert.Equal(200, (await Payroll(seed).FinaliseAsync(Month, revision, default)).StatusCode);
        }
        await using (var failing = NewDb(new FailAfterAuditSql()))
        {
            var exception = await Assert.ThrowsAsync<DbUpdateException>(() => reopening ? Payroll(failing).ReopenAsync(Month, "must rollback", default) : Payroll(failing).FinaliseAsync(Month, revision, default));
            Assert.IsType<AuditFailure>(exception.InnerException);
        }
        await using var verify = NewDb();
        Assert.Equal(reopening ? 1 : 0, await verify.PayrollPeriods.CountAsync());
        Assert.Equal(reopening ? 1 : 0, await verify.PayrollDetails.CountAsync());
        Assert.Equal(reopening ? 1 : 0, await verify.AuditLogs.CountAsync());
    }

    [Theory]
    [InlineData(false)] [InlineData(true)]
    public async Task ExclusiveMonthLock_ProtectsAgainstAttendanceWrites_EvenInEmptyMonth(bool emptyMonth)
    {
        var worker = await TestWorkers.CreateAsync(database.ConnectionString);
        if (!emptyMonth)
        {
            await using var seed = NewDb();
            await Attendance(seed).SaveAsync("2020-01-01", [new() { WorkerId = worker.Id, Status = "Present", BasicHours = 8, OvertimeHours = 1 }], default);
        }
        await using var reader = NewDb();
        var revision = (await Payroll(reader).ReadAsync(Month, default)).Revision;
        var gate = new PauseBeforeSql("FROM [PayrollSettings]");
        await using var finaliser = NewDb(gate);
        var finalising = Payroll(finaliser).FinaliseAsync(Month, revision, default);
        await gate.Paused.Task.WaitAsync(TimeSpan.FromSeconds(10));
        try
        {
            await using var writer = NewDb();
            Assert.Equal(409, (await Attendance(writer).SaveAsync("2020-01-01", [new() { WorkerId = worker.Id, Status = "Present", BasicHours = 4, OvertimeHours = 0 }], default)).StatusCode);
            Assert.Equal(emptyMonth ? 0 : 1, await writer.Attendance.CountAsync());
        }
        finally { gate.Release.TrySetResult(); }
        Assert.Equal(200, (await finalising).StatusCode);
    }

    [Fact]
    public async Task SharedAttendanceLock_BlocksFinaliseAndMakesDisplayedRevisionStale()
    {
        var worker = await TestWorkers.CreateAsync(database.ConnectionString);
        await using var reader = NewDb();
        var revision = (await Payroll(reader).ReadAsync(Month, default)).Revision;
        var gate = new PauseBeforeSql("INSERT INTO [Attendance]");
        await using var writer = NewDb(gate);
        var writing = Attendance(writer).SaveAsync("2020-01-01", [new() { WorkerId = worker.Id, Status = "Present", BasicHours = 8, OvertimeHours = 0 }], default);
        await gate.Paused.Task.WaitAsync(TimeSpan.FromSeconds(10));
        try
        {
            await using var finaliser = NewDb();
            await Assert.ThrowsAsync<PayrollConflictException>(() => Payroll(finaliser).FinaliseAsync(Month, revision, default));
        }
        finally { gate.Release.TrySetResult(); }
        Assert.Equal(200, (await writing).StatusCode);
        await using var retry = NewDb();
        Assert.Equal(409, (await Payroll(retry).FinaliseAsync(Month, revision, default)).StatusCode);
        Assert.Empty(await retry.PayrollPeriods.ToListAsync());
    }

    [Fact]
    public async Task UaeCurrentMonth_IsAllowedAtUtcMonthBoundary()
    {
        await using var db = NewDb();
        var service = new PayrollService(db, new AuditLogger(db, Context), new BoundaryTime(), Context);
        var current = new DateOnly(2026, 11, 1);
        Assert.False(service.IsFutureMonth(current));
        Assert.True(service.IsFutureMonth(new(2026, 12, 1)));
        var report = await service.ReadAsync(current, default);
        Assert.Equal(200, (await service.FinaliseAsync(current, report.Revision, default)).StatusCode);
    }

    [Fact]
    public async Task AggregatePrecision_StoresMonthlyPayBeyondIndividualRatePrecision()
    {
        var worker = await TestWorkers.CreateAsync(database.ConnectionString, hourlyRate: 9999999.99m);
        await using var db = NewDb();
        for (var day = 1; day <= 31; day++) db.Attendance.Add(new()
        { WorkerId = worker.Id, WorkDate = new(2020, 1, day), Status = "Present", BasicHours = 24, OvertimeHours = 0, UpdatedUtc = DateTime.UtcNow, UpdatedBy = "seed" });
        await db.SaveChangesAsync();
        var service = Payroll(db);
        var draft = await service.ReadAsync(Month, default);
        Assert.Equal(7439999992.56m, draft.Totals.TotalPay);
        var frozen = await service.FinaliseAsync(Month, draft.Revision, default);
        Assert.Equal(200, frozen.StatusCode);
        await using var verify = NewDb();
        var read = await Payroll(verify).ReadAsync(Month, default);
        Assert.Equal(draft.Totals.TotalPay, read.Totals.TotalPay);
        Assert.Equal(frozen.Report!.Revision, read.Revision);
    }

    [Fact]
    public async Task SnapshotSchema_RejectsDuplicateMonthAndWorker()
    {
        var worker = await TestWorkers.CreateAsync(database.ConnectionString);
        await using var db = NewDb();
        var service = Payroll(db);
        var report = await service.ReadAsync(Month, default);
        await service.FinaliseAsync(Month, report.Revision, default);
        var periodId = await db.PayrollPeriods.Select(p => p.Id).SingleAsync();
        await using (var duplicate = NewDb())
        {
            duplicate.PayrollPeriods.Add(new() { Year = Month.Year, Month = Month.Month, FinalisedUtc = DateTime.UtcNow });
            var ex = await Assert.ThrowsAsync<DbUpdateException>(() => duplicate.SaveChangesAsync());
            Assert.Contains(Assert.IsType<SqlException>(ex.InnerException).Number, new[] { 2601, 2627 });
        }
        await using (var duplicate = NewDb())
        {
            duplicate.PayrollDetails.Add(new() { PeriodId = periodId, WorkerId = worker.Id });
            var ex = await Assert.ThrowsAsync<DbUpdateException>(() => duplicate.SaveChangesAsync());
            Assert.Contains(Assert.IsType<SqlException>(ex.InnerException).Number, new[] { 2601, 2627 });
        }
    }

    private sealed class BoundaryTime : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(2026, 10, 31, 20, 1, 0, TimeSpan.Zero);
    }
    private sealed class AuditFailure : Exception;
    private sealed class FailAfterAuditSql : DbCommandInterceptor
    {
        public override ValueTask<DbDataReader> ReaderExecutedAsync(DbCommand command, CommandExecutedEventData eventData, DbDataReader result, CancellationToken cancellationToken = default)
        {
            if (command.CommandText.Contains("INSERT INTO [AuditLogs]", StringComparison.Ordinal)) { result.Dispose(); throw new AuditFailure(); }
            return ValueTask.FromResult(result);
        }
    }
    private sealed class PauseBeforeSql(string fragment) : DbCommandInterceptor
    {
        public TaskCompletionSource Paused { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public override async ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            if (command.CommandText.Contains(fragment, StringComparison.Ordinal))
            {
                Paused.TrySetResult();
                await Release.Task.WaitAsync(cancellationToken);
            }
            return result;
        }
    }
}
