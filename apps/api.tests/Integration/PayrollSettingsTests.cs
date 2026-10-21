using System.Net;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>W6: the single payroll-settings row, seeded by the migration, and the read endpoint (updates: PayrollSettingsUpdateTests).</summary>
public class PayrollSettingsTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    // --- database ------------------------------------------------------------------------------------------

    [Fact]
    public async Task TheMigration_SeedsExactlyOneRow_WithTheAgreedValues()
    {
        await using var db = TestUsers.NewContext(api.ConnectionString);

        var rows = await db.PayrollSettings.AsNoTracking().ToListAsync();

        var row = Assert.Single(rows);
        Assert.Equal(1, row.Id);
        Assert.Equal("DE AKS BE GLASS & ALUMINIUM CO. L.L.C S.O.C", row.CompanyName);
        Assert.Equal("Glass & Aluminum Installation & Maintenance Services", row.Tagline);
        Assert.Equal("hr@dxbaluminium.ae", row.ContactEmail);
        Assert.Equal(2.22m, row.OvertimeRatePerHour);
        Assert.Equal(8m, row.MaxBasicHoursPerDay);
        Assert.Equal("06:00 AM - 05:30 PM", row.ShiftDescription);
        Assert.Equal("HR Department", row.PreparedByLabel);
        Assert.Equal("General Manager", row.ApprovedByLabel);
    }

    private static PayrollSettings Settings(int id) => new()
    {
        Id = id,
        CompanyName = "Other Co",
        Tagline = "Tagline",
        ContactEmail = "x@example.com",
        OvertimeRatePerHour = 1m,
        MaxBasicHoursPerDay = 8m,
        ShiftDescription = "Shift",
        PreparedByLabel = "A",
        ApprovedByLabel = "B",
    };

    [Theory]
    [InlineData(0)]
    [InlineData(2)]
    [InlineData(-1)]
    public async Task APayrollSettingsRow_WithAnIdOtherThanOne_IsRejectedByTheDatabase(int id)
    {
        await using var db = TestUsers.NewContext(api.ConnectionString);
        db.PayrollSettings.Add(Settings(id));

        var exception = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());

        var sql = Assert.IsType<SqlException>(exception.InnerException);
        Assert.Equal(547, sql.Number);
        Assert.Contains("CK_PayrollSettings_SingleRow", sql.Message);
    }

    [Fact]
    public async Task ASecondRowWithIdOne_IsRejectedByTheDatabase()
    {
        await using var db = TestUsers.NewContext(api.ConnectionString);
        db.PayrollSettings.Add(Settings(1));

        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task PayrollSettingsTable_HasTheDocumentedColumns()
    {
        await using var connection = new SqlConnection(api.ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE, IS_NULLABLE " +
            "FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'PayrollSettings'";
        var columns = new Dictionary<string, (string Type, int? Length, int? Precision, int? Scale, string Nullable)>();
        await using (var reader = await command.ExecuteReaderAsync())
        {
            while (await reader.ReadAsync())
            {
                columns[reader.GetString(0)] = (
                    reader.GetString(1),
                    reader.IsDBNull(2) ? null : reader.GetInt32(2),
                    reader.IsDBNull(3) ? null : reader.GetByte(3),
                    reader.IsDBNull(4) ? null : reader.GetInt32(4),
                    reader.GetString(5));
            }
        }

        Assert.Equal(
            new[]
            {
                "ApprovedByLabel", "CompanyName", "ContactEmail", "Id", "MaxBasicHoursPerDay",
                "OvertimeRatePerHour", "PreparedByLabel", "ShiftDescription", "Tagline",
            },
            columns.Keys.Order().ToArray());
        Assert.Equal(("nvarchar", 120), (columns["CompanyName"].Type, columns["CompanyName"].Length));
        Assert.Equal(("nvarchar", 200), (columns["Tagline"].Type, columns["Tagline"].Length));
        Assert.Equal(("nvarchar", 120), (columns["ContactEmail"].Type, columns["ContactEmail"].Length));
        Assert.Equal(("nvarchar", 60), (columns["ShiftDescription"].Type, columns["ShiftDescription"].Length));
        Assert.Equal(("nvarchar", 60), (columns["PreparedByLabel"].Type, columns["PreparedByLabel"].Length));
        Assert.Equal(("nvarchar", 60), (columns["ApprovedByLabel"].Type, columns["ApprovedByLabel"].Length));
        Assert.Equal(("decimal", 9, 2), (columns["OvertimeRatePerHour"].Type, columns["OvertimeRatePerHour"].Precision, columns["OvertimeRatePerHour"].Scale));
        Assert.Equal(("decimal", 4, 2), (columns["MaxBasicHoursPerDay"].Type, columns["MaxBasicHoursPerDay"].Precision, columns["MaxBasicHoursPerDay"].Scale));
        Assert.All(columns.Values, column => Assert.Equal("NO", column.Nullable));
    }

    // --- endpoint ------------------------------------------------------------------------------------------

    [Fact]
    public async Task Get_Anonymous_IsUnauthorized()
    {
        var response = await api.GetAsync("/api/settings/payroll");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Theory]
    [InlineData(Roles.Supervisor)]
    [InlineData(Roles.Manager)]
    [InlineData(Roles.Administrator)]
    public async Task Get_ReturnsTheSeededSettings_CamelCased_ToEveryRole(string role)
    {
        var (_, token) = await TestWorkers.SignInAsync(api, role);

        var response = await api.GetAsync("/api/settings/payroll", token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var json = await TestWorkers.ReadJsonAsync(response);
        Assert.Equal(
            new[]
            {
                "approvedByLabel", "companyName", "contactEmail", "maxBasicHoursPerDay",
                "overtimeRatePerHour", "preparedByLabel", "shiftDescription", "tagline",
            },
            json.EnumerateObject().Select(p => p.Name).Order().ToArray());
        Assert.Equal("DE AKS BE GLASS & ALUMINIUM CO. L.L.C S.O.C", json.GetProperty("companyName").GetString());
        Assert.Equal("Glass & Aluminum Installation & Maintenance Services", json.GetProperty("tagline").GetString());
        Assert.Equal("hr@dxbaluminium.ae", json.GetProperty("contactEmail").GetString());
        if (role == Roles.Supervisor)
        {
            // A supervisor never sees pay information: the key is present but null.
            Assert.Equal(JsonValueKind.Null, json.GetProperty("overtimeRatePerHour").ValueKind);
            Assert.DoesNotContain("2.22", await response.Content.ReadAsStringAsync());
        }
        else
        {
            Assert.Equal(JsonValueKind.Number, json.GetProperty("overtimeRatePerHour").ValueKind);
            Assert.Equal(2.22m, json.GetProperty("overtimeRatePerHour").GetDecimal());
        }
        Assert.Equal(JsonValueKind.Number, json.GetProperty("maxBasicHoursPerDay").ValueKind);
        Assert.Equal(8m, json.GetProperty("maxBasicHoursPerDay").GetDecimal());
        Assert.Equal("06:00 AM - 05:30 PM", json.GetProperty("shiftDescription").GetString());
        Assert.Equal("HR Department", json.GetProperty("preparedByLabel").GetString());
        Assert.Equal("General Manager", json.GetProperty("approvedByLabel").GetString());
    }

    [Theory]
    [InlineData("POST")]
    [InlineData("PATCH")]
    [InlineData("DELETE")]
    public async Task OnlyPutWritesTheSettings_OtherVerbsAreNotAllowed_EvenForAnAdministrator(string verb)
    {
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Administrator);

        var response = await api.SendAsync(
            new HttpMethod(verb), "/api/settings/payroll", new { companyName = "Changed", overtimeRatePerHour = 9m }, token);

        Assert.Equal(HttpStatusCode.MethodNotAllowed, response.StatusCode);
        await using var db = TestUsers.NewContext(api.ConnectionString);
        Assert.Equal(2.22m, (await db.PayrollSettings.SingleAsync()).OvertimeRatePerHour);
    }
}
