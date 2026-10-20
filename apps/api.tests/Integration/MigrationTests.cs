using HrPayroll.Api.Data;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace HrPayroll.Api.Tests.Integration;

public class MigrationTests(TestDatabase database) : IClassFixture<TestDatabase>
{
    private const string PreviousMigration = "20261020054712_AddUsersAndAuditLogs";

    [Fact]
    public async Task Migrations_ApplyCleanlyToAnEmptyDatabase()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(database.ConnectionString).Options;
        await using var db = new AppDbContext(options);

        var applied = await db.Database.GetAppliedMigrationsAsync();
        var pending = await db.Database.GetPendingMigrationsAsync();

        Assert.Contains(applied, name => name.EndsWith("_Initial"));
        Assert.Contains(applied, name => name.EndsWith("_AddUsersAndAuditLogs"));
        Assert.Contains(applied, name => name.EndsWith("_AddWorkersAndPayrollSettings"));
        Assert.Empty(pending);
    }

    [Fact]
    public void TheModelMatchesTheMigrations_SoNoMigrationIsMissing()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(database.ConnectionString).Options;
        using var db = new AppDbContext(options);

        Assert.False(db.Database.HasPendingModelChanges());
    }

    [Fact]
    public async Task TheWorkersMigration_UpgradesADatabaseThatHasUsers_AndCanBeReverted()
    {
        var serverConnection = new SqlConnectionStringBuilder(database.ConnectionString) { InitialCatalog = "master" }.ConnectionString;
        var name = $"HrPayroll_Test_{Guid.NewGuid():N}";
        var connectionString = new SqlConnectionStringBuilder(database.ConnectionString) { InitialCatalog = name }.ConnectionString;

        await ExecuteAsync(serverConnection, $"CREATE DATABASE [{name}]");
        try
        {
            var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(connectionString).Options;
            await using var db = new AppDbContext(options);
            var migrator = db.GetService<IMigrator>();

            await migrator.MigrateAsync(PreviousMigration);
            await ExecuteAsync(connectionString,
                "INSERT INTO Users (Username, PasswordHash, Role, IsActive, FailedLoginCount, CreatedUtc) VALUES ('keepme', 'h', 'Viewer', 1, 0, SYSUTCDATETIME())");
            Assert.False(await TableExistsAsync(connectionString, "Workers"));
            Assert.False(await TableExistsAsync(connectionString, "PayrollSettings"));

            await db.Database.MigrateAsync();

            Assert.True(await TableExistsAsync(connectionString, "Workers"));
            Assert.True(await TableExistsAsync(connectionString, "PayrollSettings"));
            Assert.Equal(1, await db.PayrollSettings.CountAsync());
            Assert.Equal(1, await db.Users.CountAsync(u => u.Username == "keepme"));

            await migrator.MigrateAsync(PreviousMigration);

            Assert.False(await TableExistsAsync(connectionString, "Workers"));
            Assert.False(await TableExistsAsync(connectionString, "PayrollSettings"));
            Assert.Equal(1, await db.Users.CountAsync(u => u.Username == "keepme"));
        }
        finally
        {
            SqlConnection.ClearAllPools();
            await ExecuteAsync(serverConnection,
                $"IF DB_ID(N'{name}') IS NOT NULL BEGIN ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{name}]; END");
        }
    }

    private static async Task ExecuteAsync(string connectionString, string sql)
    {
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync();
    }

    private static async Task<bool> TableExistsAsync(string connectionString, string table)
    {
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = @name";
        command.Parameters.AddWithValue("@name", table);
        return (int)(await command.ExecuteScalarAsync())! == 1;
    }
}
