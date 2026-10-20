using HrPayroll.Api.Data;

namespace HrPayroll.Api.Services;

public interface IPayrollPeriodLock
{
    /// <summary>
    /// Writes invoke this inside their serializable transaction, passing the same context.
    /// S5 must acquire a shared transaction-owned month application lock here; finalisation
    /// must acquire its exclusive counterpart before creating the frozen period.
    /// </summary>
    Task<bool> IsFinalisedAsync(AppDbContext db, DateOnly date, CancellationToken cancellationToken = default);
}

public sealed class DraftPayrollPeriodLock : IPayrollPeriodLock
{
    public Task<bool> IsFinalisedAsync(AppDbContext db, DateOnly date, CancellationToken cancellationToken = default) => Task.FromResult(false);
}
