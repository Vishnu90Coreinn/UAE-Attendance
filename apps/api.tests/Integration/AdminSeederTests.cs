using System.Net.Http.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Services;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>A12: first-run administrator. Every test gets its own empty, migrated database.</summary>
public class AdminSeederTests : IAsyncLifetime
{
    private const string SeedUsername = "first.admin";
    private const string SeedPassword = "Seed-Pass-Value-42"; // test-only value

    private readonly TestDatabase _database = new();

    public Task InitializeAsync() => _database.InitializeAsync();

    public Task DisposeAsync() => _database.DisposeAsync();

    private sealed class TestEnvironment(string name) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = name;
        public string ApplicationName { get; set; } = "HrPayroll.Api";
        public string ContentRootPath { get; set; } = "";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }

    private static IConfiguration Settings(string? username = SeedUsername, string? password = SeedPassword) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Seed:AdminUsername"] = username,
                ["Seed:AdminPassword"] = password,
            })
            .Build();

    private (AdminSeeder Seeder, AppDbContext Db, CapturingLogger<AdminSeeder> Log) NewSeeder(
        IConfiguration configuration, string environment = "Testing")
    {
        var db = TestUsers.NewContext(_database.ConnectionString);
        var log = new CapturingLogger<AdminSeeder>();
        var seeder = new AdminSeeder(
            db,
            new PasswordHasher<User>(),
            new AuditLogger(db, new Microsoft.AspNetCore.Http.HttpContextAccessor()),
            configuration,
            new TestEnvironment(environment),
            log);
        return (seeder, db, log);
    }

    private async Task<List<User>> AllUsersAsync()
    {
        await using var db = TestUsers.NewContext(_database.ConnectionString);
        return await db.Users.AsNoTracking().ToListAsync();
    }

    private async Task<List<AuditLog>> SeedAuditRowsAsync()
    {
        await using var db = TestUsers.NewContext(_database.ConnectionString);
        return await db.AuditLogs.AsNoTracking().Where(a => a.Action == "AdminSeeded").ToListAsync();
    }

    [Fact]
    public async Task Seed_OnEmptyDatabase_CreatesAHashedActiveAdministrator()
    {
        var (seeder, db, _) = NewSeeder(Settings());
        await using (db)
        {
            await seeder.SeedAsync();
        }

        var user = Assert.Single(await AllUsersAsync());
        Assert.Equal(SeedUsername, user.Username);
        Assert.Equal(Roles.Administrator, user.Role);
        Assert.True(user.IsActive);
        Assert.Equal(0, user.FailedLoginCount);
        Assert.Null(user.LockoutEndUtc);
        Assert.NotEqual(SeedPassword, user.PasswordHash);
        Assert.DoesNotContain(SeedPassword, user.PasswordHash);
        Assert.Equal(
            PasswordVerificationResult.Success,
            new PasswordHasher<User>().VerifyHashedPassword(user, user.PasswordHash, SeedPassword));
    }

    [Fact]
    public async Task Seed_OnEmptyDatabase_WritesAnAuditRowWithoutThePassword()
    {
        var (seeder, db, log) = NewSeeder(Settings());
        await using (db)
        {
            await seeder.SeedAsync();
        }

        var row = Assert.Single(await SeedAuditRowsAsync());
        Assert.Equal("system", row.ActorUsername);
        Assert.NotNull(row.DetailsJson);
        Assert.Contains(SeedUsername, row.DetailsJson);
        Assert.DoesNotContain(SeedPassword, row.DetailsJson);

        var logged = string.Join('\n', log.Entries.Select(e => e.Message));
        Assert.Contains(log.Entries, e => e.Level == LogLevel.Information);
        Assert.DoesNotContain(SeedPassword, logged);
    }

    [Fact]
    public async Task Seed_RunTwice_DoesNotDuplicateTheUserOrTheAuditRow()
    {
        for (var run = 0; run < 2; run++)
        {
            var (seeder, db, _) = NewSeeder(Settings());
            await using (db)
            {
                await seeder.SeedAsync();
            }
        }

        Assert.Single(await AllUsersAsync());
        Assert.Single(await SeedAuditRowsAsync());
    }

    [Fact]
    public async Task Seed_WhenAUserAlreadyExists_LeavesEverythingUntouched()
    {
        var existing = await TestUsers.CreateAsync(_database.ConnectionString, role: Roles.Supervisor);

        var (seeder, db, _) = NewSeeder(Settings(), environment: "Production");
        await using (db)
        {
            await seeder.SeedAsync();
        }

        var user = Assert.Single(await AllUsersAsync());
        Assert.Equal(existing.Id, user.Id);
        Assert.Equal(existing.Username, user.Username);
        Assert.Equal(existing.PasswordHash, user.PasswordHash);
        Assert.Equal(Roles.Supervisor, user.Role);
        Assert.Empty(await SeedAuditRowsAsync());
    }

    [Fact]
    public async Task Seed_WhenAUserAlreadyExistsAndNoSettings_DoesNotThrowInProduction()
    {
        await TestUsers.CreateAsync(_database.ConnectionString);

        var (seeder, db, _) = NewSeeder(Settings(null, null), environment: "Production");
        await using (db)
        {
            await seeder.SeedAsync();
        }

        Assert.Single(await AllUsersAsync());
    }

    [Theory]
    [InlineData(null, null)]
    [InlineData(SeedUsername, null)]
    [InlineData(null, SeedPassword)]
    [InlineData("  ", "   ")]
    public async Task Seed_EmptyDatabaseWithoutSettingsInProduction_Throws(string? username, string? password)
    {
        var (seeder, db, _) = NewSeeder(Settings(username, password), environment: "Production");
        await using (db)
        {
            var exception = await Assert.ThrowsAsync<InvalidOperationException>(() => seeder.SeedAsync());

            Assert.Equal(
                "No users exist. Set Seed__AdminUsername and Seed__AdminPassword for the first start.",
                exception.Message);
        }

        Assert.Empty(await AllUsersAsync());
    }

    [Theory]
    [InlineData("Development")]
    [InlineData("Testing")]
    public async Task Seed_EmptyDatabaseWithoutSettingsOutsideProduction_WarnsAndContinues(string environment)
    {
        var (seeder, db, log) = NewSeeder(Settings(null, null), environment);
        await using (db)
        {
            await seeder.SeedAsync();
        }

        Assert.Empty(await AllUsersAsync());
        Assert.Empty(await SeedAuditRowsAsync());
        Assert.Contains(log.Entries, e => e.Level == LogLevel.Warning);
    }

    [Fact]
    public async Task Seed_WithAPasswordShorterThanTenCharacters_Throws()
    {
        var (seeder, db, log) = NewSeeder(Settings(password: "123456789"));
        await using (db)
        {
            var exception = await Assert.ThrowsAsync<InvalidOperationException>(() => seeder.SeedAsync());

            Assert.Contains("10", exception.Message);
            Assert.DoesNotContain("123456789", exception.Message);
        }

        Assert.DoesNotContain("123456789", string.Join('\n', log.Entries.Select(e => e.Message)));
        Assert.Empty(await AllUsersAsync());
        Assert.Empty(await SeedAuditRowsAsync());
    }

    [Fact]
    public async Task Seed_WithAPasswordEqualToTheUsername_Throws()
    {
        var (seeder, db, _) = NewSeeder(Settings("administrator1", "Administrator1"));
        await using (db)
        {
            var exception = await Assert.ThrowsAsync<InvalidOperationException>(() => seeder.SeedAsync());

            Assert.Contains("username", exception.Message);
        }

        Assert.Empty(await AllUsersAsync());
    }

    [Fact]
    public async Task Startup_WithSeedSettingsAndAnEmptyDatabase_SeedsAdministratorWhoCanSignIn()
    {
        await using var factory = new ApiFactory(
            _database.ConnectionString,
            new Dictionary<string, string?>
            {
                ["Seed:AdminUsername"] = SeedUsername,
                ["Seed:AdminPassword"] = SeedPassword,
            });
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/api/auth/login", new { username = SeedUsername, password = SeedPassword });

        Assert.True(response.IsSuccessStatusCode);
        Assert.Single(await SeedAuditRowsAsync());
    }

    [Fact]
    public async Task Startup_WithoutSeedSettingsAndAnEmptyDatabaseOutsideProduction_StillStarts()
    {
        await using var factory = new ApiFactory(_database.ConnectionString);
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/api/health");

        Assert.True(response.IsSuccessStatusCode);
        Assert.Empty(await AllUsersAsync());
    }
}
