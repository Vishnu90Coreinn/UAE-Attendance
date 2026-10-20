using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>The Workers table itself: constraints, column definitions and defaults (checked straight in SQL Server).</summary>
public class WorkerConstraintTests(TestDatabase database) : IClassFixture<TestDatabase>
{
    private AppDbContext NewContext() => TestUsers.NewContext(database.ConnectionString);

    private static Worker NewWorker(string? code = null, decimal rate = 12.5m) => new()
    {
        WorkerCode = code ?? TestWorkers.UniqueCode(),
        FullName = "Test Worker",
        Designation = "Glass Installer",
        HourlyRate = rate,
    };

    private async Task<List<Dictionary<string, object?>>> QueryAsync(string sql)
    {
        await using var connection = new SqlConnection(database.ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        await using var reader = await command.ExecuteReaderAsync();
        var rows = new List<Dictionary<string, object?>>();
        while (await reader.ReadAsync())
        {
            var row = new Dictionary<string, object?>();
            for (var i = 0; i < reader.FieldCount; i++)
            {
                row[reader.GetName(i)] = reader.IsDBNull(i) ? null : reader.GetValue(i);
            }

            rows.Add(row);
        }

        return rows;
    }

    // --- rate ----------------------------------------------------------------------------------------------

    [Theory]
    [InlineData("0")]
    [InlineData("-1")]
    [InlineData("-0.01")]
    public async Task HourlyRate_ZeroOrNegative_IsRejectedByTheDatabase(string rate)
    {
        await using var db = NewContext();
        db.Workers.Add(NewWorker(rate: decimal.Parse(rate, System.Globalization.CultureInfo.InvariantCulture)));

        var exception = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());

        var sql = Assert.IsType<SqlException>(exception.InnerException);
        Assert.Equal(547, sql.Number);
        Assert.Contains("CK_Workers_HourlyRate", sql.Message);
    }

    [Theory]
    [InlineData("0.01")]
    [InlineData("12.5")]
    [InlineData("999.99")]
    public async Task HourlyRate_Positive_IsAccepted(string rate)
    {
        await using var db = NewContext();
        db.Workers.Add(NewWorker(rate: decimal.Parse(rate, System.Globalization.CultureInfo.InvariantCulture)));

        await db.SaveChangesAsync();
    }

    // --- code ----------------------------------------------------------------------------------------------

    [Fact]
    public async Task WorkerCode_IsUniqueCaseInsensitively()
    {
        var code = $"Dup{Guid.NewGuid():N}"[..15];
        await using (var db = NewContext())
        {
            db.Workers.Add(NewWorker(code));
            await db.SaveChangesAsync();
        }

        await using var second = NewContext();
        second.Workers.Add(NewWorker(code.ToUpperInvariant()));

        var exception = await Assert.ThrowsAsync<DbUpdateException>(() => second.SaveChangesAsync());
        var sql = Assert.IsType<SqlException>(exception.InnerException);
        Assert.Contains(sql.Number, new[] { 2601, 2627 });
    }

    [Fact]
    public async Task WorkerCode_DifferentCodes_AreAccepted()
    {
        await using var db = NewContext();
        db.Workers.AddRange(NewWorker(), NewWorker());

        await db.SaveChangesAsync();
    }

    // --- round trip and defaults ---------------------------------------------------------------------------

    [Fact]
    public async Task Worker_RoundTripsWithDefaults()
    {
        var code = $"Round{Guid.NewGuid():N}"[..15];
        await using (var db = NewContext())
        {
            db.Workers.Add(NewWorker(code, 12.5m));
            await db.SaveChangesAsync();
        }

        await using var read = NewContext();
        var worker = await read.Workers.SingleAsync(w => w.WorkerCode == code.ToUpperInvariant());

        Assert.True(worker.Id > 0);
        Assert.Equal(code, worker.WorkerCode);
        Assert.Equal("Test Worker", worker.FullName);
        Assert.Equal("Glass Installer", worker.Designation);
        Assert.Equal(12.5m, worker.HourlyRate);
        Assert.True(worker.IsActive);
        Assert.True(worker.CreatedUtc > DateTime.UtcNow.AddMinutes(-1) && worker.CreatedUtc < DateTime.UtcNow.AddMinutes(1));
        Assert.True(worker.UpdatedUtc > DateTime.UtcNow.AddMinutes(-1) && worker.UpdatedUtc < DateTime.UtcNow.AddMinutes(1));
    }

    [Fact]
    public async Task Worker_CanBeSavedInactive()
    {
        var code = $"Off{Guid.NewGuid():N}"[..15];
        await using (var db = NewContext())
        {
            var worker = NewWorker(code);
            worker.IsActive = false;
            db.Workers.Add(worker);
            await db.SaveChangesAsync();
        }

        await using var read = NewContext();
        Assert.False((await read.Workers.SingleAsync(w => w.WorkerCode == code)).IsActive);
    }

    // --- column definitions --------------------------------------------------------------------------------

    [Fact]
    public async Task WorkersTable_HasTheDocumentedColumns()
    {
        var columns = (await QueryAsync(
            "SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE, IS_NULLABLE, COLLATION_NAME " +
            "FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Workers'"))
            .ToDictionary(r => (string)r["COLUMN_NAME"]!);

        Assert.Equal(
            new[] { "CreatedUtc", "Designation", "FullName", "HourlyRate", "Id", "IsActive", "UpdatedUtc", "WorkerCode" },
            columns.Keys.Order().ToArray());

        Assert.Equal("nvarchar", columns["WorkerCode"]["DATA_TYPE"]);
        Assert.Equal(20, columns["WorkerCode"]["CHARACTER_MAXIMUM_LENGTH"]);
        Assert.Equal("SQL_Latin1_General_CP1_CI_AS", columns["WorkerCode"]["COLLATION_NAME"]);
        Assert.Equal("nvarchar", columns["FullName"]["DATA_TYPE"]);
        Assert.Equal(120, columns["FullName"]["CHARACTER_MAXIMUM_LENGTH"]);
        Assert.Equal("nvarchar", columns["Designation"]["DATA_TYPE"]);
        Assert.Equal(80, columns["Designation"]["CHARACTER_MAXIMUM_LENGTH"]);
        Assert.Equal("decimal", columns["HourlyRate"]["DATA_TYPE"]);
        Assert.Equal((byte)9, columns["HourlyRate"]["NUMERIC_PRECISION"]);
        Assert.Equal(2, columns["HourlyRate"]["NUMERIC_SCALE"]);
        Assert.Equal("bit", columns["IsActive"]["DATA_TYPE"]);
        Assert.Equal("datetime2", columns["CreatedUtc"]["DATA_TYPE"]);
        Assert.Equal("datetime2", columns["UpdatedUtc"]["DATA_TYPE"]);
        Assert.All(columns.Values, column => Assert.Equal("NO", column["IS_NULLABLE"]));
    }

    [Fact]
    public async Task WorkersTable_HasTheRateCheckAndTheUniqueCodeIndex()
    {
        var checks = await QueryAsync(
            "SELECT cc.name, cc.definition FROM sys.check_constraints cc WHERE cc.parent_object_id = OBJECT_ID('Workers')");
        var rateCheck = Assert.Single(checks);
        Assert.Equal("CK_Workers_HourlyRate", rateCheck["name"]);
        Assert.Contains("HourlyRate", (string)rateCheck["definition"]!);

        var indexes = await QueryAsync(
            "SELECT i.name, i.is_unique, c.name AS column_name FROM sys.indexes i " +
            "JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id " +
            "JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id " +
            "WHERE i.object_id = OBJECT_ID('Workers') AND i.is_primary_key = 0");
        var index = Assert.Single(indexes);
        Assert.Equal(true, index["is_unique"]);
        Assert.Equal("WorkerCode", index["column_name"]);
    }
}
