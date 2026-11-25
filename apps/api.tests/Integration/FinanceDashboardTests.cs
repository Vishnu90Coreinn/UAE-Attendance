using System.Net.Http.Json;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>The finance overview. The database is shared between tests, so each check compares the figures before and after its own rows.</summary>
public class FinanceDashboardTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private async Task<JsonElement> GetAsync(int? days, string role = Roles.Manager)
    {
        var token = (await TestWorkers.SignInAsync(api, role)).Token;
        var response = await api.SendAsync(HttpMethod.Get, "/api/finance/dashboard" + (days is null ? "" : $"?days={days}"), null, token);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static decimal Money(JsonElement element, string a, string b) => element.GetProperty(a).GetProperty(b).GetDecimal();

    [Fact]
    public async Task UnknownWindow_FallsBackToThirtyDays()
    {
        Assert.Equal(30, (await GetAsync(5)).GetProperty("days").GetInt32());
        Assert.Equal(7, (await GetAsync(7)).GetProperty("days").GetInt32());
        Assert.Equal(365, (await GetAsync(365)).GetProperty("days").GetInt32());
    }

    [Fact]
    public async Task Period_CountsActiveIncomeAndExpense_NotVoidedOrOutsideTheWindow()
    {
        var account = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 0m);
        var before = await GetAsync(30);
        var beforeYear = await GetAsync(365);
        await TestFinance.AddEntryAsync(api.ConnectionString, account.Id, FinEntryKinds.Income, 500m, TestFinance.Today);
        await TestFinance.AddEntryAsync(api.ConnectionString, account.Id, FinEntryKinds.Expense, 200m, TestFinance.Today.AddDays(-2));
        await TestFinance.AddEntryAsync(api.ConnectionString, account.Id, FinEntryKinds.Expense, 999m, TestFinance.Today, FinStatuses.Voided);
        await TestFinance.AddEntryAsync(api.ConnectionString, account.Id, FinEntryKinds.Expense, 70m, TestFinance.Today.AddDays(-40));
        var after = await GetAsync(30);
        var afterYear = await GetAsync(365);

        Assert.Equal(500m, Money(after, "current", "income") - Money(before, "current", "income"));
        Assert.Equal(200m, Money(after, "current", "expense") - Money(before, "current", "expense"));
        Assert.Equal(300m, Money(after, "current", "net") - Money(before, "current", "net"));
        Assert.Equal(70m, Money(after, "previous", "expense") - Money(before, "previous", "expense"));
        Assert.Equal(270m, Money(afterYear, "current", "expense") - Money(beforeYear, "current", "expense"));
    }

    [Fact]
    public async Task Balances_MatchAccountsAndIgnoreTransfers()
    {
        var a = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 1000m);
        var b = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 0m);
        var before = await GetAsync(30);
        await TestFinance.AddTransferAsync(api.ConnectionString, a.Id, b.Id, 400m, TestFinance.Today.AddDays(-1));
        var after = await GetAsync(30);

        Assert.Equal(Money(before, "current", "income"), Money(after, "current", "income"));
        Assert.Equal(Money(before, "current", "expense"), Money(after, "current", "expense"));
        Assert.Equal(before.GetProperty("totalBalance").GetDecimal(), after.GetProperty("totalBalance").GetDecimal());
        var sum = after.GetProperty("accounts").EnumerateArray().Sum(x => x.GetProperty("balance").GetDecimal());
        Assert.Equal(after.GetProperty("totalBalance").GetDecimal(), sum);
    }

    [Fact]
    public async Task Buckets_AreDailyUpToThirtyDaysAndMonthlyForAYear()
    {
        var week = await GetAsync(7);
        Assert.Equal("day", week.GetProperty("granularity").GetString());
        Assert.Equal(7, week.GetProperty("buckets").GetArrayLength());
        Assert.Equal(30, (await GetAsync(30)).GetProperty("buckets").GetArrayLength());
        var year = await GetAsync(365);
        Assert.Equal("month", year.GetProperty("granularity").GetString());
        var months = year.GetProperty("buckets").GetArrayLength();
        Assert.InRange(months, 12, 13);
    }

    [Fact]
    public async Task Spending_RanksCategoriesAndSharesAddUpNearOneHundred()
    {
        var account = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 0m);
        await TestFinance.AddEntryAsync(api.ConnectionString, account.Id, FinEntryKinds.Expense, 100m, TestFinance.Today, categoryId: 2);
        var spending = (await GetAsync(7)).GetProperty("spending").EnumerateArray().ToList();
        Assert.NotEmpty(spending);
        var amounts = spending.Take(6).Select(x => x.GetProperty("amount").GetDecimal()).ToList();
        Assert.Equal(amounts.OrderByDescending(x => x), amounts);
        Assert.Equal(100.0m, spending.Sum(x => x.GetProperty("share").GetDecimal()));   // shown to one decimal and still adding up
    }

    [Fact]
    public async Task Latest_ListsAtMostEightActiveEntriesNewestFirst()
    {
        var account = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 0m);
        for (var i = 0; i < 9; i++) await TestFinance.AddEntryAsync(api.ConnectionString, account.Id, FinEntryKinds.Expense, 1m + i, TestFinance.Today);
        await TestFinance.AddEntryAsync(api.ConnectionString, account.Id, FinEntryKinds.Expense, 777m, TestFinance.Today, FinStatuses.Voided);
        var latest = (await GetAsync(30)).GetProperty("latest").EnumerateArray().ToList();
        Assert.Equal(8, latest.Count);
        Assert.DoesNotContain(latest, x => x.GetProperty("amount").GetDecimal() == 777m);
        var dates = latest.Select(x => x.GetProperty("entryDate").GetString()!).ToList();
        Assert.Equal(dates.OrderByDescending(x => x), dates);
    }

    [Fact]
    public async Task Partner_CanReadIt()
    {
        Assert.Equal(30, (await GetAsync(null, Roles.Viewer)).GetProperty("days").GetInt32());
    }

    [Fact]
    public async Task Capital_ListsThePartnersWithTheirShares_AddingUpToOneHundred()
    {
        var partner = await TestFinance.AddPartnerAsync(api.ConnectionString, opening: 12345m);
        var dash = await GetAsync(30);
        var capital = dash.GetProperty("capital");
        var partners = capital.GetProperty("partners").EnumerateArray().ToList();
        Assert.Contains(partners, p => p.GetProperty("id").GetInt32() == partner.Id);
        Assert.Equal(100.00m, partners.Sum(p => p.GetProperty("share").GetDecimal()));
        Assert.Equal(partners.Sum(p => p.GetProperty("netCapital").GetDecimal()), capital.GetProperty("total").GetDecimal());
    }
}
