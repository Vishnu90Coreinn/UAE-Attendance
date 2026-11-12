using System.Net;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>The profile fields the HR letters need: nationality, allowances and bank details.</summary>
public class WorkerLetterFieldsTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private static string Code() => "LF" + Guid.NewGuid().ToString("N")[..8];

    private async Task<JsonElement> CreateAsync(string token, object extra)
    {
        var body = new Dictionary<string, object?>
        {
            ["workerCode"] = Code(), ["fullName"] = "Letter Worker", ["designation"] = "Fitter", ["monthlySalary"] = 1600m,
        };
        foreach (var property in extra.GetType().GetProperties()) body[char.ToLowerInvariant(property.Name[0]) + property.Name[1..]] = property.GetValue(extra);
        var response = await api.SendAsync(HttpMethod.Post, "/api/workers", body, token);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await TestWorkers.ReadJsonAsync(response);
    }

    [Fact]
    public async Task Create_StoresAndReturnsTheNewFields()
    {
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Manager);

        var json = await CreateAsync(token, new
        {
            Nationality = " Pakistani ", HousingAllowance = 800m, TransportAllowance = 400m, OtherAllowance = 200m,
            BankName = "Emirates NBD", BankAccountNumber = "012984719201", Iban = "ae03 0330 0001 2984 7192 01",
        });

        Assert.Equal("Pakistani", json.GetProperty("nationality").GetString());
        Assert.Equal(800m, json.GetProperty("housingAllowance").GetDecimal());
        Assert.Equal(400m, json.GetProperty("transportAllowance").GetDecimal());
        Assert.Equal(200m, json.GetProperty("otherAllowance").GetDecimal());
        Assert.Equal("Emirates NBD", json.GetProperty("bankName").GetString());
        Assert.Equal("012984719201", json.GetProperty("bankAccountNumber").GetString());
        Assert.Equal("AE030330000129847192" + "01", json.GetProperty("iban").GetString());
    }

    [Fact]
    public async Task Create_WithoutTheNewFields_DefaultsAllowancesToZero()
    {
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Manager);

        var json = await CreateAsync(token, new { });

        Assert.Equal(0m, json.GetProperty("housingAllowance").GetDecimal());
        Assert.Equal(JsonValueKind.Null, json.GetProperty("nationality").ValueKind);
        Assert.Equal(JsonValueKind.Null, json.GetProperty("iban").ValueKind);
    }

    [Theory]
    [InlineData("housingAllowance", -1, "Housing allowance cannot be negative.")]
    [InlineData("transportAllowance", 1.234, "Transport allowance can have at most 2 decimal places.")]
    [InlineData("otherAllowance", 100000, "Other allowance must be 99999.99 or less.")]
    public async Task Create_RejectsBadAllowances(string field, double value, string message)
    {
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var body = new Dictionary<string, object?>
        {
            ["workerCode"] = Code(), ["fullName"] = "X", ["designation"] = "Y", ["monthlySalary"] = 1600m, [field] = (decimal)value,
        };

        var response = await api.SendAsync(HttpMethod.Post, "/api/workers", body, token);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var errors = (await TestWorkers.ReadJsonAsync(response)).GetProperty("errors");
        Assert.Equal(message, errors.GetProperty(field)[0].GetString());
    }

    [Fact]
    public async Task Create_RejectsTooLongText()
    {
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var response = await api.SendAsync(HttpMethod.Post, "/api/workers", new
        {
            workerCode = Code(), fullName = "X", designation = "Y", monthlySalary = 1600m,
            nationality = new string('n', 61), bankName = new string('b', 81), bankAccountNumber = new string('1', 41), iban = new string('A', 41),
        }, token);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var errors = (await TestWorkers.ReadJsonAsync(response)).GetProperty("errors");
        foreach (var field in new[] { "nationality", "bankName", "bankAccountNumber", "iban" }) Assert.True(errors.TryGetProperty(field, out _), field);
    }

    [Fact]
    public async Task Update_ChangesFields_AuditsThem_AndMasksTheAccountNumbers()
    {
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var created = await CreateAsync(token, new { HousingAllowance = 800m });
        var id = created.GetProperty("id").GetInt32();

        var response = await api.SendAsync(HttpMethod.Put, $"/api/workers/{id}", new
        {
            workerCode = created.GetProperty("workerCode").GetString(), fullName = "Letter Worker", designation = "Fitter", monthlySalary = 1600m,
            nationality = "Indian", housingAllowance = 900m, bankName = "Mashreq", bankAccountNumber = "9988776655", iban = "AE070331234567890123456",
        }, token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var json = await TestWorkers.ReadJsonAsync(response);
        Assert.Equal(900m, json.GetProperty("housingAllowance").GetDecimal());
        Assert.Equal("Indian", json.GetProperty("nationality").GetString());

        await using var db = TestUsers.NewContext(api.ConnectionString);
        var details = await db.AuditLogs.Where(a => a.Action == "WorkerUpdated" && a.EntityId == id.ToString()).Select(a => a.DetailsJson).SingleAsync();
        Assert.Contains("housingAllowance", details);
        Assert.Contains("****6655", details);
        Assert.DoesNotContain("9988776655", details);
        Assert.DoesNotContain("AE070331234567890123456", details);
    }

    [Fact]
    public async Task Update_OmittingAllowances_LeavesThemUnchanged_AndZeroClearsThem()
    {
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var created = await CreateAsync(token, new { HousingAllowance = 800m, TransportAllowance = 400m });
        var id = created.GetProperty("id").GetInt32();
        var code = created.GetProperty("workerCode").GetString();

        var omitted = await TestWorkers.ReadJsonAsync(await api.SendAsync(HttpMethod.Put, $"/api/workers/{id}",
            new { workerCode = code, fullName = "Letter Worker", designation = "Fitter", monthlySalary = 1600m }, token));
        Assert.Equal(800m, omitted.GetProperty("housingAllowance").GetDecimal());

        var cleared = await TestWorkers.ReadJsonAsync(await api.SendAsync(HttpMethod.Put, $"/api/workers/{id}",
            new { workerCode = code, fullName = "Letter Worker", designation = "Fitter", monthlySalary = 1600m, housingAllowance = 0m }, token));
        Assert.Equal(0m, cleared.GetProperty("housingAllowance").GetDecimal());
        Assert.Equal(400m, cleared.GetProperty("transportAllowance").GetDecimal());
    }

    [Fact]
    public async Task Supervisor_NeverReceivesAllowancesOrBankDetails_ButSeesNationality()
    {
        var (_, manager) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var created = await CreateAsync(manager, new
        {
            Nationality = "Nepali", HousingAllowance = 811.11m, TransportAllowance = 422.22m, OtherAllowance = 233.33m,
            BankName = "Secret Bank", BankAccountNumber = "55667788", Iban = "AE999888777666555444333",
        });
        var id = created.GetProperty("id").GetInt32();
        var (_, supervisor) = await TestWorkers.SignInAsync(api, Roles.Supervisor);

        foreach (var path in new[] { $"/api/workers/{id}", "/api/workers?includeInactive=true" })
        {
            var response = await api.GetAsync(path, supervisor);
            var body = await response.Content.ReadAsStringAsync();
            foreach (var secret in new[] { "811.11", "422.22", "233.33", "Secret Bank", "55667788", "AE999888777666555444333" })
                Assert.DoesNotContain(secret, body);
            var element = JsonDocument.Parse(body).RootElement;
            var row = element.ValueKind == JsonValueKind.Array ? element.EnumerateArray().Single(w => w.GetProperty("id").GetInt32() == id) : element;
            foreach (var field in new[] { "housingAllowance", "transportAllowance", "otherAllowance", "bankName", "bankAccountNumber", "iban" })
                Assert.Equal(JsonValueKind.Null, row.GetProperty(field).ValueKind);
            Assert.Equal("Nepali", row.GetProperty("nationality").GetString());
        }
    }

    [Fact]
    public async Task Hr_SeesTheNewFields()
    {
        var (_, manager) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var created = await CreateAsync(manager, new { HousingAllowance = 500m, Iban = "AE111" });
        var (_, hr) = await TestWorkers.SignInAsync(api, Roles.HR);

        var json = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/workers/{created.GetProperty("id").GetInt32()}", hr));

        Assert.Equal(500m, json.GetProperty("housingAllowance").GetDecimal());
        Assert.Equal("AE111", json.GetProperty("iban").GetString());
    }
}
