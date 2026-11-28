using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ClosedXML.Excel;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>Profit &amp; Loss and the Balance Sheet from the ledger, checked against the finance report and the account balances.</summary>
public class FinanceStatementsTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private static readonly SemaphoreSlim Gate = new(1, 1);
    private static readonly Dictionary<string, int> Seeded = [];

    private async Task<string> TokenAsync(string role = Roles.Manager) => (await TestWorkers.SignInAsync(api, role)).Token;

    private async Task<(HttpStatusCode Status, JsonElement Body)> GetAsync(string url, string? token = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token ?? await TokenAsync());
        var response = await api.Client.SendAsync(request);
        var text = await response.Content.ReadAsStringAsync();
        return (response.StatusCode, string.IsNullOrWhiteSpace(text) ? default : JsonDocument.Parse(text).RootElement);
    }

    /// <summary>March 2009 in a company whose account opened with 10,000 and whose partner had put that in: every figure here is this class's alone.</summary>
    private async Task<int> SeedAsync()
    {
        await Gate.WaitAsync();
        try
        {
            if (Seeded.TryGetValue(api.ConnectionString, out var existing)) return existing;
            var account = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 10_000m, openingDate: new DateOnly(2008, 12, 1));
            var partner = await TestFinance.AddPartnerAsync(api.ConnectionString, opening: 10_000m);
            var c = api.ConnectionString;
            await TestFinance.AddEntryAsync(c, account.Id, "Income", 30_000m, new DateOnly(2009, 3, 15), categoryId: 10);
            await TestFinance.AddEntryAsync(c, account.Id, "Expense", 12_000m, new DateOnly(2009, 3, 2), categoryId: 5);
            await TestFinance.AddEntryAsync(c, account.Id, "Expense", 600m, new DateOnly(2009, 3, 31), categoryId: 8);   // the last day of the period counts
            await TestFinance.AddEntryAsync(c, account.Id, "Expense", 400m, new DateOnly(2009, 3, 9), "Voided", categoryId: 1);
            await TestFinance.AddEntryAsync(c, account.Id, "Expense", 250m, new DateOnly(2009, 4, 2), categoryId: 1);   // outside March
            await TestFinance.AddCapitalAsync(c, account.Id, partner.Id, 20_000m, new DateOnly(2009, 3, 1));
            await TestFinance.AddCapitalAsync(c, account.Id, partner.Id, 2_000m, new DateOnly(2009, 3, 31), "CapitalOut");
            using var sync = new HttpRequestMessage(HttpMethod.Post, "/api/finance/ledger/sync");
            sync.Headers.Authorization = new AuthenticationHeaderValue("Bearer", await TokenAsync());
            (await api.Client.SendAsync(sync)).EnsureSuccessStatusCode();
            Seeded[api.ConnectionString] = account.Id;
            return account.Id;
        }
        finally
        {
            Gate.Release();
        }
    }

    [Fact]
    public async Task ProfitAndLoss_ForAMonth_CountsOnlyThatMonthsActiveEntries_AndAgreesWithTheFinanceReport()
    {
        await SeedAsync();

        var pl = (await GetAsync("/api/finance/ledger/profit-and-loss?from=2009-03-01&to=2009-03-31")).Body;
        var report = (await GetAsync("/api/finance/reports/summary?from=2009-03-01&to=2009-03-31")).Body;

        Assert.Equal(30_000m, pl.GetProperty("totalRevenue").GetDecimal());
        Assert.Equal(12_600m, pl.GetProperty("totalExpenses").GetDecimal());   // the voided 400 and April's 250 are not here
        Assert.Equal(17_400m, pl.GetProperty("netProfit").GetDecimal());
        Assert.Equal(report.GetProperty("period").GetProperty("net").GetDecimal(), pl.GetProperty("netProfit").GetDecimal());   // the books and the finance report agree
        Assert.Equal(report.GetProperty("period").GetProperty("expense").GetDecimal(), pl.GetProperty("totalExpenses").GetDecimal());
        var expenses = pl.GetProperty("expenses").EnumerateArray().ToDictionary(l => l.GetProperty("name").GetString()!, l => l.GetProperty("amount").GetDecimal());
        Assert.Equal(12_000m, expenses["Worker accommodation rent"]);
        Assert.Equal(600m, expenses["Insurance"]);
        Assert.Equal(0, pl.GetProperty("manualJournals").GetInt32());
        Assert.Equal(pl.GetProperty("totalExpenses").GetDecimal(), pl.GetProperty("expenses").EnumerateArray().Sum(l => l.GetProperty("amount").GetDecimal()));
    }

    [Fact]
    public async Task ProfitAndLoss_ForTheWholeYear_AddsAprilToo()
    {
        await SeedAsync();
        var pl = (await GetAsync("/api/finance/ledger/profit-and-loss?from=2009-01-01&to=2009-12-31")).Body;
        Assert.Equal(12_850m, pl.GetProperty("totalExpenses").GetDecimal());
        Assert.Equal(17_150m, pl.GetProperty("netProfit").GetDecimal());
    }

    [Fact]
    public async Task BalanceSheet_Balances_AgreesWithTheAccountBalance_AndShowsTheProfitRetained()
    {
        var accountId = await SeedAsync();

        var sheet = (await GetAsync("/api/finance/ledger/balance-sheet?asOf=2009-12-31")).Body;

        Assert.True(sheet.GetProperty("balanced").GetBoolean());
        Assert.Equal(45_150m, sheet.GetProperty("totalAssets").GetDecimal());   // 10,000 + 30,000 - 12,850 + 20,000 - 2,000
        Assert.Equal(17_150m, sheet.GetProperty("retainedProfit").GetDecimal());
        Assert.Equal(45_150m, sheet.GetProperty("totalEquity").GetDecimal());   // the partner's 28,000 plus the retained profit
        Assert.Equal(sheet.GetProperty("totalAssets").GetDecimal(), sheet.GetProperty("totalLiabilitiesAndEquity").GetDecimal());
        var accounts = (await GetAsync("/api/finance/accounts?includeInactive=true")).Body.EnumerateArray();
        Assert.Equal(sheet.GetProperty("totalAssets").GetDecimal(), accounts.Single(a => a.GetProperty("id").GetInt32() == accountId).GetProperty("balance").GetDecimal());
        var partnerLine = sheet.GetProperty("equity").EnumerateArray().Single(l => l.GetProperty("name").GetString()!.StartsWith("Capital:"));
        Assert.Equal(28_000m, partnerLine.GetProperty("amount").GetDecimal());
    }

    [Fact]
    public async Task BalanceSheet_AtAnEarlierDate_ShowsOnlyWhatExistedThen()
    {
        await SeedAsync();
        var sheet = (await GetAsync("/api/finance/ledger/balance-sheet?asOf=2009-02-28")).Body;
        Assert.True(sheet.GetProperty("balanced").GetBoolean());
        Assert.Equal(10_000m, sheet.GetProperty("totalAssets").GetDecimal());
        Assert.Equal(0m, sheet.GetProperty("retainedProfit").GetDecimal());
    }

    [Fact]
    public async Task Statements_RefuseBadDates_AndFollowTheAccessRules()
    {
        Assert.Equal(HttpStatusCode.BadRequest, (await GetAsync("/api/finance/ledger/profit-and-loss?from=nonsense")).Status);
        Assert.Equal(HttpStatusCode.BadRequest, (await GetAsync("/api/finance/ledger/profit-and-loss?from=2009-04-01&to=2009-03-01")).Status);
        Assert.Equal(HttpStatusCode.OK, (await GetAsync("/api/finance/ledger/balance-sheet", await TokenAsync(Roles.Viewer))).Status);   // the Partner reads the statements
        Assert.Equal(HttpStatusCode.Forbidden, (await GetAsync("/api/finance/ledger/profit-and-loss", await TokenAsync(Roles.HR))).Status);
        Assert.Equal(HttpStatusCode.Forbidden, (await GetAsync("/api/finance/ledger/balance-sheet", await TokenAsync(Roles.Supervisor))).Status);
    }

    [Fact]
    public async Task Downloads_CarryTheSameFigures()
    {
        await SeedAsync();
        var token = await TokenAsync();
        async Task<byte[]> Get(string url)
        {
            var request = new HttpRequestMessage(HttpMethod.Get, url);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            var response = await api.Client.SendAsync(request);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            return await response.Content.ReadAsByteArrayAsync();
        }

        using (var book = new XLWorkbook(new MemoryStream(await Get("/api/finance/ledger/profit-and-loss?from=2009-03-01&to=2009-03-31&format=xlsx"))))
        {
            var net = book.Worksheet("Profit and loss").RowsUsed().Single(r => r.Cell(2).GetString() == "Net profit");
            Assert.Equal(17_400m, (decimal)net.Cell(3).GetDouble());
        }

        var csv = System.Text.Encoding.UTF8.GetString(await Get("/api/finance/ledger/balance-sheet?asOf=2009-12-31&format=csv"));
        Assert.Contains("Total assets,45150.00", csv);
        Assert.Contains("Total liabilities and equity,45150.00", csv);
        Assert.Equal(new byte[] { 0x25, 0x50, 0x44, 0x46 }, (await Get("/api/finance/ledger/balance-sheet?asOf=2009-12-31&format=pdf"))[..4]);
        using var sheet = new XLWorkbook(new MemoryStream(await Get("/api/finance/ledger/balance-sheet?asOf=2009-12-31&format=xlsx")));
        Assert.NotNull(sheet.Worksheet("Balance sheet"));
    }
}

/// <summary>A journal posted by hand moves the statements and still leaves the sheet balanced.</summary>
public class FinanceStatementsManualTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    [Fact]
    public async Task ManualJournal_ChangesTheProfitAndLoss_IsCountedAndTheSheetStillBalances()
    {
        var token = (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;
        var account = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 5_000m, openingDate: new DateOnly(2007, 1, 1));
        await TestFinance.AddEntryAsync(api.ConnectionString, account.Id, "Income", 1_000m, new DateOnly(2007, 6, 10), categoryId: 10);

        async Task<(HttpStatusCode Status, JsonElement Body)> Send(HttpMethod method, string url, object? body = null)
        {
            var request = new HttpRequestMessage(method, url) { Content = body is null ? null : JsonContent.Create(body) };
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            var response = await api.Client.SendAsync(request);
            var text = await response.Content.ReadAsStringAsync();
            return (response.StatusCode, string.IsNullOrWhiteSpace(text) ? default : JsonDocument.Parse(text).RootElement);
        }

        await Send(HttpMethod.Post, "/api/finance/ledger/sync");
        var chart = (await Send(HttpMethod.Get, "/api/finance/ledger/accounts")).Body.EnumerateArray().ToList();
        var asset = chart.Single(a => a.GetProperty("name").GetString() == account.Name).GetProperty("id").GetInt32();
        var made = await Send(HttpMethod.Post, "/api/finance/ledger/accounts", new { code = "5801", name = "Depreciation 2007", type = "Expense" });
        var expense = made.Body.GetProperty("id").GetInt32();

        var before = (await Send(HttpMethod.Get, "/api/finance/ledger/profit-and-loss?from=2007-06-01&to=2007-06-30")).Body;
        Assert.Equal(1_000m, before.GetProperty("netProfit").GetDecimal());

        var posted = await Send(HttpMethod.Post, "/api/finance/ledger/journals", new
        {
            date = "2007-06-30", description = "Depreciation",
            lines = new object[] { new { accountId = expense, debit = 100m }, new { accountId = asset, credit = 100m } },
        });
        Assert.Equal(HttpStatusCode.Created, posted.Status);

        var after = (await Send(HttpMethod.Get, "/api/finance/ledger/profit-and-loss?from=2007-06-01&to=2007-06-30")).Body;
        Assert.Equal(900m, after.GetProperty("netProfit").GetDecimal());          // the adjustment lowers the profit
        Assert.Equal(1, after.GetProperty("manualJournals").GetInt32());           // and the statement says it includes one journal posted by hand
        var sheet = (await Send(HttpMethod.Get, "/api/finance/ledger/balance-sheet?asOf=2007-12-31")).Body;
        Assert.True(sheet.GetProperty("balanced").GetBoolean());
        Assert.Equal(5_900m, sheet.GetProperty("totalAssets").GetDecimal());       // 5,000 + 1,000 - 100
    }
}
