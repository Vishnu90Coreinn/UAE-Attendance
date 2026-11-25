using System.Net.Http.Headers;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>The books start from a short standard chart, and the client's own categories post to named accounts in it from the first day.</summary>
public class FinanceStandardChartTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private async Task<JsonElement> GetAsync(string url, string token)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var response = await api.Client.SendAsync(request);
        response.EnsureSuccessStatusCode();
        return JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
    }

    [Fact]
    public async Task EachStartingCategory_PostsToItsStandardAccount_AndCapitalCategoriesGetNone()
    {
        var token = (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;
        var mappings = await GetAsync("/api/finance/ledger/mappings", token);
        var chart = (await GetAsync("/api/finance/ledger/accounts", token)).EnumerateArray().ToList();
        string CodeOf(int id) => chart.Single(a => a.GetProperty("id").GetInt32() == id).GetProperty("code").GetString()!;
        string PostsTo(string category) => CodeOf(mappings.EnumerateArray().Single(m => m.GetProperty("kind").GetString() == "Category" && m.GetProperty("name").GetString() == category).GetProperty("ledgerAccountId").GetInt32());

        Assert.Equal("5100", PostsTo("Monthly Salary"));
        Assert.Equal("5110", PostsTo("Salary Advance"));
        Assert.Equal("5200", PostsTo("Worker Accommodation Rent"));
        Assert.Equal("5210", PostsTo("Worker Transportation"));
        Assert.Equal("5220", PostsTo("Office Rent"));
        Assert.Equal("5300", PostsTo("Government-related procedures for workers"));
        Assert.Equal("5310", PostsTo("Dubai Insurance"));
        Assert.Equal("5320", PostsTo("Commission for Labor"));
        Assert.Equal("5400", PostsTo("Company expenses"));
        Assert.Equal("4100", PostsTo("Other income"));

        // The accounts the accountant needs for things with no screen are there from the start, under their own types.
        foreach (var (code, type) in new[] { ("1700", "Asset"), ("1750", "Asset"), ("1800", "Asset"), ("1850", "Asset"), ("2400", "Liability"), ("2450", "Liability"), ("2500", "Liability"), ("5500", "Expense"), ("5600", "Expense"), ("5700", "Expense") })
            Assert.Equal(type, chart.Single(a => a.GetProperty("code").GetString() == code).GetProperty("type").GetString());

        // Capital is posted through the partner, so the two capital categories make no empty expense accounts.
        Assert.DoesNotContain(chart, a => a.GetProperty("name").GetString() is "Capital contribution" or "Capital returned");
        Assert.DoesNotContain(mappings.EnumerateArray(), m => m.GetProperty("name").GetString() is "Capital contribution" or "Capital returned");
    }
}
