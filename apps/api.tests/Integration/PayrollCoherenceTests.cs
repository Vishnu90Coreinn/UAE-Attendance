using System.Data.Common;
using HrPayroll.Api.Data;
using HrPayroll.Api.Services;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace HrPayroll.Api.Tests.Integration;

public class PayrollCoherenceTests : IAsyncLifetime
{
    private readonly TestDatabase database = new();
    public Task InitializeAsync() => database.InitializeAsync();
    public Task DisposeAsync() => database.DisposeAsync();

    [Fact]
    public async Task Report_ReadTransactionPreventsMixingConcurrentSettingsRatesAndAttendance()
    {
        var worker = await TestWorkers.CreateAsync(database.ConnectionString, hourlyRate: 10m);
        await using (var seed = TestUsers.NewContext(database.ConnectionString))
        {
            seed.Attendance.Add(new() { WorkerId = worker.Id, WorkDate = new(2026, 1, 1), Status = "Present",
                BasicHours = 8, OvertimeHours = 1, UpdatedUtc = DateTime.UtcNow, UpdatedBy = "test" });
            await seed.SaveChangesAsync();
        }
        var gate = new PauseBeforeAttendance();
        var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(database.ConnectionString).AddInterceptors(gate).Options;
        await using var db = new AppDbContext(options);
        var reading = new PayrollService(db).ReadAsync(new(2026, 1, 1), default);
        await gate.Paused.Task.WaitAsync(TimeSpan.FromSeconds(10));
        await using var writer = new SqlConnection(database.ConnectionString);
        await writer.OpenAsync();
        await using var command = writer.CreateCommand();
        // Setting LOCK_TIMEOUT gives deterministic evidence of an actual SQL lock, without timing assertions.
        command.CommandText = "SET LOCK_TIMEOUT 300; BEGIN TRY BEGIN TRAN; UPDATE PayrollSettings SET OvertimeRatePerHour = 20; UPDATE Workers SET HourlyRate = 20 WHERE Id = @id; UPDATE Attendance SET BasicHours = 4 WHERE WorkerId = @id; COMMIT; END TRY BEGIN CATCH IF @@TRANCOUNT > 0 ROLLBACK; THROW; END CATCH;";
        command.Parameters.AddWithValue("@id", worker.Id);
        try
        {
            var blocked = await Assert.ThrowsAsync<SqlException>(() => command.ExecuteNonQueryAsync());
            Assert.Equal(1222, blocked.Number);
        }
        finally
        {
            // A failed SQL statement may leave its transaction active; release it before resuming the reader.
            command.CommandText = "IF @@TRANCOUNT > 0 ROLLBACK;";
            await command.ExecuteNonQueryAsync();
            gate.Release.TrySetResult();
        }
        var report = await reading;
        Assert.Equal(320m, report.Totals.BasicPay);
        Assert.Equal(8m, report.Totals.BasicHours);
        Assert.Equal(2.22m, report.Totals.OvertimePay);
    }

    private sealed class PauseBeforeAttendance : DbCommandInterceptor
    {
        public TaskCompletionSource Paused { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public override async ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command,
            CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            if (command.CommandText.Contains("FROM [Attendance]", StringComparison.Ordinal))
            {
                Paused.TrySetResult();
                await Release.Task.WaitAsync(cancellationToken);
            }
            return result;
        }
    }
}
