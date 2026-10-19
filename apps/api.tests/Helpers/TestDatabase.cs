using HrPayroll.Api.Data;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Helpers;

/// <summary>
/// Creates a throw-away SQL Server database, applies the real EF migrations to it, and drops it
/// afterwards. Uses LocalDB by default; set TEST_SQL_CONNECTION to point at another SQL Server
/// (the Database/Initial Catalog part is ignored).
/// </summary>
public sealed class TestDatabase : IAsyncLifetime
{
    private const string DefaultServerConnection =
        @"Server=(localdb)\MSSQLLocalDB;Integrated Security=true;TrustServerCertificate=True;Connect Timeout=30";

    private readonly string _databaseName = $"HrPayroll_Test_{Guid.NewGuid():N}";
    private string _masterConnectionString = "";

    public string ConnectionString { get; private set; } = "";

    public async Task InitializeAsync()
    {
        var serverConnection = Environment.GetEnvironmentVariable("TEST_SQL_CONNECTION") ?? DefaultServerConnection;
        _masterConnectionString = new SqlConnectionStringBuilder(serverConnection) { InitialCatalog = "master" }.ConnectionString;
        ConnectionString = new SqlConnectionStringBuilder(serverConnection) { InitialCatalog = _databaseName }.ConnectionString;

        await ExecuteOnMasterAsync($"CREATE DATABASE [{_databaseName}]");

        var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(ConnectionString).Options;
        await using var db = new AppDbContext(options);
        await db.Database.MigrateAsync();
    }

    public async Task DisposeAsync()
    {
        SqlConnection.ClearAllPools();
        await ExecuteOnMasterAsync(
            $"ALTER DATABASE [{_databaseName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{_databaseName}];");
    }

    private async Task ExecuteOnMasterAsync(string sql)
    {
        await using var connection = new SqlConnection(_masterConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync();
    }
}
