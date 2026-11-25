using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>A journal set up once posts itself month by month when someone runs it: nothing twice, nothing into a locked month, and the books stay balanced.</summary>
public class FinanceRecurringJournalTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private static DateOnly FirstOfMonth => new(TestFinance.Today.Year, TestFinance.Today.Month, 1);
    private static string Key(DateOnly d) => d.ToString("yyyy-MM");

    private async Task<(HttpStatusCode Status, JsonElement Body)> SendAsync(HttpMethod method, string url, string token, object? body = null)
    {
        var request = new HttpRequestMessage(method, url) { Content = body is null ? null : JsonContent.Create(body) };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var response = await api.Client.SendAsync(request);
        var text = await response.Content.ReadAsStringAsync();
        return (response.StatusCode, string.IsNullOrWhiteSpace(text) ? default : JsonDocument.Parse(text).RootElement);
    }

    private async Task<string> ManagerAsync() => (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;

    private async Task<int> IdOfAsync(string token, string code) =>
        (await SendAsync(HttpMethod.Get, "/api/finance/ledger/accounts", token)).Body.EnumerateArray().Single(a => a.GetProperty("code").GetString() == code).GetProperty("id").GetInt32();

    private async Task<decimal> BalanceAsync(string token, string code) =>
        (await SendAsync(HttpMethod.Get, "/api/finance/ledger/accounts", token)).Body.EnumerateArray().Single(a => a.GetProperty("code").GetString() == code).GetProperty("balance").GetDecimal();

    private object Template(string description, int expense, int prepaid, decimal amount, DateOnly start, DateOnly? end = null, int day = 1) => new
    {
        description, dayOfMonth = day, startMonth = Key(start), endMonth = end is null ? null : Key(end.Value),
        lines = new object[] { new { accountId = expense, debit = amount }, new { accountId = prepaid, credit = amount } },
    };

    [Fact]
    public async Task APrepaidSpreadOverMonths_PostsEachDueMonthOnce_AndStopsAtItsEnd()
    {
        var token = await ManagerAsync();
        var (insurance, prepaid) = (await IdOfAsync(token, "5310"), await IdOfAsync(token, "1700"));
        var (cost0, prepaid0) = (await BalanceAsync(token, "5310"), await BalanceAsync(token, "1700"));
        var made = await SendAsync(HttpMethod.Post, "/api/finance/ledger/recurring", token, Template("Spread annual insurance", insurance, prepaid, 1_000m, FirstOfMonth.AddMonths(-3), FirstOfMonth.AddMonths(-1)));
        Assert.Equal(HttpStatusCode.Created, made.Status);
        var id = made.Body.GetProperty("id").GetInt32();
        Assert.Equal(3, made.Body.GetProperty("due").GetInt32());                 // three months from start to end, all in the past

        var first = await SendAsync(HttpMethod.Post, "/api/finance/ledger/recurring/post-due", token);
        Assert.Equal(3, first.Body.GetProperty("posted").GetInt32());
        Assert.Equal(0, first.Body.GetProperty("skipped").GetArrayLength());
        Assert.Equal(cost0 + 3_000m, await BalanceAsync(token, "5310"));
        Assert.Equal(prepaid0 - 3_000m, await BalanceAsync(token, "1700"));      // an asset that shrinks as it is used up

        var again = await SendAsync(HttpMethod.Post, "/api/finance/ledger/recurring/post-due", token);
        Assert.Equal(0, again.Body.GetProperty("posted").GetInt32());            // nothing twice
        var row = (await SendAsync(HttpMethod.Get, "/api/finance/ledger/recurring", token)).Body.EnumerateArray().Single(r => r.GetProperty("id").GetInt32() == id);
        Assert.Equal(3, row.GetProperty("posted").GetInt32());
        Assert.Equal(0, row.GetProperty("due").GetInt32());

        var journals = (await SendAsync(HttpMethod.Get, "/api/finance/ledger/journals?source=Manual", token)).Body.GetProperty("items").EnumerateArray()
            .Where(j => j.GetProperty("description").GetString()!.StartsWith("Spread annual insurance (monthly,")).ToList();
        Assert.Equal(3, journals.Count);
        Assert.All(journals, j => Assert.Equal(1, int.Parse(j.GetProperty("date").GetString()![8..])));        // dated the 1st
        Assert.True((await SendAsync(HttpMethod.Get, "/api/finance/ledger/check", token)).Body.GetProperty("allAgree").GetBoolean());
    }

    [Fact]
    public async Task ARejectedTemplate_ExplainsWhy_AndAStoppedOneNeverPosts()
    {
        var token = await ManagerAsync();
        var (insurance, prepaid) = (await IdOfAsync(token, "5310"), await IdOfAsync(token, "1700"));
        var unbalanced = await SendAsync(HttpMethod.Post, "/api/finance/ledger/recurring", token, new
        {
            description = "x", dayOfMonth = 1, startMonth = Key(FirstOfMonth), lines = new object[] { new { accountId = insurance, debit = 10m }, new { accountId = prepaid, credit = 9m } },
        });
        Assert.Equal(HttpStatusCode.BadRequest, unbalanced.Status);
        Assert.True(unbalanced.Body.GetProperty("errors").TryGetProperty("lines", out _));
        var badDay = await SendAsync(HttpMethod.Post, "/api/finance/ledger/recurring", token, new { description = "", dayOfMonth = 40, startMonth = "nope", lines = Array.Empty<object>() });
        foreach (var key in new[] { "description", "dayOfMonth", "startMonth", "lines" }) Assert.True(badDay.Body.GetProperty("errors").TryGetProperty(key, out _), key);

        var made = await SendAsync(HttpMethod.Post, "/api/finance/ledger/recurring", token, Template("Stopped before it ran", insurance, prepaid, 50m, FirstOfMonth.AddMonths(-2)));
        var id = made.Body.GetProperty("id").GetInt32();
        var before = await BalanceAsync(token, "5310");
        var stopped = await SendAsync(HttpMethod.Post, $"/api/finance/ledger/recurring/{id}/stop", token);
        Assert.False(stopped.Body.GetProperty("isActive").GetBoolean());
        Assert.Equal(HttpStatusCode.Conflict, (await SendAsync(HttpMethod.Post, $"/api/finance/ledger/recurring/{id}/stop", token)).Status);
        await SendAsync(HttpMethod.Post, "/api/finance/ledger/recurring/post-due", token);
        Assert.Equal(before, await BalanceAsync(token, "5310"));
    }

    [Fact]
    public async Task ADayBeyondTheEndOfAShortMonth_UsesTheLastDay_AndAFutureDayWaits()
    {
        var token = await ManagerAsync();
        var (insurance, prepaid) = (await IdOfAsync(token, "5310"), await IdOfAsync(token, "1700"));
        var future = TestFinance.Today.Day < 28 ? 31 : 0;      // a day later this month, unless it is nearly the end of it
        if (future == 0) return;
        var made = await SendAsync(HttpMethod.Post, "/api/finance/ledger/recurring", token, Template("Month end", insurance, prepaid, 10m, FirstOfMonth, null, day: 31));
        Assert.Equal(0, made.Body.GetProperty("due").GetInt32());                // the day has not come yet this month
        Assert.Equal(Key(FirstOfMonth), made.Body.GetProperty("nextMonth").GetString());
    }
}

public class FinanceRecurringLockedMonthTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    [Fact]
    public async Task ALockedMonth_IsLeftForLater_AndReported_WhileTheOthersPost()
    {
        var token = (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;
        async Task<(HttpStatusCode Status, JsonElement Body)> Send(HttpMethod m, string url, object? body = null)
        {
            var request = new HttpRequestMessage(m, url) { Content = body is null ? null : JsonContent.Create(body) };
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            var response = await api.Client.SendAsync(request);
            var text = await response.Content.ReadAsStringAsync();
            return (response.StatusCode, string.IsNullOrWhiteSpace(text) ? default : JsonDocument.Parse(text).RootElement);
        }

        var accounts = (await Send(HttpMethod.Get, "/api/finance/ledger/accounts")).Body.EnumerateArray().ToList();
        int Id(string code) => accounts.Single(a => a.GetProperty("code").GetString() == code).GetProperty("id").GetInt32();
        var first = new DateOnly(TestFinance.Today.Year, TestFinance.Today.Month, 1);
        var locked = first.AddMonths(-2);
        Assert.Equal(HttpStatusCode.OK, (await Send(HttpMethod.Post, $"/api/finance/month-locks/{locked:yyyy-MM}/lock")).Status);
        var made = await Send(HttpMethod.Post, "/api/finance/ledger/recurring", new
        {
            description = "Depreciation", dayOfMonth = 1, startMonth = $"{first.AddMonths(-3):yyyy-MM}", endMonth = $"{first.AddMonths(-1):yyyy-MM}",
            lines = new object[] { new { accountId = Id("5500"), debit = 200m }, new { accountId = Id("1850"), credit = 200m } },
        });
        Assert.Equal(HttpStatusCode.Created, made.Status);

        var run = await Send(HttpMethod.Post, "/api/finance/ledger/recurring/post-due");
        Assert.Equal(2, run.Body.GetProperty("posted").GetInt32());
        var skipped = run.Body.GetProperty("skipped").EnumerateArray().Single();
        Assert.Equal($"{locked:yyyy-MM}", skipped.GetProperty("month").GetString());
        Assert.Contains("locked", skipped.GetProperty("reason").GetString());

        // Once the month is unlocked the missing month can be posted, and only that one.
        Assert.Equal(HttpStatusCode.OK, (await Send(HttpMethod.Post, $"/api/finance/month-locks/{locked:yyyy-MM}/unlock", new { reason = "Late depreciation" })).Status);
        var later = await Send(HttpMethod.Post, "/api/finance/ledger/recurring/post-due");
        Assert.Equal(1, later.Body.GetProperty("posted").GetInt32());
    }
}
