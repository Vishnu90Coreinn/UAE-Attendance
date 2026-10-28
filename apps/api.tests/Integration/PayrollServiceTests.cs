using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Services;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Integration;

public class PayrollServiceTests : IAsyncLifetime
{
    private readonly TestDatabase database = new();
    public Task InitializeAsync() => database.InitializeAsync();
    public Task DisposeAsync() => database.DisposeAsync();

    [Fact]
    public async Task Draft_UsesCurrentRatesAndOverride_SumsDailyRounding_IncludesWorkersAndSorts()
    {
        var worked = await TestWorkers.CreateAsync(database.ConnectionString, "B", hourlyRate: .50m, overtimeRate: .50m);
        var absent = await TestWorkers.CreateAsync(database.ConnectionString, "A", isActive: false);
        var active = await TestWorkers.CreateAsync(database.ConnectionString, "C");
        await TestWorkers.CreateAsync(database.ConnectionString, "D", isActive: false);
        await using var db = TestUsers.NewContext(database.ConnectionString);
        for (var day = 1; day <= 3; day++) db.Attendance.Add(Row(worked.Id, new(2024, 2, day), .01m, .01m));
        db.Attendance.Add(Row(absent.Id, new(2024, 2, 29), 0, 0, "Absent"));
        db.Attendance.Add(Row(worked.Id, new(2024, 3, 1), 8, 1));
        await db.SaveChangesAsync();
        var service = new PayrollService(db);
        var first = await service.ReadAsync(new(2024, 2, 1), default);
        Assert.Equal("Draft", first.Status);
        Assert.Equal(new[] { "A", "B", "C" }, first.Lines.Select(l => l.WorkerCode));
        var line = first.Lines.Single(l => l.WorkerId == worked.Id);
        Assert.Equal(3, line.DaysWorked);
        Assert.Equal(.03m, line.BasicHours);
        // Salary 120 (0.50 x 240); Feb 2024 has 25 non-Sunday days, 3 recorded: 120 - 22 x 4 = 32. Overtime is still rounded per day.
        Assert.Equal(32m, line.BasicPay);
        Assert.Equal(.03m, line.OvertimePay);
        Assert.Equal(first.Lines.Sum(l => l.TotalPay), first.Totals.TotalPay);
        Assert.Equal(0, first.Lines.Single(l => l.WorkerId == active.Id).DaysWorked);
        Assert.Equal(first.Revision, (await service.ReadAsync(new(2024, 2, 1), default)).Revision);
        await db.Workers.Where(w => w.Id == worked.Id).ExecuteUpdateAsync(s => s.SetProperty(w => w.HourlyRate, 2m).SetProperty(w => w.OvertimeRate, (decimal?)null));
        await db.PayrollSettings.ExecuteUpdateAsync(s => s.SetProperty(p => p.OvertimeRatePerHour, 3m));
        var updated = await service.ReadAsync(new(2024, 2, 1), default);
        var after = updated.Lines.Single(l => l.WorkerId == worked.Id);
        Assert.Equal(128m, after.BasicPay); // salary 480 - 22 x 16
        Assert.Equal(.09m, after.OvertimePay);
        Assert.NotEqual(first.Revision, updated.Revision);
    }

    [Theory]
    [InlineData(1, 1, 31)] [InlineData(9999, 12, 31)] [InlineData(2024, 2, 29)] [InlineData(2023, 2, 28)]
    public async Task Month_IncludesFirstAndLastDay(int year, int month, int lastDay)
    {
        var worker = await TestWorkers.CreateAsync(database.ConnectionString);
        await using var db = TestUsers.NewContext(database.ConnectionString);
        db.Attendance.AddRange(Row(worker.Id, new(year, month, 1), 8, 1), Row(worker.Id, new(year, month, lastDay), 8, 1));
        await db.SaveChangesAsync();
        var report = await new PayrollService(db).ReadAsync(new(year, month, 1), default);
        Assert.Equal(2, report.Totals.DaysWorked);
        Assert.Equal(16m, report.Totals.BasicHours);
    }

    private static Attendance Row(int id, DateOnly date, decimal basic, decimal overtime, string status = "Present") =>
        new() { WorkerId = id, WorkDate = date, Status = status, BasicHours = basic, OvertimeHours = overtime,
            UpdatedUtc = DateTime.UtcNow, UpdatedBy = "test" };
}
