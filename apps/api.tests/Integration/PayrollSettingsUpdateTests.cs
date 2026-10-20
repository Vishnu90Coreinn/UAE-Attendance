using System.Net;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>S2b: <c>PUT /api/settings/payroll</c> (Administrator only) with validation and the SettingsChanged audit row.</summary>
public class PayrollSettingsUpdateTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private const string Route = "/api/settings/payroll";

    private static readonly string[] AllFields =
    [
        "approvedByLabel", "companyName", "contactEmail", "maxBasicHoursPerDay",
        "overtimeRatePerHour", "preparedByLabel", "shiftDescription", "tagline",
    ];

    // --- helpers -------------------------------------------------------------------------------------------

    /// <summary>A complete valid body that differs from the seeded defaults in every field.</summary>
    private static Dictionary<string, object?> ValidBody() => new()
    {
        ["companyName"] = "Acme Glass LLC",
        ["tagline"] = "Windows and doors",
        ["contactEmail"] = "payroll@acme.example",
        ["overtimeRatePerHour"] = 2.5m,
        ["maxBasicHoursPerDay"] = 9m,
        ["shiftDescription"] = "07:00 AM - 06:00 PM",
        ["preparedByLabel"] = "Payroll Office",
        ["approvedByLabel"] = "Managing Director",
    };

    private static Dictionary<string, object?> With(string field, object? value)
    {
        var body = ValidBody();
        body[field] = value;
        return body;
    }

    /// <summary>Puts the single settings row back to the seeded values and removes earlier settings audit rows.</summary>
    private async Task ResetAsync()
    {
        await using var db = TestUsers.NewContext(api.ConnectionString);
        await db.PayrollSettings.ExecuteUpdateAsync(s => s
            .SetProperty(p => p.CompanyName, "DE AKS BE GLASS & ALUMINIUM CO. L.L.C S.O.C")
            .SetProperty(p => p.Tagline, "Glass & Aluminum Installation & Maintenance Services")
            .SetProperty(p => p.ContactEmail, "hr@dxbaluminium.ae")
            .SetProperty(p => p.OvertimeRatePerHour, 2.22m)
            .SetProperty(p => p.MaxBasicHoursPerDay, 8m)
            .SetProperty(p => p.ShiftDescription, "06:00 AM - 05:30 PM")
            .SetProperty(p => p.PreparedByLabel, "HR Department")
            .SetProperty(p => p.ApprovedByLabel, "General Manager"));
        await db.AuditLogs.Where(a => a.Action == "SettingsChanged").ExecuteDeleteAsync();
    }

    private async Task<PayrollSettings> StoredAsync()
    {
        await using var db = TestUsers.NewContext(api.ConnectionString);
        return await db.PayrollSettings.AsNoTracking().SingleAsync();
    }

    private async Task<List<AuditLog>> AuditRowsAsync()
    {
        await using var db = TestUsers.NewContext(api.ConnectionString);
        return await db.AuditLogs.AsNoTracking().Where(a => a.Action == "SettingsChanged").ToListAsync();
    }

    private static string[] KeysOf(JsonElement element) => element.EnumerateObject().Select(p => p.Name).Order().ToArray();

    private async Task<string> AdminTokenAsync() => (await TestWorkers.SignInAsync(api, Roles.Administrator)).Token;

    private static async Task<JsonElement> ErrorsOf(HttpResponseMessage response)
    {
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        return (await TestWorkers.ReadJsonAsync(response)).GetProperty("errors");
    }

    // --- role matrix ---------------------------------------------------------------------------------------

    [Fact]
    public async Task Put_Anonymous_IsUnauthorized_AndChangesNothing()
    {
        await ResetAsync();

        var response = await api.SendAsync(HttpMethod.Put, Route, ValidBody());

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal(2.22m, (await StoredAsync()).OvertimeRatePerHour);
        Assert.Empty(await AuditRowsAsync());
    }

    [Theory]
    [InlineData(Roles.Supervisor)]
    public async Task Put_BySupervisor_IsForbidden_AndChangesNothing(string role)
    {
        await ResetAsync();
        var (_, token) = await TestWorkers.SignInAsync(api, role);

        var response = await api.SendAsync(HttpMethod.Put, Route, ValidBody(), token);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        var stored = await StoredAsync();
        Assert.Equal("DE AKS BE GLASS & ALUMINIUM CO. L.L.C S.O.C", stored.CompanyName);
        Assert.Equal("Glass & Aluminum Installation & Maintenance Services", stored.Tagline);
        Assert.Equal("hr@dxbaluminium.ae", stored.ContactEmail);
        Assert.Equal(2.22m, stored.OvertimeRatePerHour);
        Assert.Equal(8m, stored.MaxBasicHoursPerDay);
        Assert.Equal("06:00 AM - 05:30 PM", stored.ShiftDescription);
        Assert.Equal("HR Department", stored.PreparedByLabel);
        Assert.Equal("General Manager", stored.ApprovedByLabel);
        Assert.Empty(await AuditRowsAsync());
    }

    [Theory]
    [InlineData(Roles.Supervisor)]
    public async Task Put_BySupervisor_WithAnInvalidBody_IsStillForbidden(string role)
    {
        var (_, token) = await TestWorkers.SignInAsync(api, role);

        var response = await api.SendAsync(HttpMethod.Put, Route, With("overtimeRatePerHour", -5m), token);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Put_ByManager_IsOk_AndSavesTheChange()
    {
        await ResetAsync();
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Manager);

        var response = await api.SendAsync(HttpMethod.Put, Route, ValidBody(), token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(2.5m, (await StoredAsync()).OvertimeRatePerHour);
    }

    [Fact]
    public async Task Put_ByAdministrator_IsOk()
    {
        await ResetAsync();

        var response = await api.SendAsync(HttpMethod.Put, Route, ValidBody(), await AdminTokenAsync());

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Theory]
    [InlineData("POST")]
    [InlineData("PATCH")]
    [InlineData("DELETE")]
    public async Task OtherVerbsOnTheSettingsRoute_AreStillNotAllowed_EvenForAnAdministrator(string verb)
    {
        await ResetAsync();

        var response = await api.SendAsync(new HttpMethod(verb), Route, ValidBody(), await AdminTokenAsync());

        Assert.Equal(HttpStatusCode.MethodNotAllowed, response.StatusCode);
        Assert.Equal(2.22m, (await StoredAsync()).OvertimeRatePerHour);
    }

    // --- success -------------------------------------------------------------------------------------------

    [Fact]
    public async Task Put_SavesEveryField_ReturnsTheSettingsInTheGetShape_AndGetShowsThem()
    {
        await ResetAsync();
        var token = await AdminTokenAsync();

        var response = await api.SendAsync(HttpMethod.Put, Route, ValidBody(), token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var json = await TestWorkers.ReadJsonAsync(response);
        Assert.Equal(AllFields, KeysOf(json));
        AssertSavedValues(json);

        var stored = await StoredAsync();
        Assert.Equal("Acme Glass LLC", stored.CompanyName);
        Assert.Equal("Windows and doors", stored.Tagline);
        Assert.Equal("payroll@acme.example", stored.ContactEmail);
        Assert.Equal(2.5m, stored.OvertimeRatePerHour);
        Assert.Equal(9m, stored.MaxBasicHoursPerDay);
        Assert.Equal("07:00 AM - 06:00 PM", stored.ShiftDescription);
        Assert.Equal("Payroll Office", stored.PreparedByLabel);
        Assert.Equal("Managing Director", stored.ApprovedByLabel);

        var (_, managerToken) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var get = await api.GetAsync(Route, managerToken);
        Assert.Equal(HttpStatusCode.OK, get.StatusCode);
        AssertSavedValues(await TestWorkers.ReadJsonAsync(get));
    }

    private static void AssertSavedValues(JsonElement json)
    {
        Assert.Equal("Acme Glass LLC", json.GetProperty("companyName").GetString());
        Assert.Equal("Windows and doors", json.GetProperty("tagline").GetString());
        Assert.Equal("payroll@acme.example", json.GetProperty("contactEmail").GetString());
        Assert.Equal(JsonValueKind.Number, json.GetProperty("overtimeRatePerHour").ValueKind);
        Assert.Equal(2.5m, json.GetProperty("overtimeRatePerHour").GetDecimal());
        Assert.Equal(JsonValueKind.Number, json.GetProperty("maxBasicHoursPerDay").ValueKind);
        Assert.Equal(9m, json.GetProperty("maxBasicHoursPerDay").GetDecimal());
        Assert.Equal("07:00 AM - 06:00 PM", json.GetProperty("shiftDescription").GetString());
        Assert.Equal("Payroll Office", json.GetProperty("preparedByLabel").GetString());
        Assert.Equal("Managing Director", json.GetProperty("approvedByLabel").GetString());
    }

    [Fact]
    public async Task Put_TrimsEveryTextField()
    {
        await ResetAsync();
        var body = new Dictionary<string, object?>
        {
            ["companyName"] = "  Acme Glass LLC \t",
            ["tagline"] = "  Windows and doors  ",
            ["contactEmail"] = "  payroll@acme.example ",
            ["overtimeRatePerHour"] = 2.5m,
            ["maxBasicHoursPerDay"] = 9m,
            ["shiftDescription"] = " 07:00 AM - 06:00 PM ",
            ["preparedByLabel"] = " Payroll Office ",
            ["approvedByLabel"] = "  Managing Director  ",
        };

        var response = await api.SendAsync(HttpMethod.Put, Route, body, await AdminTokenAsync());

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        AssertSavedValues(await TestWorkers.ReadJsonAsync(response));
        var stored = await StoredAsync();
        Assert.Equal("Acme Glass LLC", stored.CompanyName);
        Assert.Equal("Windows and doors", stored.Tagline);
        Assert.Equal("payroll@acme.example", stored.ContactEmail);
        Assert.Equal("07:00 AM - 06:00 PM", stored.ShiftDescription);
        Assert.Equal("Payroll Office", stored.PreparedByLabel);
        Assert.Equal("Managing Director", stored.ApprovedByLabel);
    }

    [Fact]
    public async Task Put_AllowsAnEmptyTagline_AndAnOvertimeRateOfZero()
    {
        await ResetAsync();
        var body = With("tagline", "   ");
        body["overtimeRatePerHour"] = 0m;

        var response = await api.SendAsync(HttpMethod.Put, Route, body, await AdminTokenAsync());

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var stored = await StoredAsync();
        Assert.Equal("", stored.Tagline);
        Assert.Equal(0m, stored.OvertimeRatePerHour);
    }

    [Fact]
    public async Task Put_AcceptsTheLongestAndLargestValues()
    {
        await ResetAsync();
        var body = new Dictionary<string, object?>
        {
            ["companyName"] = new string('c', 120),
            ["tagline"] = new string('t', 200),
            ["contactEmail"] = new string('e', 120 - "@x.io".Length) + "@x.io", // exactly 120
            ["overtimeRatePerHour"] = 999.99m,
            ["maxBasicHoursPerDay"] = 24m,
            ["shiftDescription"] = new string('s', 60),
            ["preparedByLabel"] = new string('p', 60),
            ["approvedByLabel"] = new string('a', 60),
        };

        var response = await api.SendAsync(HttpMethod.Put, Route, body, await AdminTokenAsync());

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var stored = await StoredAsync();
        Assert.Equal(120, stored.CompanyName.Length);
        Assert.Equal(200, stored.Tagline.Length);
        Assert.Equal(120, stored.ContactEmail.Length);
        Assert.Equal(999.99m, stored.OvertimeRatePerHour);
        Assert.Equal(24m, stored.MaxBasicHoursPerDay);
        Assert.Equal(60, stored.ShiftDescription.Length);
    }

    [Fact]
    public async Task Put_AcceptsTheShortestValues()
    {
        await ResetAsync();
        var body = new Dictionary<string, object?>
        {
            ["companyName"] = "C",
            ["tagline"] = "",
            ["contactEmail"] = "a@b",
            ["overtimeRatePerHour"] = 0.01m,
            ["maxBasicHoursPerDay"] = 0.01m,
            ["shiftDescription"] = "S",
            ["preparedByLabel"] = "P",
            ["approvedByLabel"] = "A",
        };

        var response = await api.SendAsync(HttpMethod.Put, Route, body, await AdminTokenAsync());

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var stored = await StoredAsync();
        Assert.Equal(0.01m, stored.OvertimeRatePerHour);
        Assert.Equal(0.01m, stored.MaxBasicHoursPerDay);
    }

    // --- validation ----------------------------------------------------------------------------------------

    public static TheoryData<string, string?> InvalidValues()
    {
        var data = new TheoryData<string, string?>();

        // Each row is: field, a JSON literal for its value (null = leave the property out).
        // "tagline" may be empty or missing, so it only has the too-long row.
        static string Text(string value) => JsonSerializer.Serialize(value);

        foreach (var field in new[] { "companyName", "shiftDescription", "preparedByLabel", "approvedByLabel", "contactEmail" })
        {
            data.Add(field, null);
            data.Add(field, "null");
            data.Add(field, Text(""));
            data.Add(field, Text("   \t "));
        }

        data.Add("companyName", Text(new string('c', 121)));
        data.Add("tagline", Text(new string('t', 201)));
        data.Add("shiftDescription", Text(new string('s', 61)));
        data.Add("preparedByLabel", Text(new string('p', 61)));
        data.Add("approvedByLabel", Text(new string('a', 61)));
        data.Add("contactEmail", Text(new string('e', 117) + "@x.io")); // 122 characters

        // contactEmail shape
        foreach (var email in new[]
                 {
                     "no-at-sign", "@nolocal.example", "nodomain@", "two@@signs.example", "a@b@c.example",
                     "has space@x.example", "a@has space.example", "a@b.exa\tmple", "plain text with spaces",
                 })
        {
            data.Add("contactEmail", Text(email));
        }

        // overtimeRatePerHour
        data.Add("overtimeRatePerHour", null);
        data.Add("overtimeRatePerHour", "null");
        data.Add("overtimeRatePerHour", "-0.01");
        data.Add("overtimeRatePerHour", "-1");
        data.Add("overtimeRatePerHour", "1000");
        data.Add("overtimeRatePerHour", "1000.00");
        data.Add("overtimeRatePerHour", "999.991");
        data.Add("overtimeRatePerHour", "2.225");
        data.Add("overtimeRatePerHour", "0.001");
        data.Add("overtimeRatePerHour", "99999999999");

        // maxBasicHoursPerDay
        data.Add("maxBasicHoursPerDay", null);
        data.Add("maxBasicHoursPerDay", "null");
        data.Add("maxBasicHoursPerDay", "0");
        data.Add("maxBasicHoursPerDay", "0.00");
        data.Add("maxBasicHoursPerDay", "-1");
        data.Add("maxBasicHoursPerDay", "24.01");
        data.Add("maxBasicHoursPerDay", "25");
        data.Add("maxBasicHoursPerDay", "8.005");
        data.Add("maxBasicHoursPerDay", "0.001");
        return data;
    }

    private static string RawBody(string field, string? literal)
    {
        var body = ValidBody();
        var parts = body.Where(p => p.Key != field)
            .Select(p => $"{JsonSerializer.Serialize(p.Key)}:{JsonSerializer.Serialize(p.Value)}")
            .ToList();
        if (literal is not null)
        {
            parts.Add($"{JsonSerializer.Serialize(field)}:{literal}");
        }

        return "{" + string.Join(',', parts) + "}";
    }

    [Theory]
    [MemberData(nameof(InvalidValues))]
    public async Task Put_WithAnInvalidField_IsABadRequestNamingOnlyThatField_AndChangesNothing(string field, string? literal)
    {
        await ResetAsync();

        var response = await api.SendJsonAsync(HttpMethod.Put, Route, RawBody(field, literal), await AdminTokenAsync());

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var errors = await ErrorsOf(response);
        Assert.Equal([field], KeysOf(errors));
        Assert.False(string.IsNullOrWhiteSpace(errors.GetProperty(field)[0].GetString()));
        var stored = await StoredAsync();
        Assert.Equal("DE AKS BE GLASS & ALUMINIUM CO. L.L.C S.O.C", stored.CompanyName);
        Assert.Equal(2.22m, stored.OvertimeRatePerHour);
        Assert.Equal(8m, stored.MaxBasicHoursPerDay);
        Assert.Empty(await AuditRowsAsync());
    }

    [Fact]
    public async Task Put_WithEveryFieldInvalid_ReportsAllEightFields()
    {
        await ResetAsync();
        var body = new Dictionary<string, object?>
        {
            ["companyName"] = "",
            ["tagline"] = new string('t', 201),
            ["contactEmail"] = "nope",
            ["overtimeRatePerHour"] = -1m,
            ["maxBasicHoursPerDay"] = 0m,
            ["shiftDescription"] = "",
            ["preparedByLabel"] = "",
            ["approvedByLabel"] = "",
        };

        var response = await api.SendAsync(HttpMethod.Put, Route, body, await AdminTokenAsync());

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var errors = await ErrorsOf(response);
        Assert.Equal(AllFields, KeysOf(errors));
        foreach (var property in errors.EnumerateObject())
        {
            Assert.Equal(JsonValueKind.Array, property.Value.ValueKind);
            Assert.False(string.IsNullOrWhiteSpace(property.Value[0].GetString()));
        }
    }

    [Fact]
    public async Task Put_WithAnEmptyObject_ReportsEveryRequiredField_ButNotTheTagline()
    {
        await ResetAsync();

        var response = await api.SendJsonAsync(HttpMethod.Put, Route, "{}", await AdminTokenAsync());

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(
            ["approvedByLabel", "companyName", "contactEmail", "maxBasicHoursPerDay", "overtimeRatePerHour", "preparedByLabel", "shiftDescription"],
            KeysOf(await ErrorsOf(response)));
    }

    [Fact]
    public async Task Put_WithANumberGivenAsText_IsABadRequest_AndChangesNothing()
    {
        await ResetAsync();

        var response = await api.SendJsonAsync(
            HttpMethod.Put, Route, RawBody("overtimeRatePerHour", "\"abc\""), await AdminTokenAsync());

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(2.22m, (await StoredAsync()).OvertimeRatePerHour);
    }

    // --- audit ---------------------------------------------------------------------------------------------

    [Fact]
    public async Task Put_OfOneField_WritesOneSettingsChangedRow_WithOnlyThatFieldAsOldAndNew()
    {
        await ResetAsync();
        var admin = await TestWorkers.SignInAsync(api, Roles.Administrator);
        var body = new Dictionary<string, object?>
        {
            ["companyName"] = "DE AKS BE GLASS & ALUMINIUM CO. L.L.C S.O.C",
            ["tagline"] = "Glass & Aluminum Installation & Maintenance Services",
            ["contactEmail"] = "hr@dxbaluminium.ae",
            ["overtimeRatePerHour"] = 2.5m,
            ["maxBasicHoursPerDay"] = 8m,
            ["shiftDescription"] = "06:00 AM - 05:30 PM",
            ["preparedByLabel"] = "HR Department",
            ["approvedByLabel"] = "General Manager",
        };

        var response = await api.SendAsync(HttpMethod.Put, Route, body, admin.Token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var row = Assert.Single(await AuditRowsAsync());
        Assert.Equal(admin.Username, row.ActorUsername);
        Assert.Equal("PayrollSettings", row.EntityType);
        Assert.Equal("1", row.EntityId);
        var details = JsonDocument.Parse(row.DetailsJson!).RootElement;
        Assert.Equal(["overtimeRatePerHour"], KeysOf(details));
        var change = details.GetProperty("overtimeRatePerHour");
        Assert.Equal(["new", "old"], KeysOf(change));
        Assert.Equal(2.22m, change.GetProperty("old").GetDecimal());
        Assert.Equal(2.5m, change.GetProperty("new").GetDecimal());
    }

    [Fact]
    public async Task Put_OfEveryField_RecordsEveryFieldWithItsOldAndNewValue()
    {
        await ResetAsync();

        await api.SendAsync(HttpMethod.Put, Route, ValidBody(), await AdminTokenAsync());

        var row = Assert.Single(await AuditRowsAsync());
        var details = JsonDocument.Parse(row.DetailsJson!).RootElement;
        Assert.Equal(AllFields, KeysOf(details));
        Assert.Equal("DE AKS BE GLASS & ALUMINIUM CO. L.L.C S.O.C", details.GetProperty("companyName").GetProperty("old").GetString());
        Assert.Equal("Acme Glass LLC", details.GetProperty("companyName").GetProperty("new").GetString());
        Assert.Equal("hr@dxbaluminium.ae", details.GetProperty("contactEmail").GetProperty("old").GetString());
        Assert.Equal("payroll@acme.example", details.GetProperty("contactEmail").GetProperty("new").GetString());
        Assert.Equal(8m, details.GetProperty("maxBasicHoursPerDay").GetProperty("old").GetDecimal());
        Assert.Equal(9m, details.GetProperty("maxBasicHoursPerDay").GetProperty("new").GetDecimal());
        Assert.Equal("General Manager", details.GetProperty("approvedByLabel").GetProperty("old").GetString());
        Assert.Equal("Managing Director", details.GetProperty("approvedByLabel").GetProperty("new").GetString());
    }

    [Fact]
    public async Task Put_ThatChangesNothing_IsOk_AndWritesNoAuditRow()
    {
        await ResetAsync();
        var token = await AdminTokenAsync();
        await api.SendAsync(HttpMethod.Put, Route, ValidBody(), token);
        Assert.Single(await AuditRowsAsync());

        // Same values, with surrounding whitespace and a different decimal scale: still no change.
        var again = ValidBody();
        again["companyName"] = "  Acme Glass LLC ";
        again["overtimeRatePerHour"] = 2.50m;
        again["maxBasicHoursPerDay"] = 9.00m;
        var response = await api.SendAsync(HttpMethod.Put, Route, again, token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        AssertSavedValues(await TestWorkers.ReadJsonAsync(response));
        Assert.Single(await AuditRowsAsync());
    }

    [Fact]
    public async Task Put_OfTheSeededValues_WritesNoAuditRow()
    {
        await ResetAsync();
        var body = new Dictionary<string, object?>
        {
            ["companyName"] = "DE AKS BE GLASS & ALUMINIUM CO. L.L.C S.O.C",
            ["tagline"] = "Glass & Aluminum Installation & Maintenance Services",
            ["contactEmail"] = "hr@dxbaluminium.ae",
            ["overtimeRatePerHour"] = 2.22m,
            ["maxBasicHoursPerDay"] = 8m,
            ["shiftDescription"] = "06:00 AM - 05:30 PM",
            ["preparedByLabel"] = "HR Department",
            ["approvedByLabel"] = "General Manager",
        };

        var response = await api.SendAsync(HttpMethod.Put, Route, body, await AdminTokenAsync());

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Empty(await AuditRowsAsync());
    }

    [Fact]
    public async Task EachChange_WritesItsOwnRow_RecordingTheValuesBeforeThatChange()
    {
        await ResetAsync();
        var token = await AdminTokenAsync();

        await api.SendAsync(HttpMethod.Put, Route, With("overtimeRatePerHour", 3m), token);
        await api.SendAsync(HttpMethod.Put, Route, With("overtimeRatePerHour", 4m), token);

        var rows = (await AuditRowsAsync()).OrderBy(r => r.Id).ToList();
        Assert.Equal(2, rows.Count);
        var second = JsonDocument.Parse(rows[1].DetailsJson!).RootElement.GetProperty("overtimeRatePerHour");
        Assert.Equal(3m, second.GetProperty("old").GetDecimal());
        Assert.Equal(4m, second.GetProperty("new").GetDecimal());
    }

    // --- GET stays as it was --------------------------------------------------------------------------------

    [Fact]
    public async Task Get_AfterAReset_ShowsTheSeededDefaults()
    {
        await ResetAsync();
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Manager);

        var response = await api.GetAsync(Route, token);

        var json = await TestWorkers.ReadJsonAsync(response);
        Assert.Equal(AllFields, KeysOf(json));
        Assert.Equal(2.22m, json.GetProperty("overtimeRatePerHour").GetDecimal());
        Assert.Equal(8m, json.GetProperty("maxBasicHoursPerDay").GetDecimal());
        Assert.Equal("06:00 AM - 05:30 PM", json.GetProperty("shiftDescription").GetString());
    }

    [Fact]
    public async Task Put_DoesNotLeakAnythingBeyondTheEightDocumentedFields()
    {
        await ResetAsync();
        var body = ValidBody();
        body["id"] = 7;
        body["extra"] = "ignored";

        var response = await api.SendAsync(HttpMethod.Put, Route, body, await AdminTokenAsync());

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(AllFields, KeysOf(await TestWorkers.ReadJsonAsync(response)));
        Assert.Equal(1, (await StoredAsync()).Id);
    }
}
