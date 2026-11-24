using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Helpers;

/// <summary>Creates finance rows directly in the test database.</summary>
public static class TestFinance
{
    /// <summary>Today on UAE time, which is what the API treats as "today".</summary>
    public static DateOnly Today => DateOnly.FromDateTime(DateTime.UtcNow.AddHours(4));

    public static string Unique(string prefix = "Acct") => $"{prefix} {Guid.NewGuid():N}"[..30];

    public static async Task<FinAccount> AddAccountAsync(
        string connectionString, string? name = null, decimal opening = 1000m, DateOnly? openingDate = null,
        string kind = FinAccountKinds.Bank, bool isActive = true, string? accountNumber = null, string? iban = null)
    {
        var now = DateTime.UtcNow;
        var account = new FinAccount
        {
            Name = name ?? Unique(), Kind = kind, OpeningBalance = opening, OpeningDate = openingDate ?? Today.AddDays(-60),
            IsActive = isActive, AccountNumber = accountNumber, Iban = iban, CreatedUtc = now, UpdatedUtc = now,
        };
        await using var db = TestUsers.NewContext(connectionString);
        db.FinAccounts.Add(account);
        await db.SaveChangesAsync();
        return account;
    }

    public static async Task<FinEntry> AddEntryAsync(
        string connectionString, int accountId, string kind, decimal amount, DateOnly? date = null,
        string status = FinStatuses.Active, int? categoryId = null)
    {
        var now = DateTime.UtcNow;
        var entry = new FinEntry
        {
            Kind = kind, EntryNo = (kind == FinEntryKinds.Income ? "INC-" : "EXP-") + Guid.NewGuid().ToString("N")[..12],
            EntryDate = date ?? Today.AddDays(-5), CategoryId = categoryId ?? (kind == FinEntryKinds.Income ? 10 : 1),
            Party = "Test party", AccountId = accountId, Amount = amount, Status = status,
            VoidedUtc = status == FinStatuses.Voided ? now : null, VoidedBy = status == FinStatuses.Voided ? "tester" : null,
            CreatedBy = "tester", CreatedUtc = now,
        };
        await using var db = TestUsers.NewContext(connectionString);
        db.FinEntries.Add(entry);
        await db.SaveChangesAsync();
        return entry;
    }

    public static async Task<FinTransfer> AddTransferAsync(
        string connectionString, int fromId, int toId, decimal amount, DateOnly? date = null, string status = FinStatuses.Active)
    {
        var now = DateTime.UtcNow;
        var transfer = new FinTransfer
        {
            TransferNo = "TRF-" + Guid.NewGuid().ToString("N")[..12], TransferDate = date ?? Today.AddDays(-3),
            FromAccountId = fromId, ToAccountId = toId, Amount = amount, Status = status,
            VoidedUtc = status == FinStatuses.Voided ? now : null, CreatedBy = "tester", CreatedUtc = now,
        };
        await using var db = TestUsers.NewContext(connectionString);
        db.FinTransfers.Add(transfer);
        await db.SaveChangesAsync();
        return transfer;
    }

    public static async Task<List<AuditLog>> AuditAsync(string connectionString, string action, string? entityId = null)
    {
        await using var db = TestUsers.NewContext(connectionString);
        return await db.AuditLogs.AsNoTracking().Where(a => a.Action == action && (entityId == null || a.EntityId == entityId)).ToListAsync();
    }
}
