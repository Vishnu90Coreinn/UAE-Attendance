using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>The period report and its three downloads. The database is shared, so checks look at the accounts created here.</summary>
public class FinanceReportTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private static string D(DateOnly d) => d.ToString("yyyy-MM-dd");
    private async Task<HttpResponseMessage> GetAsync(string query, string role = Roles.Manager)
    {
        var token = (await TestWorkers.SignInAsync(api, role)).Token;
        return await api.SendAsync(HttpMethod.Get, "/api/finance/reports/summary" + query, null, token);
    }

    private async Task<(FinAccount A, FinAccount B)> SeedAsync()
    {
        var a = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 1000m);
        var b = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 0m);
        var today = TestFinance.Today;
        await TestFinance.AddEntryAsync(api.ConnectionString, a.Id, FinEntryKinds.Income, 500m, today.AddDays(-40));
        await TestFinance.AddEntryAsync(api.ConnectionString, a.Id, FinEntryKinds.Expense, 200m, today.AddDays(-10));
        await TestFinance.AddEntryAsync(api.ConnectionString, a.Id, FinEntryKinds.Income, 300m, today.AddDays(-5));
        await TestFinance.AddEntryAsync(api.ConnectionString, a.Id, FinEntryKinds.Expense, 999m, today.AddDays(-4), FinStatuses.Voided);
        await TestFinance.AddTransferAsync(api.ConnectionString, a.Id, b.Id, 100m, today.AddDays(-3));
        return (a, b);
    }

    private static JsonElement Line(JsonElement report, int accountId) =>
        report.GetProperty("accounts").EnumerateArray().Single(x => x.GetProperty("accountId").GetInt32() == accountId);

    [Fact]
    public async Task Statement_ShowsOpeningMovementsAndClosing_ForEachAccount_IgnoringVoidedRows()
    {
        var (a, b) = await SeedAsync();
        var today = TestFinance.Today;
        var response = await GetAsync($"?from={D(today.AddDays(-20))}&to={D(today)}");
        response.EnsureSuccessStatusCode();
        var report = await response.Content.ReadFromJsonAsync<JsonElement>();

        var la = Line(report, a.Id);
        Assert.Equal(1500m, la.GetProperty("opening").GetDecimal());   // 1000 + the 500 earned before the period
        Assert.Equal(300m, la.GetProperty("income").GetDecimal());
        Assert.Equal(200m, la.GetProperty("expense").GetDecimal());
        Assert.Equal(100m, la.GetProperty("transfersOut").GetDecimal());
        Assert.Equal(1500m, la.GetProperty("closing").GetDecimal());
        var lb = Line(report, b.Id);
        Assert.Equal(0m, lb.GetProperty("opening").GetDecimal());
        Assert.Equal(100m, lb.GetProperty("transfersIn").GetDecimal());
        Assert.Equal(100m, lb.GetProperty("closing").GetDecimal());
    }

    [Fact]
    public async Task Closing_AtToday_EqualsTheAccountBalance_AndTotalsAddUp()
    {
        var (a, _) = await SeedAsync();
        var report = await (await GetAsync($"?from={D(TestFinance.Today.AddDays(-30))}")).Content.ReadFromJsonAsync<JsonElement>();
        var token = (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;
        var accounts = await (await api.SendAsync(HttpMethod.Get, "/api/finance/accounts", null, token)).Content.ReadFromJsonAsync<JsonElement>();
        var balance = accounts.EnumerateArray().Single(x => x.GetProperty("id").GetInt32() == a.Id).GetProperty("balance").GetDecimal();
        Assert.Equal(balance, Line(report, a.Id).GetProperty("closing").GetDecimal());

        var totals = report.GetProperty("totals");
        Assert.Equal(report.GetProperty("accounts").EnumerateArray().Sum(x => x.GetProperty("closing").GetDecimal()), totals.GetProperty("closing").GetDecimal());
        Assert.Equal(totals.GetProperty("income").GetDecimal() - totals.GetProperty("expense").GetDecimal(), report.GetProperty("period").GetProperty("net").GetDecimal());
    }

    [Fact]
    public async Task Period_MatchesTheDashboardForTheSameDays()
    {
        await SeedAsync();
        var today = TestFinance.Today;
        var report = await (await GetAsync($"?from={D(today.AddDays(-29))}&to={D(today)}")).Content.ReadFromJsonAsync<JsonElement>();
        var token = (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;
        var dash = await (await api.SendAsync(HttpMethod.Get, "/api/finance/dashboard?days=30", null, token)).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(dash.GetProperty("current").GetProperty("income").GetDecimal(), report.GetProperty("period").GetProperty("income").GetDecimal());
        Assert.Equal(dash.GetProperty("current").GetProperty("expense").GetDecimal(), report.GetProperty("period").GetProperty("expense").GetDecimal());
    }

    [Fact]
    public async Task Categories_AreRankedBiggestFirst_WithSharesAndCounts()
    {
        var a = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 0m);
        await TestFinance.AddEntryAsync(api.ConnectionString, a.Id, FinEntryKinds.Expense, 10m, TestFinance.Today, categoryId: 3);
        var report = await (await GetAsync($"?from={D(TestFinance.Today)}")).Content.ReadFromJsonAsync<JsonElement>();
        var rows = report.GetProperty("expenseCategories").EnumerateArray().ToList();
        Assert.NotEmpty(rows);
        var amounts = rows.Select(x => x.GetProperty("amount").GetDecimal()).ToList();
        Assert.Equal(amounts.OrderByDescending(x => x), amounts);
        Assert.Contains(rows, x => x.GetProperty("categoryId").GetInt32() == 3 && x.GetProperty("count").GetInt32() >= 1);
    }

    [Theory]
    [InlineData("?from=2026-13-01")]
    [InlineData("?from=2026-05-02&to=2026-05-01")]
    [InlineData("?to=2999-01-01")]
    [InlineData("?from=2000-01-01")]
    [InlineData("?format=docx")]
    public async Task BadInput_IsRefused(string query) => Assert.Equal(HttpStatusCode.BadRequest, (await GetAsync(query)).StatusCode);

    [Fact]
    public async Task Csv_HasABom_PlainNumbers_AndTheSameFiguresAsTheStatement()
    {
        var (a, _) = await SeedAsync();
        var from = D(TestFinance.Today.AddDays(-20));
        var response = await GetAsync($"?from={from}&format=csv");
        response.EnsureSuccessStatusCode();
        Assert.Contains("text/csv", response.Content.Headers.ContentType!.ToString());
        var bytes = await response.Content.ReadAsByteArrayAsync();
        Assert.Equal(new byte[] { 0xEF, 0xBB, 0xBF }, bytes[..3]);
        var text = Encoding.UTF8.GetString(bytes);
        Assert.Contains($"{(await AccountName(a.Id))},1500.00,300.00,200.00,0.00,100.00,0.00,1500.00", text);
        Assert.Contains("Net result,", text);
        Assert.DoesNotContain("1,500.00", text);
    }

    private async Task<string> AccountName(int id)
    {
        var token = (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;
        var accounts = await (await api.SendAsync(HttpMethod.Get, "/api/finance/accounts", null, token)).Content.ReadFromJsonAsync<JsonElement>();
        return accounts.EnumerateArray().Single(x => x.GetProperty("id").GetInt32() == id).GetProperty("name").GetString()!;
    }

    [Fact]
    public async Task Excel_AndPdf_AreRealFiles_AndPartnerMayDownloadThem()
    {
        await SeedAsync();
        var from = D(TestFinance.Today.AddDays(-20));
        var xlsx = await GetAsync($"?from={from}&format=xlsx", Roles.Viewer);
        xlsx.EnsureSuccessStatusCode();
        Assert.Equal(new byte[] { 0x50, 0x4B }, (await xlsx.Content.ReadAsByteArrayAsync())[..2]);
        Assert.EndsWith(".xlsx", xlsx.Content.Headers.ContentDisposition!.FileName!.Trim('"'));

        var pdf = await GetAsync($"?from={from}&format=pdf", Roles.Viewer);
        pdf.EnsureSuccessStatusCode();
        Assert.Equal("%PDF", Encoding.ASCII.GetString((await pdf.Content.ReadAsByteArrayAsync())[..4]));
    }

    [Fact]
    public async Task Excel_HoldsTheSameTotalsAsTheStatement()
    {
        await SeedAsync();
        var from = D(TestFinance.Today.AddDays(-20));
        var report = await (await GetAsync($"?from={from}")).Content.ReadFromJsonAsync<JsonElement>();
        var bytes = await (await GetAsync($"?from={from}&format=xlsx")).Content.ReadAsByteArrayAsync();
        using var book = new ClosedXML.Excel.XLWorkbook(new MemoryStream(bytes));
        var sheet = book.Worksheet("Statement");
        var total = sheet.RowsUsed().Single(r => r.Cell(1).GetString() == "Total");
        Assert.Equal(report.GetProperty("totals").GetProperty("income").GetDecimal(), (decimal)total.Cell(3).GetDouble());
        Assert.Equal(report.GetProperty("totals").GetProperty("closing").GetDecimal(), (decimal)total.Cell(8).GetDouble());
        Assert.NotNull(book.Worksheet("Entries"));
    }

    [Fact]
    public async Task Months_ListEveryMonthOfThePeriod_WithTheirOwnTotals_AndTheLockedMarker()
    {
        // 2015 is far from every other test's dates, so these figures are this test's alone.
        var account = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 0m, openingDate: new DateOnly(2014, 1, 1));
        var partner = await TestFinance.AddPartnerAsync(api.ConnectionString);
        var c = api.ConnectionString;
        await TestFinance.AddEntryAsync(c, account.Id, FinEntryKinds.Income, 777m, new DateOnly(2015, 3, 5));    // before the period
        await TestFinance.AddEntryAsync(c, account.Id, FinEntryKinds.Income, 1000m, new DateOnly(2015, 3, 15));
        await TestFinance.AddEntryAsync(c, account.Id, FinEntryKinds.Expense, 400m, new DateOnly(2015, 3, 20));
        await TestFinance.AddEntryAsync(c, account.Id, FinEntryKinds.Expense, 250m, new DateOnly(2015, 4, 2));
        await TestFinance.AddEntryAsync(c, account.Id, FinEntryKinds.Expense, 999m, new DateOnly(2015, 4, 3), FinStatuses.Voided);
        await TestFinance.AddCapitalAsync(c, account.Id, partner.Id, 5000m, new DateOnly(2015, 4, 10));
        await TestFinance.AddCapitalAsync(c, account.Id, partner.Id, 500m, new DateOnly(2015, 4, 11), FinEntryKinds.CapitalOut);
        await using (var db = TestUsers.NewContext(c))
        {
            db.FinMonthLocks.Add(new FinMonthLock { Year = 2015, Month = 4, IsLocked = true, LockedBy = "checker", LockedUtc = DateTime.UtcNow });
            await db.SaveChangesAsync();
        }

        var report = await (await GetAsync("?from=2015-03-10&to=2015-05-31")).Content.ReadFromJsonAsync<JsonElement>();
        var months = report.GetProperty("months").EnumerateArray().ToList();
        Assert.Equal(["2015-03", "2015-04", "2015-05"], months.Select(m => m.GetProperty("month").GetString()));

        Assert.Equal(1000m, months[0].GetProperty("income").GetDecimal());
        Assert.Equal(400m, months[0].GetProperty("expense").GetDecimal());
        Assert.Equal(600m, months[0].GetProperty("net").GetDecimal());
        Assert.Equal(2, months[0].GetProperty("entries").GetInt32());
        Assert.False(months[0].GetProperty("isLocked").GetBoolean());

        Assert.Equal(-250m, months[1].GetProperty("net").GetDecimal());
        Assert.Equal(4500m, months[1].GetProperty("capital").GetDecimal());   // 5,000 put in less 500 paid back, not income
        Assert.Equal(1, months[1].GetProperty("entries").GetInt32());          // the voided 999 counts nowhere
        Assert.True(months[1].GetProperty("isLocked").GetBoolean());
        Assert.Equal("checker", months[1].GetProperty("lockedBy").GetString());

        Assert.Equal(0m, months[2].GetProperty("net").GetDecimal());
        Assert.Equal(report.GetProperty("period").GetProperty("net").GetDecimal(), months.Sum(m => m.GetProperty("net").GetDecimal()));
    }

    [Fact]
    public async Task Months_AreInTheCsv_AndTheExcelFile()
    {
        var account = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 0m, openingDate: new DateOnly(2013, 1, 1));
        await TestFinance.AddEntryAsync(api.ConnectionString, account.Id, FinEntryKinds.Expense, 250m, new DateOnly(2013, 6, 2));
        var csv = await (await GetAsync("?from=2013-06-01&to=2013-06-30&format=csv")).Content.ReadAsStringAsync();
        Assert.Contains("Month by month,Entries,Income,Expenses,Net,Capital,Status", csv);
        Assert.Contains("2013-06,1,0.00,250.00,-250.00,0.00,Open", csv);

        var bytes = await (await GetAsync("?from=2013-06-01&to=2013-06-30&format=xlsx")).Content.ReadAsByteArrayAsync();
        using var book = new ClosedXML.Excel.XLWorkbook(new MemoryStream(bytes));
        var sheet = book.Worksheet("Months");
        var total = sheet.RowsUsed().Single(r => r.Cell(1).GetString() == "Total");
        Assert.Equal(-250.0, total.Cell(5).GetDouble());
    }
}
