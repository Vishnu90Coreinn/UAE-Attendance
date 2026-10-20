using System.Globalization;
using HrPayroll.Api.Data;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace HrPayroll.Api.Services;

public interface IPayrollPeriodLock
{
    /// <summary>
    /// Attendance writes call this in their serializable transaction. Acquire a shared transaction-owned
    /// SQL month application lock before checking the snapshot. Finalise/reopen acquire the exclusive
    /// counterpart. All operations follow month -> settings -> workers -> attendance lock order.
    /// Read-only attendance calls outside a transaction only query finalised state.
    /// </summary>
    Task<bool> IsFinalisedAsync(AppDbContext db, DateOnly date, CancellationToken cancellationToken = default);
}

public sealed class PayrollPeriodLock : IPayrollPeriodLock
{
    public async Task<bool> IsFinalisedAsync(AppDbContext db, DateOnly date, CancellationToken cancellationToken = default)
    {
        if (db.Database.CurrentTransaction is not null) await AcquireAsync(db, date, false, cancellationToken);
        return await db.PayrollPeriods.AnyAsync(p => p.Year == date.Year && p.Month == date.Month, cancellationToken);
    }

    // A month resource also protects an empty month. Locks live until transaction commit/rollback.
    public static async Task AcquireAsync(AppDbContext db, DateOnly date, bool exclusive, CancellationToken ct)
    {
        var transaction = db.Database.CurrentTransaction ?? throw new InvalidOperationException("A payroll month lock requires a transaction.");
        await using var command = db.Database.GetDbConnection().CreateCommand();
        command.Transaction = transaction.GetDbTransaction();
        command.CommandText = "DECLARE @result int; EXEC @result = sys.sp_getapplock @Resource = @resource, @LockMode = @mode, @LockOwner = 'Transaction', @LockTimeout = 3000; SELECT @result;";
        command.Parameters.Add(new SqlParameter("@resource", "PayrollPeriod:" + date.ToString("yyyy-MM", CultureInfo.InvariantCulture)));
        command.Parameters.Add(new SqlParameter("@mode", exclusive ? "Exclusive" : "Shared"));
        var result = Convert.ToInt32(await command.ExecuteScalarAsync(ct), CultureInfo.InvariantCulture);
        if (result < 0) throw new PayrollConflictException();
    }

    public static bool IsConflict(Exception exception)
    {
        for (Exception? current = exception; current is not null; current = current.InnerException)
            if (current is PayrollConflictException or DbUpdateConcurrencyException || current is SqlException { Number: 1205 or 1222 or 2601 or 2627 }) return true;
        return false;
    }
}

public sealed class PayrollConflictException : Exception;
