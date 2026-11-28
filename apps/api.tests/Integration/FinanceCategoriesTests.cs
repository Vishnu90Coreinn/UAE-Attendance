using System.Net;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>Expense and income categories: the starting lists, adding, renaming and switching off.</summary>
public class FinanceCategoriesTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private async Task<string> ManagerAsync() => (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;

    private static string UniqueName() => "Cat " + Guid.NewGuid().ToString("N")[..12];

    private async Task<JsonElement> ListAsync(string token, string query = "")
    {
        var response = await api.GetAsync("/api/finance/categories" + query, token);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await TestWorkers.ReadJsonAsync(response);
    }

    [Fact]
    public async Task StartingLists_AreSeeded_NineExpenseCategoriesAndOneIncomeCategory()
    {
        var token = await ManagerAsync();

        var expense = (await ListAsync(token, "?kind=Expense")).EnumerateArray().Select(c => c.GetProperty("name").GetString()).ToList();
        var income = (await ListAsync(token, "?kind=Income")).EnumerateArray().Select(c => c.GetProperty("name").GetString()).ToList();

        Assert.Contains("Company expenses", expense);
        Assert.Contains("Government-related procedures for workers", expense);
        Assert.Contains("Salary Advance", expense);
        Assert.Contains("Other income", income);
        Assert.DoesNotContain("Other income", expense);
    }

    [Fact]
    public async Task Create_AddsACategory_AndAuditsIt()
    {
        var token = await ManagerAsync();
        var name = UniqueName();

        var response = await api.PostAsync("/api/finance/categories", new { kind = "Expense", name = "  " + name + "  " }, token);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await TestWorkers.ReadJsonAsync(response);
        Assert.Equal(name, body.GetProperty("name").GetString());     // trimmed
        Assert.Equal("Expense", body.GetProperty("kind").GetString());
        Assert.True(body.GetProperty("isActive").GetBoolean());
        Assert.Single(await TestFinance.AuditAsync(api.ConnectionString, "FinCategoryCreated", body.GetProperty("id").GetInt32().ToString()));
    }

    [Theory]
    [InlineData("", "Expense", "name")]
    [InlineData("   ", "Income", "name")]
    [InlineData("Valid name", "Asset", "kind")]
    [InlineData("Valid name", null, "kind")]
    public async Task Create_RejectsBadInput(string name, string? kind, string field)
    {
        var token = await ManagerAsync();

        var response = await api.PostAsync("/api/finance/categories", new { kind, name }, token);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.True((await TestWorkers.ReadJsonAsync(response)).GetProperty("errors").TryGetProperty(field, out _));
    }

    [Fact]
    public async Task Create_RejectsTooLongNames()
    {
        var response = await api.PostAsync("/api/finance/categories", new { kind = "Expense", name = new string('x', 81) }, await ManagerAsync());
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Create_RejectsADuplicateInTheSameKind_ButAllowsTheSameNameInTheOtherKind()
    {
        var token = await ManagerAsync();
        var name = UniqueName();
        Assert.Equal(HttpStatusCode.Created, (await api.PostAsync("/api/finance/categories", new { kind = "Expense", name }, token)).StatusCode);

        var duplicate = await api.PostAsync("/api/finance/categories", new { kind = "Expense", name = name.ToUpperInvariant() }, token);
        var otherKind = await api.PostAsync("/api/finance/categories", new { kind = "Income", name }, token);

        Assert.Equal(HttpStatusCode.BadRequest, duplicate.StatusCode);
        Assert.True((await TestWorkers.ReadJsonAsync(duplicate)).GetProperty("errors").TryGetProperty("name", out _));
        Assert.Equal(HttpStatusCode.Created, otherKind.StatusCode);
    }

    [Fact]
    public async Task Update_RenamesAndSwitchesOff_ButTheKindNeverChanges()
    {
        var token = await ManagerAsync();
        var created = await TestWorkers.ReadJsonAsync(await api.PostAsync("/api/finance/categories", new { kind = "Expense", name = UniqueName() }, token));
        var id = created.GetProperty("id").GetInt32();
        var renamed = UniqueName();

        var response = await api.SendAsync(HttpMethod.Put, $"/api/finance/categories/{id}", new { kind = "Income", name = renamed, isActive = false }, token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await TestWorkers.ReadJsonAsync(response);
        Assert.Equal(renamed, body.GetProperty("name").GetString());
        Assert.False(body.GetProperty("isActive").GetBoolean());
        Assert.Equal("Expense", body.GetProperty("kind").GetString());
        Assert.Single(await TestFinance.AuditAsync(api.ConnectionString, "FinCategoryUpdated", id.ToString()));
    }

    [Fact]
    public async Task SwitchedOffCategories_AreHiddenFromTheDefaultList_ButShownWhenAsked()
    {
        var token = await ManagerAsync();
        var created = await TestWorkers.ReadJsonAsync(await api.PostAsync("/api/finance/categories", new { kind = "Expense", name = UniqueName() }, token));
        var id = created.GetProperty("id").GetInt32();
        await api.SendAsync(HttpMethod.Put, $"/api/finance/categories/{id}", new { name = created.GetProperty("name").GetString(), isActive = false }, token);

        var normal = await ListAsync(token, "?kind=Expense");
        var all = await ListAsync(token, "?kind=Expense&includeInactive=true");

        Assert.DoesNotContain(normal.EnumerateArray(), c => c.GetProperty("id").GetInt32() == id);
        Assert.Contains(all.EnumerateArray(), c => c.GetProperty("id").GetInt32() == id);
    }

    [Fact]
    public async Task List_ShowsHowManyEntriesUseEachCategory()
    {
        var token = await ManagerAsync();
        var account = await TestFinance.AddAccountAsync(api.ConnectionString);
        var created = await TestWorkers.ReadJsonAsync(await api.PostAsync("/api/finance/categories", new { kind = "Expense", name = UniqueName() }, token));
        var id = created.GetProperty("id").GetInt32();
        await TestFinance.AddEntryAsync(api.ConnectionString, account.Id, FinEntryKinds.Expense, 5m, categoryId: id);
        await TestFinance.AddEntryAsync(api.ConnectionString, account.Id, FinEntryKinds.Expense, 6m, categoryId: id);

        var list = await ListAsync(token, "?kind=Expense&includeInactive=true");

        Assert.Equal(2, list.EnumerateArray().Single(c => c.GetProperty("id").GetInt32() == id).GetProperty("useCount").GetInt32());
    }

    [Fact]
    public async Task Update_UnknownCategory_IsNotFound()
    {
        var response = await api.SendAsync(HttpMethod.Put, "/api/finance/categories/999999", new { name = "x" }, await ManagerAsync());
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
