using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>The top bar finds a record by its number, a name, or an exact amount, for finance roles only.</summary>
public class FinanceSearchTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private async Task<(HttpStatusCode Status, List<JsonElement> Hits)> SearchAsync(string token, string q)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, "/api/finance/search?q=" + Uri.EscapeDataString(q));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var response = await api.Client.SendAsync(request);
        if (response.StatusCode != HttpStatusCode.OK) return (response.StatusCode, []);
        return (response.StatusCode, JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.GetProperty("hits").EnumerateArray().ToList());
    }

    [Fact]
    public async Task FindsAnEntryByNameNumberOrAmount_AndSaysWhatItIs()
    {
        var token = (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;
        var account = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 50_000m);
        var entry = await TestFinance.AddEntryAsync(api.ConnectionString, account.Id, "Expense", 12_345.50m, categoryId: 1, party: "Zanzibar Glass Traders");

        foreach (var q in new[] { "zanzibar", entry.EntryNo, "12,345.50", "12345.5" })
        {
            var (_, hits) = await SearchAsync(token, q);
            var hit = Assert.Single(hits, h => h.GetProperty("id").GetInt32() == entry.Id && h.GetProperty("type").GetString() == "Expense");
            Assert.Equal(entry.EntryNo, hit.GetProperty("number").GetString());
            Assert.Equal(12_345.50m, hit.GetProperty("amount").GetDecimal());
        }
    }

    [Fact]
    public async Task ANameTypedWithoutItsSpaces_IsStillFound()
    {
        var token = (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;
        var account = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 50_000m);
        var entry = await TestFinance.AddEntryAsync(api.ConnectionString, account.Id, "Expense", 10m, categoryId: 1, party: "Q Z X Luxuries");

        Assert.Contains((await SearchAsync(token, "qzx")).Hits, h => h.GetProperty("id").GetInt32() == entry.Id);
        Assert.Contains((await SearchAsync(token, "z x lux")).Hits, h => h.GetProperty("id").GetInt32() == entry.Id);
    }

    [Fact]
    public async Task ATooShortSearch_FindsNothing_AndOtherRolesAreRefused()
    {
        var manager = (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;
        Assert.Empty((await SearchAsync(manager, "a")).Hits);
        Assert.Empty((await SearchAsync(manager, "   ")).Hits);
        var supervisor = (await TestWorkers.SignInAsync(api, Roles.Supervisor)).Token;
        Assert.Equal(HttpStatusCode.Forbidden, (await SearchAsync(supervisor, "glass")).Status);
    }
}
