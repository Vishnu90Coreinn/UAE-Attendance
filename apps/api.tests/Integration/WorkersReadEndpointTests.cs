using System.Net;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>
/// W2 reads: list, get and next-code. These depend on exactly which workers exist, so the table is emptied before
/// every test (tests in one class run one after another, and this class has its own database).
/// </summary>
public class WorkersReadEndpointTests(ApiFixture api) : IClassFixture<ApiFixture>, IAsyncLifetime
{
    public Task InitializeAsync() => TestWorkers.DeleteAllAsync(api.ConnectionString);

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<string> ManagerTokenAsync() => (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;

    private async Task<string[]> ListCodesAsync(string query = "")
    {
        var response = await api.GetAsync($"/api/workers{query}", await ManagerTokenAsync());
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var json = await TestWorkers.ReadJsonAsync(response);
        return json.EnumerateArray().Select(w => w.GetProperty("workerCode").GetString()!).ToArray();
    }

    // --- list ----------------------------------------------------------------------------------------------

    [Fact]
    public async Task List_WithNoWorkers_IsAnEmptyArray()
    {
        var response = await api.GetAsync("/api/workers", await ManagerTokenAsync());

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(JsonValueKind.Array, (await TestWorkers.ReadJsonAsync(response)).ValueKind);
        Assert.Empty(await ListCodesAsync());
    }

    [Fact]
    public async Task List_ReturnsOnlyActiveWorkers_ByDefault()
    {
        await TestWorkers.CreateAsync(api.ConnectionString, "active1", isActive: true);
        await TestWorkers.CreateAsync(api.ConnectionString, "gone1", isActive: false);

        Assert.Equal(["active1"], await ListCodesAsync());
        Assert.Equal(["active1"], await ListCodesAsync("?includeInactive=false"));
    }

    [Fact]
    public async Task List_WithIncludeInactive_ReturnsEveryWorker()
    {
        await TestWorkers.CreateAsync(api.ConnectionString, "active1", isActive: true);
        await TestWorkers.CreateAsync(api.ConnectionString, "gone1", isActive: false);

        Assert.Equal(["active1", "gone1"], await ListCodesAsync("?includeInactive=true"));
    }

    [Fact]
    public async Task List_IsOrderedByWorkerCode_IgnoringCase()
    {
        foreach (var code in new[] { "charlie", "Bravo", "alpha", "Delta" })
        {
            await TestWorkers.CreateAsync(api.ConnectionString, code);
        }

        Assert.Equal(["alpha", "Bravo", "charlie", "Delta"], await ListCodesAsync());
    }

    [Fact]
    public async Task List_ReturnsTheDocumentedWorkerShape_WithTheRateAsANumber()
    {
        var worker = await TestWorkers.CreateAsync(
            api.ConnectionString, "shape1", "Mohammed Ali", "Aluminum Fabricator", 12.5m);

        var response = await api.GetAsync("/api/workers", await ManagerTokenAsync());
        var item = (await TestWorkers.ReadJsonAsync(response))[0];

        Assert.Equal(
            new[] { "designation", "effectiveOvertimeRate", "fullName", "hourlyRate", "id", "isActive", "overtimeRate", "workerCode" },
            item.EnumerateObject().Select(p => p.Name).Order().ToArray());
        Assert.Equal(worker.Id, item.GetProperty("id").GetInt32());
        Assert.Equal("shape1", item.GetProperty("workerCode").GetString());
        Assert.Equal("Mohammed Ali", item.GetProperty("fullName").GetString());
        Assert.Equal("Aluminum Fabricator", item.GetProperty("designation").GetString());
        Assert.Equal(JsonValueKind.Number, item.GetProperty("hourlyRate").ValueKind);
        Assert.Equal(12.5m, item.GetProperty("hourlyRate").GetDecimal());
        Assert.True(item.GetProperty("isActive").GetBoolean());
    }

    // --- get -----------------------------------------------------------------------------------------------

    [Fact]
    public async Task Get_ReturnsTheWorker_IncludingAnInactiveOne()
    {
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, "inactive1", isActive: false, hourlyRate: 9.99m);

        var response = await api.GetAsync($"/api/workers/{worker.Id}", await ManagerTokenAsync());

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var json = await TestWorkers.ReadJsonAsync(response);
        Assert.Equal(worker.Id, json.GetProperty("id").GetInt32());
        Assert.Equal("inactive1", json.GetProperty("workerCode").GetString());
        Assert.False(json.GetProperty("isActive").GetBoolean());
        Assert.Equal(9.99m, json.GetProperty("hourlyRate").GetDecimal());
    }

    [Fact]
    public async Task Get_WithAnUnknownId_IsNotFound()
    {
        var response = await api.GetAsync("/api/workers/987654", await ManagerTokenAsync());

        await TestWorkers.AssertWorkerNotFoundAsync(response);
    }

    // --- next code -----------------------------------------------------------------------------------------

    private async Task<string> NextCodeAsync()
    {
        var response = await api.GetAsync("/api/workers/next-code", await ManagerTokenAsync());
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var json = await TestWorkers.ReadJsonAsync(response);
        Assert.Equal(["workerCode"], json.EnumerateObject().Select(p => p.Name).ToArray());
        return json.GetProperty("workerCode").GetString()!;
    }

    [Theory]
    [InlineData(new string[0], "EMP-001")]
    [InlineData(new[] { "EMP-001" }, "EMP-002")]
    [InlineData(new[] { "EMP-001", "EMP-002", "EMP-003", "EMP-004" }, "EMP-005")]
    [InlineData(new[] { "EMP-001", "EMP-007" }, "EMP-008")] // gaps: the highest wins, gaps are not refilled
    [InlineData(new[] { "EMP-0099" }, "EMP-100")] // wider zero padding than three digits
    [InlineData(new[] { "EMP-099" }, "EMP-100")]
    [InlineData(new[] { "EMP-999" }, "EMP-1000")] // past three digits
    [InlineData(new[] { "EMP-1" }, "EMP-002")] // unpadded suffix
    [InlineData(new[] { "ABC-100", "X9", "W5", "EMP-004" }, "EMP-005")] // other prefixes are ignored
    [InlineData(new[] { "ABC-100", "X9" }, "EMP-001")]
    [InlineData(new[] { "emp-020" }, "EMP-021")] // the code is case-insensitive
    [InlineData(new[] { "EMP-12A", "EMP-", "XEMP-500", "EMP-5-6", "EMP-_7" }, "EMP-001")] // not EMP- plus digits only
    [InlineData(new[] { "EMP-002", "EMP-010", "EMP-3" }, "EMP-011")] // numeric, not alphabetical, maximum
    public async Task NextCode_IsOnePastTheHighestEmpNumber(string[] existing, string expected)
    {
        foreach (var code in existing)
        {
            await TestWorkers.CreateAsync(api.ConnectionString, code);
        }

        var next = await NextCodeAsync();

        Assert.Equal(expected, next);
        Assert.DoesNotContain(existing, code => string.Equals(code, next, StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task NextCode_CountsInactiveWorkers()
    {
        await TestWorkers.CreateAsync(api.ConnectionString, "EMP-001");
        await TestWorkers.CreateAsync(api.ConnectionString, "EMP-009", isActive: false);

        Assert.Equal("EMP-010", await NextCodeAsync());
    }

    [Fact]
    public async Task NextCode_CreatesNothing_AndIsStableUntilAWorkerIsAdded()
    {
        await TestWorkers.CreateAsync(api.ConnectionString, "EMP-004");

        Assert.Equal("EMP-005", await NextCodeAsync());
        Assert.Equal("EMP-005", await NextCodeAsync());
        await using var db = TestUsers.NewContext(api.ConnectionString);
        Assert.Equal(1, await db.Workers.CountAsync());

        await TestWorkers.CreateAsync(api.ConnectionString, "EMP-005");

        Assert.Equal("EMP-006", await NextCodeAsync());
    }

    [Fact]
    public async Task NextCode_IsNotTreatedAsAWorkerId()
    {
        // "next-code" must be its own route, not an id lookup that fails to parse.
        var response = await api.GetAsync("/api/workers/next-code", await ManagerTokenAsync());

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
