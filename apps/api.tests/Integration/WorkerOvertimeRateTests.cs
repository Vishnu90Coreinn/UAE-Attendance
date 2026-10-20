using System.Net;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>S2b: the optional per-worker overtime rate, the effective overtime rate and its audit trail.</summary>
public class WorkerOvertimeRateTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private const decimal SeededCompanyRate = 2.22m;

    // --- helpers -------------------------------------------------------------------------------------------

    /// <summary>A worker body. <paramref name="overtimeRate"/> is left out entirely when it is the <see cref="Omit"/> marker.</summary>
    private static Dictionary<string, object?> Body(string code, object? overtimeRate, decimal hourlyRate = 12.5m, string name = "Mohammed Ali")
    {
        var body = new Dictionary<string, object?>
        {
            ["workerCode"] = code,
            ["fullName"] = name,
            ["designation"] = "Glass Installer",
            ["hourlyRate"] = hourlyRate,
        };
        if (!ReferenceEquals(overtimeRate, Omit))
        {
            body["overtimeRate"] = overtimeRate;
        }

        return body;
    }

    private static readonly object Omit = new();

    private static string RawBody(string code, string overtimeLiteral) =>
        $"{{\"workerCode\":{JsonSerializer.Serialize(code)},\"fullName\":\"N\",\"designation\":\"D\",\"hourlyRate\":12.5,\"overtimeRate\":{overtimeLiteral}}}";

    private async Task<(string Username, string Token)> HrAsync() => await TestWorkers.SignInAsync(api, Roles.HrStaff);

    private async Task SetCompanyRateAsync(decimal rate)
    {
        await using var db = TestUsers.NewContext(api.ConnectionString);
        await db.PayrollSettings.ExecuteUpdateAsync(s => s.SetProperty(p => p.OvertimeRatePerHour, rate));
    }

    private static string[] KeysOf(JsonElement element) => element.EnumerateObject().Select(p => p.Name).Order().ToArray();

    private static async Task<JsonElement> ErrorsOf(HttpResponseMessage response)
    {
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        return (await TestWorkers.ReadJsonAsync(response)).GetProperty("errors");
    }

    private async Task<List<AuditLog>> AuditRowsAsync(string action, int workerId)
    {
        await using var db = TestUsers.NewContext(api.ConnectionString);
        return await db.AuditLogs.AsNoTracking()
            .Where(a => a.Action == action && a.EntityType == "Worker" && a.EntityId == workerId.ToString())
            .ToListAsync();
    }

    private async Task<int> AuditCountAsync(int workerId)
    {
        await using var db = TestUsers.NewContext(api.ConnectionString);
        return await db.AuditLogs.CountAsync(a => a.EntityType == "Worker" && a.EntityId == workerId.ToString());
    }

    private static void AssertRates(JsonElement worker, decimal? own, decimal effective)
    {
        if (own is null)
        {
            Assert.Equal(JsonValueKind.Null, worker.GetProperty("overtimeRate").ValueKind);
        }
        else
        {
            Assert.Equal(JsonValueKind.Number, worker.GetProperty("overtimeRate").ValueKind);
            Assert.Equal(own.Value, worker.GetProperty("overtimeRate").GetDecimal());
        }

        Assert.Equal(JsonValueKind.Number, worker.GetProperty("effectiveOvertimeRate").ValueKind);
        Assert.Equal(effective, worker.GetProperty("effectiveOvertimeRate").GetDecimal());
    }

    // --- create --------------------------------------------------------------------------------------------

    [Fact]
    public async Task Create_WithoutAnOvertimeRate_UsesTheCompanyRate()
    {
        await SetCompanyRateAsync(SeededCompanyRate);
        var (_, token) = await HrAsync();

        var response = await api.SendAsync(HttpMethod.Post, "/api/workers", Body(TestWorkers.UniqueCode(), Omit), token);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var json = await TestWorkers.ReadJsonAsync(response);
        Assert.Equal(
            new[] { "designation", "effectiveOvertimeRate", "fullName", "hourlyRate", "id", "isActive", "overtimeRate", "workerCode" },
            KeysOf(json));
        AssertRates(json, own: null, effective: SeededCompanyRate);
        Assert.Null(await TestWorkers.ReadOvertimeRateAsync(api.ConnectionString, json.GetProperty("id").GetInt32()));
    }

    [Fact]
    public async Task Create_WithANullOvertimeRate_UsesTheCompanyRate()
    {
        await SetCompanyRateAsync(SeededCompanyRate);
        var (_, token) = await HrAsync();

        var response = await api.SendAsync(HttpMethod.Post, "/api/workers", Body(TestWorkers.UniqueCode(), null), token);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        AssertRates(await TestWorkers.ReadJsonAsync(response), own: null, effective: SeededCompanyRate);
    }

    [Fact]
    public async Task Create_WithAnOvertimeRate_StoresItAndReturnsItAsTheEffectiveRate()
    {
        await SetCompanyRateAsync(SeededCompanyRate);
        var (_, token) = await HrAsync();

        var response = await api.SendAsync(HttpMethod.Post, "/api/workers", Body(TestWorkers.UniqueCode(), 3.5m), token);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var json = await TestWorkers.ReadJsonAsync(response);
        AssertRates(json, own: 3.5m, effective: 3.5m);
        var id = json.GetProperty("id").GetInt32();
        Assert.Equal(3.5m, await TestWorkers.ReadOvertimeRateAsync(api.ConnectionString, id));

        var fetched = await api.GetAsync(response.Headers.Location!.ToString(), token);
        AssertRates(await TestWorkers.ReadJsonAsync(fetched), own: 3.5m, effective: 3.5m);
    }

    [Fact]
    public async Task Create_WithAnOvertimeRateOfZero_MeansNoOvertimePay_NotTheCompanyRate()
    {
        await SetCompanyRateAsync(SeededCompanyRate);
        var (_, token) = await HrAsync();

        var response = await api.SendAsync(HttpMethod.Post, "/api/workers", Body(TestWorkers.UniqueCode(), 0m), token);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var json = await TestWorkers.ReadJsonAsync(response);
        AssertRates(json, own: 0m, effective: 0m);
        Assert.Equal(0m, await TestWorkers.ReadOvertimeRateAsync(api.ConnectionString, json.GetProperty("id").GetInt32()));
    }

    [Theory]
    [InlineData("0.01")]
    [InlineData("2.5")]
    [InlineData("999.99")]
    [InlineData("3.00")]
    public async Task Create_AcceptsOvertimeRatesInRange(string literal)
    {
        var (_, token) = await HrAsync();

        var response = await api.SendJsonAsync(HttpMethod.Post, "/api/workers", RawBody(TestWorkers.UniqueCode(), literal), token);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal(
            decimal.Parse(literal, System.Globalization.CultureInfo.InvariantCulture),
            (await TestWorkers.ReadJsonAsync(response)).GetProperty("overtimeRate").GetDecimal());
    }

    [Theory]
    [InlineData("-1")]
    [InlineData("-0.01")]
    [InlineData("1000")]
    [InlineData("1000.00")]
    [InlineData("999.991")]
    [InlineData("2.225")]
    [InlineData("0.001")]
    [InlineData("99999999999")]
    public async Task Create_WithAnInvalidOvertimeRate_IsABadRequestNamingOnlyOvertimeRate(string literal)
    {
        var (_, token) = await HrAsync();
        var code = TestWorkers.UniqueCode();

        var response = await api.SendJsonAsync(HttpMethod.Post, "/api/workers", RawBody(code, literal), token);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var errors = await ErrorsOf(response);
        Assert.Equal(["overtimeRate"], KeysOf(errors));
        Assert.False(string.IsNullOrWhiteSpace(errors.GetProperty("overtimeRate")[0].GetString()));
        await using var db = TestUsers.NewContext(api.ConnectionString);
        Assert.False(await db.Workers.AnyAsync(w => w.WorkerCode == code));
    }

    [Fact]
    public async Task Create_WithTheOvertimeRateAsText_IsABadRequest()
    {
        var (_, token) = await HrAsync();

        var response = await api.SendJsonAsync(HttpMethod.Post, "/api/workers", RawBody(TestWorkers.UniqueCode(), "\"abc\""), token);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Create_WithAnInvalidOvertimeRateAndAnInvalidName_ReportsBothFields()
    {
        var (_, token) = await HrAsync();

        var response = await api.SendAsync(HttpMethod.Post, "/api/workers", Body(TestWorkers.UniqueCode(), -1m, name: ""), token);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(["fullName", "overtimeRate"], KeysOf(await ErrorsOf(response)));
    }

    [Fact]
    public async Task Create_WithAnOvertimeRate_WritesItInTheWorkerCreatedAuditDetails()
    {
        var (username, token) = await HrAsync();

        var response = await api.SendAsync(HttpMethod.Post, "/api/workers", Body(TestWorkers.UniqueCode(), 3.5m), token);

        var id = (await TestWorkers.ReadJsonAsync(response)).GetProperty("id").GetInt32();
        var row = Assert.Single(await AuditRowsAsync("WorkerCreated", id));
        Assert.Equal(username, row.ActorUsername);
        var details = JsonDocument.Parse(row.DetailsJson!).RootElement;
        Assert.Equal(["overtimeRate"], KeysOf(details));
        var change = details.GetProperty("overtimeRate");
        Assert.Equal(["new", "old"], KeysOf(change));
        Assert.Equal(JsonValueKind.Null, change.GetProperty("old").ValueKind);
        Assert.Equal(3.5m, change.GetProperty("new").GetDecimal());
    }

    [Fact]
    public async Task Create_WithoutAnOvertimeRate_WritesWorkerCreatedWithoutOvertimeDetails()
    {
        var (_, token) = await HrAsync();

        var response = await api.SendAsync(HttpMethod.Post, "/api/workers", Body(TestWorkers.UniqueCode(), Omit), token);

        var id = (await TestWorkers.ReadJsonAsync(response)).GetProperty("id").GetInt32();
        var row = Assert.Single(await AuditRowsAsync("WorkerCreated", id));
        Assert.Null(row.DetailsJson);
    }

    // --- update --------------------------------------------------------------------------------------------

    [Fact]
    public async Task Update_SetsAChangesAndClearsTheOvertimeRate()
    {
        await SetCompanyRateAsync(SeededCompanyRate);
        var (_, token) = await HrAsync();
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        string Url() => $"/api/workers/{worker.Id}";

        var set = await api.SendAsync(HttpMethod.Put, Url(), Body(worker.WorkerCode, 3m), token);
        AssertRates(await TestWorkers.ReadJsonAsync(set), own: 3m, effective: 3m);
        Assert.Equal(3m, await TestWorkers.ReadOvertimeRateAsync(api.ConnectionString, worker.Id));

        var changed = await api.SendAsync(HttpMethod.Put, Url(), Body(worker.WorkerCode, 4.25m), token);
        AssertRates(await TestWorkers.ReadJsonAsync(changed), own: 4.25m, effective: 4.25m);

        var zero = await api.SendAsync(HttpMethod.Put, Url(), Body(worker.WorkerCode, 0m), token);
        AssertRates(await TestWorkers.ReadJsonAsync(zero), own: 0m, effective: 0m);

        var cleared = await api.SendAsync(HttpMethod.Put, Url(), Body(worker.WorkerCode, null), token);
        Assert.Equal(HttpStatusCode.OK, cleared.StatusCode);
        AssertRates(await TestWorkers.ReadJsonAsync(cleared), own: null, effective: SeededCompanyRate);
        Assert.Null(await TestWorkers.ReadOvertimeRateAsync(api.ConnectionString, worker.Id));
    }

    [Fact]
    public async Task Update_WithTheOvertimeRateOmitted_ClearsTheOverride()
    {
        await SetCompanyRateAsync(SeededCompanyRate);
        var (_, token) = await HrAsync();
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, overtimeRate: 5m);

        var response = await api.SendAsync(HttpMethod.Put, $"/api/workers/{worker.Id}", Body(worker.WorkerCode, Omit), token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        AssertRates(await TestWorkers.ReadJsonAsync(response), own: null, effective: SeededCompanyRate);
        Assert.Null(await TestWorkers.ReadOvertimeRateAsync(api.ConnectionString, worker.Id));
    }

    [Theory]
    [InlineData("-0.01")]
    [InlineData("1000")]
    [InlineData("1.005")]
    public async Task Update_WithAnInvalidOvertimeRate_IsABadRequest_AndChangesNothing(string literal)
    {
        var (_, token) = await HrAsync();
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, overtimeRate: 6m);

        var response = await api.SendJsonAsync(HttpMethod.Put, $"/api/workers/{worker.Id}", RawBody(worker.WorkerCode, literal), token);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(["overtimeRate"], KeysOf(await ErrorsOf(response)));
        Assert.Equal(6m, await TestWorkers.ReadOvertimeRateAsync(api.ConnectionString, worker.Id));
        Assert.Equal(0, await AuditCountAsync(worker.Id));
    }

    [Fact]
    public async Task Update_OfTheOvertimeRateOnly_WritesOneAuditRowWithTheOldAndNewRateAndNothingElse()
    {
        var (username, token) = await HrAsync();
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, overtimeRate: 2m);

        await api.SendAsync(HttpMethod.Put, $"/api/workers/{worker.Id}",
            Body(worker.WorkerCode, 3.75m, worker.HourlyRate, worker.FullName), token);

        var row = Assert.Single(await AuditRowsAsync("WorkerUpdated", worker.Id));
        Assert.Equal(username, row.ActorUsername);
        var details = JsonDocument.Parse(row.DetailsJson!).RootElement;
        Assert.Equal(["overtimeRate"], KeysOf(details));
        var change = details.GetProperty("overtimeRate");
        Assert.Equal(["new", "old"], KeysOf(change));
        Assert.Equal(2m, change.GetProperty("old").GetDecimal());
        Assert.Equal(3.75m, change.GetProperty("new").GetDecimal());
    }

    [Fact]
    public async Task Update_FromNoOverrideToOne_RecordsOldAsNull()
    {
        var (_, token) = await HrAsync();
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);

        await api.SendAsync(HttpMethod.Put, $"/api/workers/{worker.Id}",
            Body(worker.WorkerCode, 3m, worker.HourlyRate, worker.FullName), token);

        var row = Assert.Single(await AuditRowsAsync("WorkerUpdated", worker.Id));
        var change = JsonDocument.Parse(row.DetailsJson!).RootElement.GetProperty("overtimeRate");
        Assert.Equal(JsonValueKind.Null, change.GetProperty("old").ValueKind);
        Assert.Equal(3m, change.GetProperty("new").GetDecimal());
    }

    [Fact]
    public async Task Update_FromAnOverrideBackToTheCompanyRate_RecordsNewAsNull()
    {
        var (_, token) = await HrAsync();
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, overtimeRate: 3m);

        await api.SendAsync(HttpMethod.Put, $"/api/workers/{worker.Id}",
            Body(worker.WorkerCode, null, worker.HourlyRate, worker.FullName), token);

        var row = Assert.Single(await AuditRowsAsync("WorkerUpdated", worker.Id));
        var change = JsonDocument.Parse(row.DetailsJson!).RootElement.GetProperty("overtimeRate");
        Assert.Equal(3m, change.GetProperty("old").GetDecimal());
        Assert.Equal(JsonValueKind.Null, change.GetProperty("new").ValueKind);
    }

    [Fact]
    public async Task Update_AlongsideTheHourlyRate_RecordsBothRates()
    {
        var (_, token) = await HrAsync();
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, hourlyRate: 10m, overtimeRate: 2m);

        await api.SendAsync(HttpMethod.Put, $"/api/workers/{worker.Id}",
            Body(worker.WorkerCode, 2.5m, 11m, worker.FullName), token);

        var row = Assert.Single(await AuditRowsAsync("WorkerUpdated", worker.Id));
        var details = JsonDocument.Parse(row.DetailsJson!).RootElement;
        Assert.Equal(["hourlyRate", "overtimeRate"], KeysOf(details));
        Assert.Equal(10m, details.GetProperty("hourlyRate").GetProperty("old").GetDecimal());
        Assert.Equal(11m, details.GetProperty("hourlyRate").GetProperty("new").GetDecimal());
        Assert.Equal(2m, details.GetProperty("overtimeRate").GetProperty("old").GetDecimal());
        Assert.Equal(2.5m, details.GetProperty("overtimeRate").GetProperty("new").GetDecimal());
    }

    [Fact]
    public async Task Update_WithTheSameOvertimeRate_IsNotAChange_AndWritesNoAuditRow()
    {
        var (_, token) = await HrAsync();
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, overtimeRate: 3m);

        var response = await api.SendJsonAsync(HttpMethod.Put, $"/api/workers/{worker.Id}",
            $"{{\"workerCode\":\"{worker.WorkerCode}\",\"fullName\":\"{worker.FullName}\",\"designation\":\"{worker.Designation}\",\"hourlyRate\":12.50,\"overtimeRate\":3.00}}",
            token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(0, await AuditCountAsync(worker.Id));
        var stored = await TestWorkers.FindAsync(api.ConnectionString, worker.Id);
        Assert.Equal(worker.UpdatedUtc, stored!.UpdatedUtc, TimeSpan.FromMilliseconds(1));
    }

    [Fact]
    public async Task Update_WithOnlyANewOvertimeRate_BumpsUpdatedUtc()
    {
        var (_, token) = await HrAsync();
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);

        await api.SendAsync(HttpMethod.Put, $"/api/workers/{worker.Id}",
            Body(worker.WorkerCode, 3m, worker.HourlyRate, worker.FullName), token);

        var stored = await TestWorkers.FindAsync(api.ConnectionString, worker.Id);
        Assert.True(stored!.UpdatedUtc > worker.UpdatedUtc);
    }

    // --- the effective rate follows the company rate -------------------------------------------------------

    [Fact]
    public async Task EffectiveRate_FollowsALaterChangeOfTheCompanyRate_ButAnOverrideDoesNot()
    {
        await SetCompanyRateAsync(SeededCompanyRate);
        var admin = await TestWorkers.SignInAsync(api, Roles.Administrator);
        var inherits = await TestWorkers.CreateAsync(api.ConnectionString);
        var overridden = await TestWorkers.CreateAsync(api.ConnectionString, overtimeRate: 4m);
        var zero = await TestWorkers.CreateAsync(api.ConnectionString, overtimeRate: 0m);

        var update = await api.SendAsync(HttpMethod.Put, "/api/settings/payroll", new
        {
            companyName = "Co",
            tagline = "",
            contactEmail = "a@b.c",
            overtimeRatePerHour = 2.5m,
            maxBasicHoursPerDay = 8m,
            shiftDescription = "Shift",
            preparedByLabel = "P",
            approvedByLabel = "A",
        }, admin.Token);
        Assert.Equal(HttpStatusCode.OK, update.StatusCode);

        var get = await api.GetAsync($"/api/workers/{inherits.Id}", admin.Token);
        AssertRates(await TestWorkers.ReadJsonAsync(get), own: null, effective: 2.5m);
        var getOverridden = await api.GetAsync($"/api/workers/{overridden.Id}", admin.Token);
        AssertRates(await TestWorkers.ReadJsonAsync(getOverridden), own: 4m, effective: 4m);
        var getZero = await api.GetAsync($"/api/workers/{zero.Id}", admin.Token);
        AssertRates(await TestWorkers.ReadJsonAsync(getZero), own: 0m, effective: 0m);

        var list = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/workers?includeInactive=true", admin.Token));
        var inheritsRow = list.EnumerateArray().Single(w => w.GetProperty("id").GetInt32() == inherits.Id);
        AssertRates(inheritsRow, own: null, effective: 2.5m);
        var overriddenRow = list.EnumerateArray().Single(w => w.GetProperty("id").GetInt32() == overridden.Id);
        AssertRates(overriddenRow, own: 4m, effective: 4m);
    }

    [Fact]
    public async Task Create_ReturnsTheEffectiveRateFromTheCurrentCompanyRate()
    {
        await SetCompanyRateAsync(7.77m);
        var (_, token) = await HrAsync();

        var response = await api.SendAsync(HttpMethod.Post, "/api/workers", Body(TestWorkers.UniqueCode(), Omit), token);

        AssertRates(await TestWorkers.ReadJsonAsync(response), own: null, effective: 7.77m);
        await SetCompanyRateAsync(SeededCompanyRate);
    }

    [Fact]
    public async Task ListGetAndStatusChanges_AllCarryBothNewFields()
    {
        await SetCompanyRateAsync(SeededCompanyRate);
        var (_, token) = await HrAsync();
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, overtimeRate: 3.3m);

        var list = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/workers", token));
        AssertRates(list.EnumerateArray().Single(w => w.GetProperty("id").GetInt32() == worker.Id), 3.3m, 3.3m);

        var get = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/workers/{worker.Id}", token));
        AssertRates(get, 3.3m, 3.3m);

        var deactivated = await api.SendAsync(HttpMethod.Post, $"/api/workers/{worker.Id}/deactivate", null, token);
        AssertRates(await TestWorkers.ReadJsonAsync(deactivated), 3.3m, 3.3m);
        var activated = await api.SendAsync(HttpMethod.Post, $"/api/workers/{worker.Id}/activate", null, token);
        AssertRates(await TestWorkers.ReadJsonAsync(activated), 3.3m, 3.3m);
    }

    [Fact]
    public async Task AnExistingWorkerWithoutAnOverride_ListsWithANullOvertimeRate()
    {
        await SetCompanyRateAsync(SeededCompanyRate);
        var (_, token) = await HrAsync();
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);

        var get = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/workers/{worker.Id}", token));

        AssertRates(get, own: null, effective: SeededCompanyRate);
    }
}
