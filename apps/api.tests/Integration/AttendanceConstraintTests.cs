using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Integration;

public class AttendanceConstraintTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    [Theory]
    [InlineData("Other", 8, 0)]
    [InlineData("present", 8, 0)]
    [InlineData("Present", -1, 0)]
    [InlineData("Present", 0, 0)]
    [InlineData("Present", 8, -1)]
    [InlineData("Present", 8, 17)]
    [InlineData("Absent", 1, 0)]
    [InlineData("Absent", 0, 1)]
    public async Task Database_RejectsInvalidStatusOrHours(string status, int basic, int overtime)
    {
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        await using var db = TestUsers.NewContext(api.ConnectionString);
        db.Attendance.Add(Record(worker.Id, status, basic, overtime));
        var ex = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        Assert.Equal(547, Assert.IsType<SqlException>(ex.InnerException).Number);
    }

    [Fact]
    public async Task Database_RejectsDuplicateWorkerDate()
    {
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        await using var db = TestUsers.NewContext(api.ConnectionString);
        db.Attendance.Add(Record(worker.Id));
        await db.SaveChangesAsync();
        db.Attendance.Add(Record(worker.Id));
        var ex = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        Assert.Contains(Assert.IsType<SqlException>(ex.InnerException).Number, new[] { 2601, 2627 });
    }

    [Fact]
    public async Task Database_RejectsUnknownWorker()
    {
        await using var db = TestUsers.NewContext(api.ConnectionString);
        db.Attendance.Add(Record(int.MaxValue));
        var ex = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        Assert.Equal(547, Assert.IsType<SqlException>(ex.InnerException).Number);
    }

    private static Attendance Record(int id, string status = "Present", decimal basic = 8, decimal overtime = 0) =>
        new() { WorkerId = id, WorkDate = new(2026, 3, 1), Status = status, BasicHours = basic, OvertimeHours = overtime, UpdatedUtc = DateTime.UtcNow, UpdatedBy = "test" };
}
