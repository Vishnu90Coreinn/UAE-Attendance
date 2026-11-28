using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>The "needs attention" panel counts what is overdue or due this week, what waits for approval, and says when the next VAT return is due.</summary>
public class FinanceAttentionTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private static string D(DateOnly d) => d.ToString("yyyy-MM-dd");
    private static DateOnly Today => TestFinance.Today;

    private async Task<(HttpStatusCode Status, JsonElement Body)> SendAsync(HttpMethod method, string url, string token, object? body = null)
    {
        var request = new HttpRequestMessage(method, url) { Content = body is null ? null : JsonContent.Create(body) };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var response = await api.Client.SendAsync(request);
        var text = await response.Content.ReadAsStringAsync();
        return (response.StatusCode, string.IsNullOrWhiteSpace(text) ? default : JsonDocument.Parse(text).RootElement);
    }

    [Fact]
    public async Task CountsOverdueAndSoonDueBillsAndCheques_PendingApprovals_AndGivesTheNextVatDate()
    {
        var token = (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;
        var account = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 10_000m, openingDate: Today.AddDays(-90));
        var before = (await SendAsync(HttpMethod.Get, "/api/finance/attention", token)).Body;
        int Count(JsonElement e, string key) => e.GetProperty(key).GetProperty("count").GetInt32();
        decimal Amount(JsonElement e, string key) => e.GetProperty(key).GetProperty("amount").GetDecimal();

        object Bill(int dueIn) => new { supplierName = "Supplier", billDate = D(Today.AddDays(-20)), dueDate = D(Today.AddDays(dueIn)), taxTypeId = (int?)null, lines = new[] { new { categoryId = 1, amount = 300m } } };
        Assert.Equal(HttpStatusCode.Created, (await SendAsync(HttpMethod.Post, "/api/finance/bills", token, Bill(-3))).Status);       // overdue
        Assert.Equal(HttpStatusCode.Created, (await SendAsync(HttpMethod.Post, "/api/finance/bills", token, Bill(4))).Status);        // due this week
        Assert.Equal(HttpStatusCode.Created, (await SendAsync(HttpMethod.Post, "/api/finance/bills", token, Bill(40))).Status);       // not yet a concern
        string Cheque(string serial, int dueIn) => JsonSerializer.Serialize(new { direction = "Issued", serial, amount = 150m, partyName = "Landlord", issueDate = D(Today.AddDays(-30)), dueDate = D(Today.AddDays(dueIn)), accountId = account.Id });
        Assert.Equal(HttpStatusCode.Created, (await SendAsync(HttpMethod.Post, "/api/finance/cheques", token, JsonDocument.Parse(Cheque("A-1", -2)).RootElement)).Status);
        Assert.Equal(HttpStatusCode.Created, (await SendAsync(HttpMethod.Post, "/api/finance/cheques", token, JsonDocument.Parse(Cheque("A-2", 5)).RootElement)).Status);
        await TestFinance.AddEntryAsync(api.ConnectionString, account.Id, "Expense", 20m, Today.AddDays(-1), status: FinStatuses.Pending, categoryId: 1);

        var after = (await SendAsync(HttpMethod.Get, "/api/finance/attention", token)).Body;

        Assert.Equal(Count(before, "overdueBills") + 1, Count(after, "overdueBills"));
        Assert.Equal(Amount(before, "overdueBills") + 300m, Amount(after, "overdueBills"));
        Assert.Equal(Count(before, "billsDueSoon") + 1, Count(after, "billsDueSoon"));          // only the one due within a week
        Assert.Equal(Count(before, "overdueCheques") + 1, Count(after, "overdueCheques"));
        Assert.Equal(Count(before, "chequesDueSoon") + 1, Count(after, "chequesDueSoon"));
        Assert.Equal(before.GetProperty("pendingApprovals").GetInt32() + 1, after.GetProperty("pendingApprovals").GetInt32());
        Assert.True(after.GetProperty("vatDaysLeft").GetInt32() is >= 0 and <= 120);           // the next return is ahead, never behind
        Assert.Matches(@"^\d{4}-\d{2}-\d{2}$", after.GetProperty("vatDue").GetString());
    }

    [Fact]
    public async Task IsForFinanceRolesOnly()
    {
        var supervisor = (await TestWorkers.SignInAsync(api, Roles.Supervisor)).Token;
        Assert.Equal(HttpStatusCode.Forbidden, (await SendAsync(HttpMethod.Get, "/api/finance/attention", supervisor)).Status);
    }
}
