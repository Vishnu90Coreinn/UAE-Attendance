using HrPayroll.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services.Staff;

/// <summary>Selfies and locations are kept for one year, then removed. The sign-in record itself (time and kind) stays.</summary>
public sealed class StaffRetentionService(IServiceScopeFactory scopes, TimeProvider time, ILogger<StaffRetentionService> logger) : BackgroundService
{
    public static readonly TimeSpan Retention = TimeSpan.FromDays(365);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await Task.Delay(TimeSpan.FromMinutes(2), stoppingToken);
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    using var scope = scopes.CreateScope();
                    await RunOnceAsync(scope.ServiceProvider.GetRequiredService<AppDbContext>(), time, stoppingToken);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    logger.LogError(ex, "Staff photo and location clean-up failed");
                }

                await Task.Delay(TimeSpan.FromHours(6), stoppingToken);
            }
        }
        catch (OperationCanceledException)
        {
            // shutting down
        }
    }

    /// <returns>The number of selfies deleted.</returns>
    public static async Task<int> RunOnceAsync(AppDbContext db, TimeProvider time, CancellationToken ct)
    {
        var cutoff = time.GetUtcNow().UtcDateTime - Retention;
        var selfies = await db.StaffPunchSelfies.Where(s => s.Punch.TimestampUtc < cutoff).ExecuteDeleteAsync(ct);
        await db.StaffPunches.Where(p => p.TimestampUtc < cutoff && (p.Latitude != null || p.Longitude != null))
            .ExecuteUpdateAsync(s => s.SetProperty(p => p.Latitude, (double?)null).SetProperty(p => p.Longitude, (double?)null)
                .SetProperty(p => p.AccuracyMeters, (double?)null), ct);
        return selfies;
    }
}
