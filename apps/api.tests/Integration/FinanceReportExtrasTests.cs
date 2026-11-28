using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>The report by payee and by who entered, the cash flow, and the day, week and year views.</summary>
public class FinanceReportExtrasTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private static string D(DateOnly date) => date.ToString("yyyy-MM-dd");

    private async Task<JsonElement> ReportAsync(string query, string role = Roles.Manager)
    {
        var token = (await TestWorkers.SignInAsync(api, role)).Token;
        var request = new HttpRequestMessage(HttpMethod.Get, "/api/finance/reports/summary" + query);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var response = await api.Client.SendAsync(request);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private async Task<HttpResponseMessage> RawAsync(string query)
    {
        var token = (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;
        var request = new HttpRequestMessage(HttpMethod.Get, "/api/finance/reports/summary" + query);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return await api.Client.SendAsync(request);
    }

    /// <summary>March 2011, far from every other test's dates, so every figure here is this test's alone.</summary>
    private static readonly SemaphoreSlim Gate = new(1, 1);
    private static readonly HashSet<string> Seeded = [];

    /// <summary>Seeds once per database: every test in the class reads the same March 2011.</summary>
    private async Task SeedAsync()
    {
        await Gate.WaitAsync();
        try
        {
            if (Seeded.Add(api.ConnectionString)) await InsertAsync();
        }
        finally
        {
            Gate.Release();
        }
    }

    private async Task InsertAsync()
    {
        var account = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 10_000m, openingDate: new DateOnly(2011, 1, 1));
        var partner = await TestFinance.AddPartnerAsync(api.ConnectionString);
        var c = api.ConnectionString;
        await TestFinance.AddEntryAsync(c, account.Id, FinEntryKinds.Expense, 12_000m, new DateOnly(2011, 3, 2), party: "M S K Luxuries", createdBy: "ahmed");
        await TestFinance.AddEntryAsync(c, account.Id, FinEntryKinds.Expense, 12_000m, new DateOnly(2011, 3, 30), party: "m s k luxuries", createdBy: "ahmed");   // the same payee typed in another case
        await TestFinance.AddEntryAsync(c, account.Id, FinEntryKinds.Expense, 600m, new DateOnly(2011, 3, 9), party: "Dubai Insurance", createdBy: "jesus");
        await TestFinance.AddEntryAsync(c, account.Id, FinEntryKinds.Expense, 400m, new DateOnly(2011, 3, 9), party: "Taxi", createdBy: "jesus", status: FinStatuses.Voided);
        await TestFinance.AddEntryAsync(c, account.Id, FinEntryKinds.Income, 30_000m, new DateOnly(2011, 3, 15), party: "One by Binghatti", createdBy: "ahmed");
        await TestFinance.AddCapitalAsync(c, account.Id, partner.Id, 20_000m, new DateOnly(2011, 3, 1));
        await TestFinance.AddCapitalAsync(c, account.Id, partner.Id, 2_000m, new DateOnly(2011, 3, 31), FinEntryKinds.CapitalOut);
    }

    [Fact]
    public async Task Payees_GroupTheSameNameWhateverItsCase_ShareAddsUpTo100_AndVoidedAreLeftOut()
    {
        await SeedAsync();

        var report = await ReportAsync("?from=2011-03-01&to=2011-03-31");

        var expenses = report.GetProperty("expensePayees").EnumerateArray().ToList();
        Assert.Equal(["M S K Luxuries", "Dubai Insurance"], expenses.Select(p => p.GetProperty("name").GetString()), StringComparer.OrdinalIgnoreCase);
        Assert.Equal(24_000m, expenses[0].GetProperty("amount").GetDecimal());
        Assert.Equal(2, expenses[0].GetProperty("count").GetInt32());
        Assert.Equal(100.0m, expenses.Sum(p => p.GetProperty("share").GetDecimal()));
        var income = report.GetProperty("incomePayees").EnumerateArray().Single();
        Assert.Equal("One by Binghatti", income.GetProperty("name").GetString());
        Assert.Equal(100.0m, income.GetProperty("share").GetDecimal());
    }

    [Fact]
    public async Task EnteredBy_CountsEachPersonsActiveEntries()
    {
        await SeedAsync();

        var report = await ReportAsync("?from=2011-03-01&to=2011-03-31");

        var people = report.GetProperty("enteredBy").EnumerateArray().ToDictionary(p => p.GetProperty("name").GetString()!);
        Assert.Equal(3, people["ahmed"].GetProperty("entries").GetInt32());
        Assert.Equal(24_000m, people["ahmed"].GetProperty("expense").GetDecimal());
        Assert.Equal(30_000m, people["ahmed"].GetProperty("income").GetDecimal());
        Assert.Equal(1, people["jesus"].GetProperty("entries").GetInt32());   // the voided taxi is not counted
        Assert.Equal(600m, people["jesus"].GetProperty("expense").GetDecimal());
    }

    [Fact]
    public async Task CashFlow_AddsUp_AndAgreesWithTheStatement()
    {
        await SeedAsync();

        var report = await ReportAsync("?from=2011-03-01&to=2011-03-31");

        var flow = report.GetProperty("cashFlow");
        Assert.Equal(30_000m, flow.GetProperty("income").GetDecimal());
        Assert.Equal(24_600m, flow.GetProperty("expense").GetDecimal());
        Assert.Equal(5_400m, flow.GetProperty("operating").GetDecimal());
        Assert.Equal(20_000m, flow.GetProperty("capitalIn").GetDecimal());
        Assert.Equal(2_000m, flow.GetProperty("capitalOut").GetDecimal());
        Assert.Equal(18_000m, flow.GetProperty("financing").GetDecimal());
        Assert.Equal(0m, flow.GetProperty("other").GetDecimal());
        var opening = flow.GetProperty("opening").GetDecimal();
        Assert.Equal(opening + 5_400m + 18_000m, flow.GetProperty("closing").GetDecimal());
        Assert.Equal(flow.GetProperty("closing").GetDecimal() - opening, flow.GetProperty("netChange").GetDecimal());
        Assert.Equal(report.GetProperty("totals").GetProperty("closing").GetDecimal(), flow.GetProperty("closing").GetDecimal());
    }

    [Fact]
    public async Task Granularity_DaysWeeksAndYears_CutTheSamePeriodWithTheSameTotals()
    {
        await SeedAsync();
        var whole = await ReportAsync("?from=2011-03-01&to=2011-03-31");
        var expense = whole.GetProperty("period").GetProperty("expense").GetDecimal();

        var weekly = await ReportAsync("?from=2011-03-01&to=2011-03-31&granularity=week");
        Assert.Equal("week", weekly.GetProperty("granularity").GetString());
        var weeks = weekly.GetProperty("months").EnumerateArray().ToList();
        Assert.Equal("2011-02-28", weeks[0].GetProperty("month").GetString());   // weeks start on Monday
        Assert.Equal(expense, weeks.Sum(w => w.GetProperty("expense").GetDecimal()));

        var daily = await ReportAsync("?from=2011-03-08&to=2011-03-10&granularity=day");
        var days = daily.GetProperty("months").EnumerateArray().ToList();
        Assert.Equal(["2011-03-08", "2011-03-09", "2011-03-10"], days.Select(d => d.GetProperty("month").GetString()));
        Assert.Equal(600m, days[1].GetProperty("expense").GetDecimal());

        var yearly = await ReportAsync("?from=2011-01-01&to=2012-12-31&granularity=year");
        var years = yearly.GetProperty("months").EnumerateArray().ToList();
        Assert.Equal(["2011", "2012"], years.Select(y => y.GetProperty("month").GetString()));
        Assert.True(years[0].GetProperty("expense").GetDecimal() >= expense);
    }

    [Fact]
    public async Task Granularity_RefusesAnUnknownValue_AndADailyViewOverThreeMonths()
    {
        Assert.Equal(HttpStatusCode.BadRequest, (await RawAsync("?from=2011-03-01&to=2011-03-31&granularity=hour")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await RawAsync("?from=2011-01-01&to=2011-12-31&granularity=day")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await RawAsync("?from=2011-01-01&to=2011-12-31&granularity=month")).StatusCode);
    }

    [Fact]
    public async Task Excel_Csv_AndPdf_CarryThePayeeEnteredByAndCashFlowSections()
    {
        await SeedAsync();
        var token = (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;
        async Task<byte[]> Get(string format)
        {
            var request = new HttpRequestMessage(HttpMethod.Get, $"/api/finance/reports/summary?from=2011-03-01&to=2011-03-31&format={format}");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            var response = await api.Client.SendAsync(request);
            response.EnsureSuccessStatusCode();
            return await response.Content.ReadAsByteArrayAsync();
        }

        using var book = new ClosedXML.Excel.XLWorkbook(new MemoryStream(await Get("xlsx")));
        foreach (var name in new[] { "Cash flow", "Expense payees", "Income sources", "Entered by" }) Assert.NotNull(book.Worksheet(name));
        var flow = book.Worksheet("Cash flow").RowsUsed().Single(r => r.Cell(1).GetString() == "Net from operations");
        Assert.Equal(5_400m, (decimal)flow.Cell(2).GetDouble());

        var csv = System.Text.Encoding.UTF8.GetString(await Get("csv"));
        Assert.Contains("Expenses by payee", csv);
        Assert.Contains("Entered by,Entries,Income,Expenses", csv);
        Assert.Contains("Net from operations,5400.00", csv);
        Assert.Equal(new byte[] { 0x25, 0x50, 0x44, 0x46 }, (await Get("pdf"))[..4]);
    }
}
