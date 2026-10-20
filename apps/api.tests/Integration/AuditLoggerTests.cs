using System.Security.Claims;
using System.Text.Json;
using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Services;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Integration;

public class AuditLoggerTests(TestDatabase database) : IClassFixture<TestDatabase>
{
    private AppDbContext NewContext() =>
        new(new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(database.ConnectionString).Options);

    private static HttpContextAccessor NoHttpContext() => new();

    private static HttpContextAccessor WithUser(string name) => new()
    {
        HttpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Name, name)], "test")),
        },
    };

    [Fact]
    public async Task Write_OnlyTracksTheRow_UntilTheCallerSaves()
    {
        var action = $"Test{Guid.NewGuid():N}";
        await using var db = NewContext();
        var logger = new AuditLogger(db, NoHttpContext());

        logger.Write(action);

        Assert.Single(db.ChangeTracker.Entries<AuditLog>(), e => e.State == EntityState.Added);
        await using (var other = NewContext())
        {
            Assert.False(await other.AuditLogs.AnyAsync(a => a.Action == action));
        }

        await db.SaveChangesAsync();

        await using var after = NewContext();
        Assert.True(await after.AuditLogs.AnyAsync(a => a.Action == action));
    }

    [Fact]
    public async Task Write_StoresActionActorEntityUtcTimestampAndJsonDetails()
    {
        var action = $"Test{Guid.NewGuid():N}";
        var before = DateTime.UtcNow.AddSeconds(-5);
        await using (var db = NewContext())
        {
            new AuditLogger(db, NoHttpContext())
                .Write(action, "alice", "User", "42", new { Reason = "because", Count = 3 });
            await db.SaveChangesAsync();
        }

        await using var read = NewContext();
        var row = await read.AuditLogs.SingleAsync(a => a.Action == action);

        Assert.Equal("alice", row.ActorUsername);
        Assert.Equal("User", row.EntityType);
        Assert.Equal("42", row.EntityId);
        Assert.True(row.TimestampUtc >= before && row.TimestampUtc <= DateTime.UtcNow.AddSeconds(5));
        Assert.NotNull(row.DetailsJson);
        using var json = JsonDocument.Parse(row.DetailsJson!);
        Assert.Equal("because", json.RootElement.GetProperty("Reason").GetString());
        Assert.Equal(3, json.RootElement.GetProperty("Count").GetInt32());
    }

    [Fact]
    public async Task Write_WithNoDetails_LeavesDetailsJsonNull()
    {
        var action = $"Test{Guid.NewGuid():N}";
        await using (var db = NewContext())
        {
            new AuditLogger(db, NoHttpContext()).Write(action);
            await db.SaveChangesAsync();
        }

        await using var read = NewContext();
        var row = await read.AuditLogs.SingleAsync(a => a.Action == action);

        Assert.Null(row.DetailsJson);
        Assert.Null(row.EntityType);
        Assert.Null(row.EntityId);
    }

    [Fact]
    public async Task Write_WithoutActorOrHttpContext_StoresNullActor()
    {
        var action = $"Test{Guid.NewGuid():N}";
        await using (var db = NewContext())
        {
            new AuditLogger(db, NoHttpContext()).Write(action);
            await db.SaveChangesAsync();
        }

        await using var read = NewContext();
        Assert.Null((await read.AuditLogs.SingleAsync(a => a.Action == action)).ActorUsername);
    }

    [Fact]
    public async Task Write_WithoutActor_UsesTheHttpContextUserName()
    {
        var action = $"Test{Guid.NewGuid():N}";
        await using (var db = NewContext())
        {
            new AuditLogger(db, WithUser("bob")).Write(action);
            await db.SaveChangesAsync();
        }

        await using var read = NewContext();
        Assert.Equal("bob", (await read.AuditLogs.SingleAsync(a => a.Action == action)).ActorUsername);
    }

    [Fact]
    public async Task Write_ExplicitActor_WinsOverTheHttpContextUser()
    {
        var action = $"Test{Guid.NewGuid():N}";
        await using (var db = NewContext())
        {
            new AuditLogger(db, WithUser("bob")).Write(action, "carol");
            await db.SaveChangesAsync();
        }

        await using var read = NewContext();
        Assert.Equal("carol", (await read.AuditLogs.SingleAsync(a => a.Action == action)).ActorUsername);
    }
}
