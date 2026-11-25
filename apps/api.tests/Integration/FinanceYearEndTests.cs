using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>
/// Closing a financial year (1 January to 31 December) moves its income and expenses into retained earnings with one journal dated 31 December.
/// The year's Profit &amp; Loss still reads the same, the balance sheet still balances, and the months stay locked until the year is reopened.
/// </summary>
public class FinanceYearEndTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private async Task<(HttpStatusCode Status, JsonElement Body)> SendAsync(HttpMethod method, string url, string token, object? body = null)
    {
        var request = new HttpRequestMessage(method, url) { Content = body is null ? null : JsonContent.Create(body) };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var response = await api.Client.SendAsync(request);
        var text = await response.Content.ReadAsStringAsync();
        return (response.StatusCode, string.IsNullOrWhiteSpace(text) ? default : JsonDocument.Parse(text).RootElement);
    }

    private static JsonElement Year(JsonElement years, int year) => years.EnumerateArray().Single(y => y.GetProperty("year").GetInt32() == year);

    private async Task<decimal> NetAsync(string token, int year) =>
        (await SendAsync(HttpMethod.Get, $"/api/finance/ledger/profit-and-loss?from={year}-01-01&to={year}-12-31", token)).Body.GetProperty("netProfit").GetDecimal();

    [Fact]
    public async Task ClosingTwoYears_MovesTheResultToRetainedEarnings_AndKeepsEverythingElseTrue()
    {
        var manager = (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;
        var admin = (await TestWorkers.SignInAsync(api, Roles.Administrator)).Token;
        var account = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 100_000m, openingDate: new DateOnly(2024, 1, 1));
        await TestFinance.AddEntryAsync(api.ConnectionString, account.Id, "Income", 30_000m, new DateOnly(2024, 5, 10));
        await TestFinance.AddEntryAsync(api.ConnectionString, account.Id, "Expense", 12_000m, new DateOnly(2024, 6, 1), categoryId: 5);
        await TestFinance.AddEntryAsync(api.ConnectionString, account.Id, "Income", 20_000m, new DateOnly(2025, 3, 10));
        await TestFinance.AddEntryAsync(api.ConnectionString, account.Id, "Expense", 5_000m, new DateOnly(2025, 12, 30), categoryId: 5);

        var years = (await SendAsync(HttpMethod.Get, "/api/finance/ledger/years", manager)).Body;
        Assert.Equal(18_000m, Year(years, 2024).GetProperty("netResult").GetDecimal());
        Assert.Equal(15_000m, Year(years, 2025).GetProperty("netResult").GetDecimal());
        Assert.True(Year(years, 2024).GetProperty("canClose").GetBoolean());
        Assert.Contains("2024 first", Year(years, 2025).GetProperty("blocker").GetString());      // years are closed in order
        Assert.Contains("not over", Year(years, DateTime.UtcNow.Year).GetProperty("blocker").GetString());
        Assert.Equal(HttpStatusCode.Conflict, (await SendAsync(HttpMethod.Post, "/api/finance/ledger/years/2025/close", manager)).Status);

        var closed = await SendAsync(HttpMethod.Post, "/api/finance/ledger/years/2024/close", manager);
        Assert.Equal(HttpStatusCode.OK, closed.Status);
        Assert.Equal("Closed", closed.Body.GetProperty("status").GetString());
        Assert.StartsWith("JNL-", closed.Body.GetProperty("journalNumber").GetString());

        // The closed year's own Profit & Loss is unchanged, and retained earnings now holds the result.
        Assert.Equal(18_000m, await NetAsync(manager, 2024));
        var sheet = (await SendAsync(HttpMethod.Get, "/api/finance/ledger/balance-sheet?asOf=2024-12-31", manager)).Body;
        Assert.True(sheet.GetProperty("balanced").GetBoolean());
        Assert.Equal(0m, sheet.GetProperty("retainedProfit").GetDecimal());                        // nothing left unclosed
        Assert.Equal(18_000m, sheet.GetProperty("equity").EnumerateArray().Single(l => l.GetProperty("code").GetString() == "3800").GetProperty("amount").GetDecimal());

        // Income and expense accounts start 2025 from zero.
        var trial = (await SendAsync(HttpMethod.Get, "/api/finance/ledger/trial-balance?asOf=2024-12-31", manager)).Body;
        Assert.True(trial.GetProperty("balanced").GetBoolean());
        Assert.DoesNotContain(trial.GetProperty("accounts").EnumerateArray(), a => a.GetProperty("type").GetString() is "Revenue" or "Expense" && a.GetProperty("balance").GetDecimal() != 0m);

        // The months of a closed year cannot be unlocked until the year is reopened.
        var unlock = await SendAsync(HttpMethod.Post, "/api/finance/month-locks/2024-05/unlock", admin, new { reason = "check" });
        Assert.Equal(HttpStatusCode.Conflict, unlock.Status);

        Assert.Equal(HttpStatusCode.OK, (await SendAsync(HttpMethod.Post, "/api/finance/ledger/years/2025/close", manager)).Status);
        var sheet2 = (await SendAsync(HttpMethod.Get, "/api/finance/ledger/balance-sheet?asOf=2025-12-31", manager)).Body;
        Assert.Equal(33_000m, sheet2.GetProperty("equity").EnumerateArray().Single(l => l.GetProperty("code").GetString() == "3800").GetProperty("amount").GetDecimal());
        Assert.True(sheet2.GetProperty("balanced").GetBoolean());
        Assert.Equal(15_000m, await NetAsync(manager, 2025));

        // Reopen: only the latest closed year, by an Administrator, with a reason.
        Assert.Equal(HttpStatusCode.Forbidden, (await SendAsync(HttpMethod.Post, "/api/finance/ledger/years/2025/reopen", manager, new { reason = "x" })).Status);
        Assert.Equal(HttpStatusCode.Conflict, (await SendAsync(HttpMethod.Post, "/api/finance/ledger/years/2024/reopen", admin, new { reason = "x" })).Status);
        Assert.Equal(HttpStatusCode.BadRequest, (await SendAsync(HttpMethod.Post, "/api/finance/ledger/years/2025/reopen", admin, new { reason = " " })).Status);
        var reopened = await SendAsync(HttpMethod.Post, "/api/finance/ledger/years/2025/reopen", admin, new { reason = "Late supplier invoice" });
        Assert.Equal(HttpStatusCode.OK, reopened.Status);
        Assert.Equal("Open", reopened.Body.GetProperty("status").GetString());
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(HttpMethod.Post, "/api/finance/month-locks/2025-03/unlock", admin, new { reason = "Late supplier invoice" })).Status);
        var sheet3 = (await SendAsync(HttpMethod.Get, "/api/finance/ledger/balance-sheet?asOf=2025-12-31", manager)).Body;
        Assert.Equal(15_000m, sheet3.GetProperty("retainedProfit").GetDecimal());                  // back to unclosed profit
        Assert.True(sheet3.GetProperty("balanced").GetBoolean());

        var check = (await SendAsync(HttpMethod.Get, "/api/finance/ledger/check", manager)).Body;
        Assert.True(check.GetProperty("allAgree").GetBoolean());
    }

    [Fact]
    public async Task ClosingNeedsFinanceAccess()
    {
        var supervisor = (await TestWorkers.SignInAsync(api, Roles.Supervisor)).Token;
        Assert.Equal(HttpStatusCode.Forbidden, (await SendAsync(HttpMethod.Post, "/api/finance/ledger/years/2020/close", supervisor)).Status);
    }
}

/// <summary>A year with staff expenses still waiting for approval cannot be closed. Own database, so no other test has closed a later year.</summary>
public class FinanceYearEndPendingTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    [Fact]
    public async Task AYearWithStaffExpensesWaitingForApproval_CannotBeClosed()
    {
        var manager = (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;
        var account = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 5_000m, openingDate: new DateOnly(2023, 1, 1));
        await TestFinance.AddEntryAsync(api.ConnectionString, account.Id, "Expense", 100m, new DateOnly(2023, 2, 1), status: FinStatuses.Pending, categoryId: 5);
        await TestFinance.AddEntryAsync(api.ConnectionString, account.Id, "Expense", 100m, new DateOnly(2023, 3, 1), categoryId: 5);

        var years = (await Send(HttpMethod.Get, "/api/finance/ledger/years", manager)).Body;
        Assert.Contains("wait for approval", years.EnumerateArray().Single(y => y.GetProperty("year").GetInt32() == 2023).GetProperty("blocker").GetString());
        Assert.Equal(HttpStatusCode.Conflict, (await Send(HttpMethod.Post, "/api/finance/ledger/years/2023/close", manager)).Status);
    }


    private async Task<(HttpStatusCode Status, JsonElement Body)> Send(HttpMethod method, string url, string token)
    {
        var request = new HttpRequestMessage(method, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var response = await api.Client.SendAsync(request);
        var text = await response.Content.ReadAsStringAsync();
        return (response.StatusCode, string.IsNullOrWhiteSpace(text) ? default : JsonDocument.Parse(text).RootElement);
    }
}

/// <summary>A year that only holds an opening balance has nothing to close, and must not hold up the next year.</summary>
public class FinanceYearEndEmptyYearTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    [Fact]
    public async Task AYearWithOnlyAnOpeningBalance_DoesNotBlockTheNextYear()
    {
        var token = (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;
        var account = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 5_000m, openingDate: new DateOnly(2019, 12, 31));
        await TestFinance.AddEntryAsync(api.ConnectionString, account.Id, "Income", 1_000m, new DateOnly(2020, 2, 1));

        async Task<(HttpStatusCode Status, JsonElement Body)> Send(HttpMethod m, string url)
        {
            var request = new HttpRequestMessage(m, url);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            var response = await api.Client.SendAsync(request);
            var text = await response.Content.ReadAsStringAsync();
            return (response.StatusCode, string.IsNullOrWhiteSpace(text) ? default : JsonDocument.Parse(text).RootElement);
        }

        var years = (await Send(HttpMethod.Get, "/api/finance/ledger/years")).Body;
        var y2020 = years.EnumerateArray().Single(y => y.GetProperty("year").GetInt32() == 2020);
        Assert.True(y2020.GetProperty("canClose").GetBoolean());                     // 2019 has only the opening balance, so nothing stands in the way
        Assert.Equal(HttpStatusCode.OK, (await Send(HttpMethod.Post, "/api/finance/ledger/years/2020/close")).Status);
    }
}
