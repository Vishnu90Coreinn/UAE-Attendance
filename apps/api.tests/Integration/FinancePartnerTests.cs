using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>Partners and their capital: what each put in and took back, the shares, and how capital moves an account without touching income or expense.</summary>
public class FinancePartnerTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private static string D(DateOnly d) => d.ToString("yyyy-MM-dd");
    private async Task<string> ManagerAsync() => (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;

    private async Task<JsonElement> PartnersAsync(string? token = null)
    {
        var response = await api.GetAsync("/api/finance/partners", token ?? await ManagerAsync());
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static JsonElement Row(JsonElement partners, int id) => partners.GetProperty("partners").EnumerateArray().Single(p => p.GetProperty("id").GetInt32() == id);

    private async Task<HttpResponseMessage> PostCapitalAsync(string path, int? partnerId, int accountId, decimal amount, DateOnly? date = null, string token = "")
    {
        var form = new MultipartFormDataContent
        {
            { new StringContent(D(date ?? TestFinance.Today)), "entryDate" },
            { new StringContent(accountId.ToString()), "accountId" },
            { new StringContent(amount.ToString(System.Globalization.CultureInfo.InvariantCulture)), "amount" },
        };
        if (partnerId is { } id) form.Add(new StringContent(id.ToString()), "partnerId");
        var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = form };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token.Length > 0 ? token : await ManagerAsync());
        return await api.Client.SendAsync(request);
    }

    private async Task<decimal> BalanceAsync(int accountId)
    {
        var accounts = await (await api.GetAsync("/api/finance/accounts", await ManagerAsync())).Content.ReadFromJsonAsync<JsonElement>();
        return accounts.EnumerateArray().Single(a => a.GetProperty("id").GetInt32() == accountId).GetProperty("balance").GetDecimal();
    }

    [Fact]
    public async Task Partners_CanBeAddedAndRenamed_WithAnOpeningCapital_AndNamesStayUnique()
    {
        var token = await ManagerAsync();
        var name = TestFinance.Unique("Partner");
        var created = await api.SendAsync(HttpMethod.Post, "/api/finance/partners", new { name, openingCapital = 25000m }, token);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var partner = await created.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(25000m, partner.GetProperty("netCapital").GetDecimal());
        var id = partner.GetProperty("id").GetInt32();

        Assert.Equal(HttpStatusCode.BadRequest, (await api.SendAsync(HttpMethod.Post, "/api/finance/partners", new { name = name.ToUpperInvariant() }, token)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await api.SendAsync(HttpMethod.Post, "/api/finance/partners", new { name = TestFinance.Unique("P"), openingCapital = -1m }, token)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await api.SendAsync(HttpMethod.Post, "/api/finance/partners", new { name = "" }, token)).StatusCode);

        var renamed = await api.SendAsync(HttpMethod.Put, $"/api/finance/partners/{id}", new { name = name + " Jr", openingCapital = 30000m, isActive = true }, token);
        Assert.Equal(HttpStatusCode.OK, renamed.StatusCode);
        Assert.Equal(30000m, Row(await PartnersAsync(token), id).GetProperty("netCapital").GetDecimal());
        Assert.NotEmpty(await TestFinance.AuditAsync(api.ConnectionString, "FinPartnerCreated", id.ToString()));
    }

    [Fact]
    public async Task Capital_RaisesTheAccountBalance_NeedsAnActivePartner_AndNeedsNoReceipt()
    {
        var account = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 100m);
        var partner = await TestFinance.AddPartnerAsync(api.ConnectionString);
        var off = await TestFinance.AddPartnerAsync(api.ConnectionString, isActive: false);

        var response = await PostCapitalAsync("/api/finance/capital/contributions", partner.Id, account.Id, 5000m);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var entry = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.StartsWith("CAP-", entry.GetProperty("entryNo").GetString());
        Assert.Equal(partner.Name, entry.GetProperty("party").GetString());
        Assert.Equal(partner.Id, entry.GetProperty("partnerId").GetInt32());
        Assert.Equal(5100m, await BalanceAsync(account.Id));

        Assert.Equal(HttpStatusCode.BadRequest, (await PostCapitalAsync("/api/finance/capital/contributions", null, account.Id, 10m)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await PostCapitalAsync("/api/finance/capital/contributions", off.Id, account.Id, 10m)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await PostCapitalAsync("/api/finance/capital/contributions", partner.Id, account.Id, 0m)).StatusCode);
    }

    [Fact]
    public async Task CapitalReturned_LowersTheBalanceAndThePartnersNetCapital_ButIsNotAnExpense()
    {
        var account = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 0m);
        var partner = await TestFinance.AddPartnerAsync(api.ConnectionString, opening: 1000m);
        await PostCapitalAsync("/api/finance/capital/contributions", partner.Id, account.Id, 4000m);
        var response = await PostCapitalAsync("/api/finance/capital/returns", partner.Id, account.Id, 1500.50m);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.StartsWith("RTN-", (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("entryNo").GetString());

        Assert.Equal(2499.50m, await BalanceAsync(account.Id));
        var row = Row(await PartnersAsync(), partner.Id);
        Assert.Equal(1000m, row.GetProperty("openingCapital").GetDecimal());
        Assert.Equal(4000m, row.GetProperty("added").GetDecimal());
        Assert.Equal(1500.50m, row.GetProperty("returned").GetDecimal());
        Assert.Equal(3499.50m, row.GetProperty("netCapital").GetDecimal());
    }

    [Fact]
    public async Task Shares_AreExactPercentagesOfEveryonesCapital_AddingUpToOneHundred()
    {
        var account = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 0m);
        var a = await TestFinance.AddPartnerAsync(api.ConnectionString, opening: 60000m);
        var b = await TestFinance.AddPartnerAsync(api.ConnectionString, opening: 25000m);
        var c = await TestFinance.AddPartnerAsync(api.ConnectionString);
        await TestFinance.AddCapitalAsync(api.ConnectionString, account.Id, c.Id, 15000m);
        await TestFinance.AddCapitalAsync(api.ConnectionString, account.Id, c.Id, 7000m, status: FinStatuses.Voided);

        var partners = await PartnersAsync();
        var total = partners.GetProperty("totalCapital").GetDecimal();
        var rows = partners.GetProperty("partners").EnumerateArray().ToList();
        Assert.Equal(100.00m, rows.Sum(p => p.GetProperty("share").GetDecimal()));
        foreach (var partner in new[] { a, b, c })
        {
            var row = Row(partners, partner.Id);
            var expected = Math.Round(row.GetProperty("netCapital").GetDecimal() / total * 100m, 2);
            Assert.InRange(Math.Abs(row.GetProperty("share").GetDecimal() - expected), 0m, 0.01m);
        }

        Assert.Equal(15000m, Row(partners, c.Id).GetProperty("netCapital").GetDecimal());   // the voided 7,000 counts nowhere
    }

    [Fact]
    public async Task Capital_IsNotIncomeOrExpense_OnTheDashboard()
    {
        var account = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 0m);
        var partner = await TestFinance.AddPartnerAsync(api.ConnectionString);
        var token = await ManagerAsync();
        async Task<JsonElement> Dash() => await (await api.GetAsync("/api/finance/dashboard?days=30", token)).Content.ReadFromJsonAsync<JsonElement>();
        var before = await Dash();
        await TestFinance.AddCapitalAsync(api.ConnectionString, account.Id, partner.Id, 9000m, TestFinance.Today);
        await TestFinance.AddCapitalAsync(api.ConnectionString, account.Id, partner.Id, 400m, TestFinance.Today, FinEntryKinds.CapitalOut);
        var after = await Dash();

        Assert.Equal(before.GetProperty("current").GetProperty("income").GetDecimal(), after.GetProperty("current").GetProperty("income").GetDecimal());
        Assert.Equal(before.GetProperty("current").GetProperty("expense").GetDecimal(), after.GetProperty("current").GetProperty("expense").GetDecimal());
        Assert.Equal(before.GetProperty("totalBalance").GetDecimal() + 8600m, after.GetProperty("totalBalance").GetDecimal());
        // The latest list does show the capital, labelled by its kind, so the change in the balance can be explained.
        Assert.Contains(after.GetProperty("latest").EnumerateArray(), e => e.GetProperty("kind").GetString() == "Capital" && e.GetProperty("amount").GetDecimal() == 9000m);
        Assert.Contains(after.GetProperty("latest").EnumerateArray(), e => e.GetProperty("kind").GetString() == "CapitalOut");
        Assert.True(after.GetProperty("capital").GetProperty("total").GetDecimal() >= 0m);
    }

    [Fact]
    public async Task Void_RemovesTheCapital_AndCorrectReplacesIt_WithTheSameRules()
    {
        var account = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 0m);
        var partner = await TestFinance.AddPartnerAsync(api.ConnectionString);
        var token = await ManagerAsync();
        var created = await (await PostCapitalAsync("/api/finance/capital/contributions", partner.Id, account.Id, 1000m)).Content.ReadFromJsonAsync<JsonElement>();
        var id = created.GetProperty("id").GetInt32();

        var form = new MultipartFormDataContent
        {
            { new StringContent(D(TestFinance.Today)), "entryDate" }, { new StringContent(account.Id.ToString()), "accountId" },
            { new StringContent("1200"), "amount" }, { new StringContent(partner.Id.ToString()), "partnerId" },
        };
        var put = new HttpRequestMessage(HttpMethod.Put, $"/api/finance/capital/{id}") { Content = form };
        put.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var corrected = await api.Client.SendAsync(put);
        Assert.Equal(HttpStatusCode.Created, corrected.StatusCode);
        var replacement = await corrected.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1200m, await BalanceAsync(account.Id));
        Assert.Equal(created.GetProperty("entryNo").GetString(), replacement.GetProperty("replacesEntryNo").GetString());

        var voided = await api.SendAsync(HttpMethod.Post, $"/api/finance/capital/{replacement.GetProperty("id").GetInt32()}/void", new { reason = "Entered twice" }, token);
        Assert.Equal(HttpStatusCode.OK, voided.StatusCode);
        Assert.Equal(0m, await BalanceAsync(account.Id));
        Assert.Equal(0m, Row(await PartnersAsync(token), partner.Id).GetProperty("netCapital").GetDecimal());

        // An expense id is not a capital entry.
        var expense = await TestFinance.AddEntryAsync(api.ConnectionString, account.Id, FinEntryKinds.Expense, 5m);
        Assert.Equal(HttpStatusCode.NotFound, (await api.SendAsync(HttpMethod.Post, $"/api/finance/capital/{expense.Id}/void", new { reason = "x" }, token)).StatusCode);
    }

    [Fact]
    public async Task CapitalList_ShowsBothKinds_NewestFirst_WithTheNetTotal_AndFiltersByPartner()
    {
        var account = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 0m);
        var partner = await TestFinance.AddPartnerAsync(api.ConnectionString);
        var other = await TestFinance.AddPartnerAsync(api.ConnectionString);
        await TestFinance.AddCapitalAsync(api.ConnectionString, account.Id, partner.Id, 3000m, TestFinance.Today.AddDays(-3));
        await TestFinance.AddCapitalAsync(api.ConnectionString, account.Id, partner.Id, 500m, TestFinance.Today.AddDays(-1), FinEntryKinds.CapitalOut);
        await TestFinance.AddCapitalAsync(api.ConnectionString, account.Id, other.Id, 99m);

        var list = await (await api.GetAsync($"/api/finance/capital?partnerId={partner.Id}", await ManagerAsync())).Content.ReadFromJsonAsync<JsonElement>();
        var kinds = list.GetProperty("items").EnumerateArray().Select(e => e.GetProperty("kind").GetString()).ToList();
        Assert.Equal(["CapitalOut", "Capital"], kinds);
        Assert.Equal(2500m, list.GetProperty("total").GetDecimal());
    }

    [Fact]
    public async Task CapitalCategories_AreNeverOfferedInSettings_OrOnTheEntryForms()
    {
        var all = await (await api.GetAsync("/api/finance/categories?includeInactive=true", await ManagerAsync())).Content.ReadFromJsonAsync<JsonElement>();
        Assert.DoesNotContain(all.EnumerateArray(), c => c.GetProperty("kind").GetString() is "Capital" or "CapitalOut");
        Assert.Equal(HttpStatusCode.BadRequest, (await api.SendAsync(HttpMethod.Post, "/api/finance/categories", new { kind = "Capital", name = "Sneaky" }, await ManagerAsync())).StatusCode);
    }

    [Fact]
    public async Task Report_ShowsCapitalPerAccountAndPerPartner_AndClosingStillAddsUp()
    {
        var account = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 1000m);
        var partner = await TestFinance.AddPartnerAsync(api.ConnectionString, opening: 2000m);
        var today = TestFinance.Today;
        await TestFinance.AddCapitalAsync(api.ConnectionString, account.Id, partner.Id, 500m, today.AddDays(-40));
        await TestFinance.AddCapitalAsync(api.ConnectionString, account.Id, partner.Id, 300m, today.AddDays(-5));
        await TestFinance.AddCapitalAsync(api.ConnectionString, account.Id, partner.Id, 100m, today.AddDays(-4), FinEntryKinds.CapitalOut);

        var report = await (await api.GetAsync($"/api/finance/reports/summary?from={D(today.AddDays(-20))}&to={D(today)}", await ManagerAsync())).Content.ReadFromJsonAsync<JsonElement>();
        var line = report.GetProperty("accounts").EnumerateArray().Single(x => x.GetProperty("accountId").GetInt32() == account.Id);
        Assert.Equal(1500m, line.GetProperty("opening").GetDecimal());
        Assert.Equal(200m, line.GetProperty("capital").GetDecimal());
        Assert.Equal(1700m, line.GetProperty("closing").GetDecimal());
        Assert.Equal(0m, line.GetProperty("income").GetDecimal());

        var p = report.GetProperty("partners").EnumerateArray().Single(x => x.GetProperty("partnerId").GetInt32() == partner.Id);
        Assert.Equal(2500m, p.GetProperty("opening").GetDecimal());
        Assert.Equal(300m, p.GetProperty("added").GetDecimal());
        Assert.Equal(100m, p.GetProperty("returned").GetDecimal());
        Assert.Equal(2700m, p.GetProperty("closing").GetDecimal());

        var csv = await (await api.GetAsync($"/api/finance/reports/summary?from={D(today.AddDays(-20))}&format=csv", await ManagerAsync())).Content.ReadAsStringAsync();
        Assert.Contains($"{partner.Name},2500.00,300.00,100.00,2700.00,", csv);
    }

    [Fact]
    public async Task Partner_Role_CanSeeEveryPartnersFigures_ButChangeNothing()
    {
        var partner = await TestFinance.AddPartnerAsync(api.ConnectionString, opening: 500m);
        var viewer = (await TestWorkers.SignInAsync(api, Roles.Viewer)).Token;
        Assert.Equal(500m, Row(await PartnersAsync(viewer), partner.Id).GetProperty("netCapital").GetDecimal());
        Assert.Equal(HttpStatusCode.Forbidden, (await api.SendAsync(HttpMethod.Post, "/api/finance/partners", new { name = "X" }, viewer)).StatusCode);
    }
}
