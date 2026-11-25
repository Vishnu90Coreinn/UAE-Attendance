using System.Globalization;
using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services.Finance;

/// <summary>Month locks: a locked month takes no new entries or transfers, and none can be changed or voided in it.</summary>
public sealed class FinancePeriodService(AppDbContext db, IAuditLogger audit, IHttpContextAccessor http, TimeProvider time)
{
    private static string Key(int year, int month) => $"{year:0000}-{month:00}";

    private static FinMonthLockResponse ToResponse(FinMonthLock l) =>
        new(Key(l.Year, l.Month), l.IsLocked, l.LockedBy, l.LockedUtc, l.UnlockedBy, l.UnlockedUtc, l.UnlockReason);

    private static bool TryParse(string? month, out int year, out int number)
    {
        year = number = 0;
        return month is { Length: 7 } && month[4] == '-' && int.TryParse(month[..4], NumberStyles.None, CultureInfo.InvariantCulture, out year)
            && int.TryParse(month[5..], NumberStyles.None, CultureInfo.InvariantCulture, out number) && number is >= 1 and <= 12 && year is >= 2000 and <= 2100;
    }

    public async Task<List<FinMonthLockResponse>> ListAsync(CancellationToken ct) =>
        (await db.FinMonthLocks.AsNoTracking().OrderByDescending(l => l.Year).ThenByDescending(l => l.Month).ToListAsync(ct)).Select(ToResponse).ToList();

    /// <summary>Null when the month is open, otherwise the sentence to show: which month, and who locked it.</summary>
    public async Task<string?> LockedMessageAsync(DateOnly date, CancellationToken ct)
    {
        var row = await db.FinMonthLocks.AsNoTracking().SingleOrDefaultAsync(l => l.Year == date.Year && l.Month == date.Month && l.IsLocked, ct);
        return row is null ? null : $"{date.ToString("MMMM yyyy", CultureInfo.InvariantCulture)} is locked (by {row.LockedBy} on {row.LockedUtc:d MMM yyyy}). A Manager must unlock it before anything dated in it can change.";
    }

    /// <summary>True when any month has ever been locked: from then on, opening balances are settled and cannot be edited.</summary>
    public Task<bool> AnyLockedAsync(CancellationToken ct) => db.FinMonthLocks.AnyAsync(l => l.IsLocked, ct);

    public async Task<FinResult<FinMonthLockResponse>> LockAsync(string month, CancellationToken ct)
    {
        if (!TryParse(month, out var year, out var number)) return FinResult<FinMonthLockResponse>.Invalid("month", "Use the form yyyy-MM, for example 2026-09.");
        var today = FinanceRules.Today(time);
        if (new DateOnly(year, number, 1) > new DateOnly(today.Year, today.Month, 1)) return FinResult<FinMonthLockResponse>.Invalid("month", "A month that has not started cannot be locked.");

        var row = await db.FinMonthLocks.SingleOrDefaultAsync(l => l.Year == year && l.Month == number, ct);
        if (row is { IsLocked: true }) return FinResult<FinMonthLockResponse>.Conflict("This month is already locked.");
        var actor = FinanceRules.Actor(http);
        if (row is null)
        {
            row = new FinMonthLock { Year = year, Month = number };
            db.FinMonthLocks.Add(row);
        }

        row.IsLocked = true;
        row.LockedBy = actor;
        row.LockedUtc = DateTime.UtcNow;
        row.UnlockedBy = null;
        row.UnlockedUtc = null;
        row.UnlockReason = null;
        try
        {
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            await db.SaveChangesAsync(ct);
            audit.Write("FinMonthLocked", entityType: nameof(FinMonthLock), entityId: Key(year, number));
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        }
        catch (DbUpdateException ex) when (FinanceRules.IsDuplicate(ex))
        {
            return FinResult<FinMonthLockResponse>.Conflict("This month is already locked.");
        }

        return FinResult<FinMonthLockResponse>.Ok(ToResponse(row));
    }

    public async Task<FinResult<FinMonthLockResponse>> UnlockAsync(string month, string? reason, CancellationToken ct)
    {
        if (!TryParse(month, out var year, out var number)) return FinResult<FinMonthLockResponse>.Invalid("month", "Use the form yyyy-MM, for example 2026-09.");
        var text = FinanceRules.Clean(reason);
        if (text is null) return FinResult<FinMonthLockResponse>.Invalid("reason", "Enter the reason for unlocking this month.");
        if (text.Length > 300) return FinResult<FinMonthLockResponse>.Invalid("reason", "Use 300 characters or fewer.");

        var row = await db.FinMonthLocks.SingleOrDefaultAsync(l => l.Year == year && l.Month == number, ct);
        if (row is not { IsLocked: true }) return FinResult<FinMonthLockResponse>.Conflict("This month is not locked.");
        row.IsLocked = false;
        row.UnlockedBy = FinanceRules.Actor(http);
        row.UnlockedUtc = DateTime.UtcNow;
        row.UnlockReason = text;
        audit.Write("FinMonthUnlocked", entityType: nameof(FinMonthLock), entityId: Key(year, number), details: new { reason = text, lockedBy = row.LockedBy });
        await db.SaveChangesAsync(ct);
        return FinResult<FinMonthLockResponse>.Ok(ToResponse(row));
    }
}
