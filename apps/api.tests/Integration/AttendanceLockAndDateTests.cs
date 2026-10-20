using HrPayroll.Api.Data;
using HrPayroll.Api.Dtos;
using HrPayroll.Api.Services;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Integration;

public class AttendanceLockAndDateTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private sealed class FixedTime : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(2026, 10, 19, 20, 1, 0, TimeSpan.Zero);
    }
    private sealed class LockedMonth : IPayrollPeriodLock
    {
        public bool SawWriteTransaction { get; private set; }
        public Task<bool> IsFinalisedAsync(AppDbContext db, DateOnly date, CancellationToken ct = default)
        {
            SawWriteTransaction |= db.Database.CurrentTransaction is not null;
            return Task.FromResult(true);
        }
    }
    private static AttendanceService Service(AppDbContext db, IPayrollPeriodLock guard) =>
        new(db, new AuditLogger(db, new HttpContextAccessor()), new FixedTime(), guard, new HttpContextAccessor());

    [Theory]
    [InlineData("save")]
    [InlineData("delete")]
    public async Task FinalisedMonth_RejectsEveryWrite_WithinTransaction_WithoutChangingRecordsOrAudit(string operation)
    {
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        await using var db = TestUsers.NewContext(api.ConnectionString);
        var guard = new LockedMonth();
        var service = Service(db, guard);
        var result = operation == "save"
            ? await service.SaveAsync("2026-10-19", [new AttendanceRequest { WorkerId = worker.Id, Status = "Present", BasicHours = 8, OvertimeHours = 0 }], default)
            : await service.DeleteAsync("2026-10-19", worker.Id, default);
        Assert.Equal(409, result.StatusCode);
        Assert.True(guard.SawWriteTransaction);
        Assert.False(await db.Attendance.AnyAsync(a => a.WorkerId == worker.Id));
        Assert.DoesNotContain(db.ChangeTracker.Entries(), e => e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted);
    }

    [Fact]
    public async Task Get_ReportsLockState()
    {
        await using var db = TestUsers.NewContext(api.ConnectionString);
        var result = await Service(db, new LockedMonth()).GetAsync("2026-10-19", default);
        Assert.True(result.Day!.IsFinalised);
    }

    [Fact]
    public async Task CompanyToday_IsDubaiDate_EvenWhenUtcIsPreviousDay()
    {
        await using var db = TestUsers.NewContext(api.ConnectionString);
        var service = Service(db, new DraftPayrollPeriodLock());
        Assert.Equal(200, (await service.GetAsync("2026-10-20", default)).StatusCode);
        Assert.Equal(400, (await service.GetAsync("2026-10-21", default)).StatusCode);
    }
}
