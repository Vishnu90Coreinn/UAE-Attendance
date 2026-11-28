using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>The cheque register: issued and received cheques, post-dated ones, status changes, and what the overview shows.</summary>
public class FinanceChequeTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private static string D(DateOnly date) => date.ToString("yyyy-MM-dd");
    private async Task<string> ManagerAsync() => (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;

    private HttpRequestMessage Req(HttpMethod method, string url, string token, HttpContent? content = null)
    {
        var r = new HttpRequestMessage(method, url) { Content = content };
        r.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return r;
    }

    private async Task<int> BankAsync() => (await TestFinance.AddAccountAsync(api.ConnectionString, opening: 30_000m)).Id;

    private async Task<(HttpResponseMessage Response, JsonElement Body)> PostAsync(string token, string url, object body)
    {
        var response = await api.Client.SendAsync(Req(HttpMethod.Post, url, token, JsonContent.Create(body)));
        return (response, await TestWorkers.ReadJsonAsync(response));
    }

    private Task<(HttpResponseMessage Response, JsonElement Body)> IssueAsync(string token, int account, string serial, decimal amount, int dueInDays = 0, string party = "M S K Luxuries Properties") =>
        PostAsync(token, "/api/finance/cheques", new
        {
            direction = "Issued", serial, amount, partyName = party, issueDate = D(TestFinance.Today.AddDays(-10)), dueDate = D(TestFinance.Today.AddDays(dueInDays)), accountId = account,
        });

    [Fact]
    public async Task Issue_SavesTheCheque_AsIssued_AuditsIt_AndChangesNoBalance()
    {
        var token = await ManagerAsync();
        var account = await BankAsync();

        var (response, body) = await IssueAsync(token, account, "000004", 12_000m);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal("Issued", body.GetProperty("status").GetString());
        Assert.True(body.GetProperty("isOpen").GetBoolean());
        Assert.Equal(["Delivered", "Cancelled"], body.GetProperty("nextStatuses").EnumerateArray().Select(s => s.GetString()));
        Assert.Single(await TestFinance.AuditAsync(api.ConnectionString, "FinChequeCreated", body.GetProperty("id").GetInt32().ToString()));
        var accounts = await (await api.Client.SendAsync(Req(HttpMethod.Get, "/api/finance/accounts", token))).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(30_000m, accounts.EnumerateArray().Single(a => a.GetProperty("id").GetInt32() == account).GetProperty("balance").GetDecimal());   // a cheque is not an expense
    }

    [Fact]
    public async Task Issue_RefusesBadFields_ACashAccount_AndARepeatedSerialOnTheSameAccount()
    {
        var token = await ManagerAsync();
        var account = await BankAsync();
        var cash = (await TestFinance.AddAccountAsync(api.ConnectionString, kind: "Cash")).Id;
        await IssueAsync(token, account, "777", 100m);

        Assert.Equal(HttpStatusCode.BadRequest, (await IssueAsync(token, account, "777", 100m)).Response.StatusCode);   // same book, same number
        var otherBank = await BankAsync();
        Assert.Equal(HttpStatusCode.Created, (await IssueAsync(token, otherBank, "777", 100m)).Response.StatusCode);   // another account may reuse it
        var (cashResponse, cashBody) = await IssueAsync(token, cash, "778", 100m);
        Assert.Equal(HttpStatusCode.BadRequest, cashResponse.StatusCode);
        Assert.True(cashBody.GetProperty("errors").TryGetProperty("accountId", out _));

        var (bad, badBody) = await PostAsync(token, "/api/finance/cheques", new { direction = "Issued", serial = "", amount = 0, partyName = "", issueDate = D(TestFinance.Today), dueDate = D(TestFinance.Today.AddDays(-1)), accountId = account });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        var errors = badBody.GetProperty("errors");
        foreach (var field in new[] { "serial", "amount", "partyName", "dueDate" }) Assert.True(errors.TryGetProperty(field, out _), field);
        Assert.Equal(HttpStatusCode.BadRequest, (await PostAsync(token, "/api/finance/cheques", new { direction = "Sideways" })).Response.StatusCode);
    }

    [Fact]
    public async Task IssuedFlow_ThroughDeliveredToCleared_AndFinalStatusesStayFinal()
    {
        var token = await ManagerAsync();
        var account = await BankAsync();
        var (_, cheque) = await IssueAsync(token, account, "F1", 500m);
        var id = cheque.GetProperty("id").GetInt32();

        Assert.Equal(HttpStatusCode.Conflict, (await PostAsync(token, $"/api/finance/cheques/{id}/status", new { status = "Cleared" })).Response.StatusCode);   // not handed over yet
        Assert.Equal(HttpStatusCode.OK, (await PostAsync(token, $"/api/finance/cheques/{id}/status", new { status = "Delivered" })).Response.StatusCode);
        var (cleared, body) = await PostAsync(token, $"/api/finance/cheques/{id}/status", new { status = "Cleared", date = D(TestFinance.Today) });
        Assert.Equal(HttpStatusCode.OK, cleared.StatusCode);
        Assert.False(body.GetProperty("isOpen").GetBoolean());
        Assert.Empty(body.GetProperty("nextStatuses").EnumerateArray());
        Assert.Equal(HttpStatusCode.Conflict, (await PostAsync(token, $"/api/finance/cheques/{id}/status", new { status = "Bounced", note = "x" })).Response.StatusCode);
        var edit = await api.Client.SendAsync(Req(HttpMethod.Put, $"/api/finance/cheques/{id}", token, JsonContent.Create(new { })));
        Assert.Equal(HttpStatusCode.Conflict, edit.StatusCode);   // a cleared cheque is a record
        Assert.Equal(2, (await TestFinance.AuditAsync(api.ConnectionString, "FinChequeStatusChanged", id.ToString())).Count);
    }

    [Fact]
    public async Task BouncedAndCancelled_NeedAReason_AndReceivedChequesFollowTheirOwnFlow()
    {
        var token = await ManagerAsync();
        var account = await BankAsync();
        var (_, received) = await PostAsync(token, "/api/finance/cheques", new
        {
            direction = "Received", serial = "R-1", amount = 8_000m, partyName = "One by Binghatti", issueDate = D(TestFinance.Today), dueDate = D(TestFinance.Today.AddDays(10)), accountId = account,
        });
        var id = received.GetProperty("id").GetInt32();
        Assert.Equal("Received", received.GetProperty("status").GetString());

        Assert.Equal(HttpStatusCode.Conflict, (await PostAsync(token, $"/api/finance/cheques/{id}/status", new { status = "Delivered" })).Response.StatusCode);   // that is for issued cheques
        await PostAsync(token, $"/api/finance/cheques/{id}/status", new { status = "Deposited" });
        Assert.Equal(HttpStatusCode.BadRequest, (await PostAsync(token, $"/api/finance/cheques/{id}/status", new { status = "Bounced" })).Response.StatusCode);
        var (ok, body) = await PostAsync(token, $"/api/finance/cheques/{id}/status", new { status = "Bounced", note = "Insufficient funds" });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        Assert.Equal("Insufficient funds", body.GetProperty("statusNote").GetString());
    }

    [Fact]
    public async Task ListAndSummary_ShowPostDatedCommitments_AndOverdueOnes()
    {
        var token = await ManagerAsync();
        var account = await BankAsync();
        await IssueAsync(token, account, "S-soon", 1_000m, dueInDays: 10);
        await IssueAsync(token, account, "S-late", 10_000m, dueInDays: 120);
        await IssueAsync(token, account, "S-over", 250m, dueInDays: -3);
        var (_, done) = await IssueAsync(token, account, "S-done", 9_999m, dueInDays: 5);
        var doneId = done.GetProperty("id").GetInt32();
        await PostAsync(token, $"/api/finance/cheques/{doneId}/status", new { status = "Cancelled", note = "Written twice" });

        var list = await (await api.Client.SendAsync(Req(HttpMethod.Get, $"/api/finance/cheques?direction=Issued&openOnly=true&accountId={account}", token))).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(11_250m, list.GetProperty("openIssued").GetDecimal());   // the cancelled one is not a commitment
        var items = list.GetProperty("items").EnumerateArray().ToList();
        Assert.Equal(["S-over", "S-soon", "S-late"], items.Select(i => i.GetProperty("serial").GetString()));   // by due date
        Assert.True(items[0].GetProperty("isOverdue").GetBoolean());
        Assert.True(items[2].GetProperty("isPostDated").GetBoolean());

        var summary = await (await api.Client.SendAsync(Req(HttpMethod.Get, "/api/finance/cheques/summary", token))).Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(summary.GetProperty("dueSoonIssued").GetDecimal() >= 1_000m);
        Assert.True(summary.GetProperty("laterIssued").GetDecimal() >= 10_000m);
        Assert.True(summary.GetProperty("overdueCount").GetInt32() >= 1);
    }

    [Fact]
    public async Task Link_ToAnActiveExpense_Only_AndOnlyOnce()
    {
        var token = await ManagerAsync();
        var account = await BankAsync();
        var expense = await TestFinance.AddEntryAsync(api.ConnectionString, account, "Expense", 12_000m);
        var income = await TestFinance.AddEntryAsync(api.ConnectionString, account, "Income", 50m);
        var voided = await TestFinance.AddEntryAsync(api.ConnectionString, account, "Expense", 70m, status: "Voided");

        Assert.Equal(HttpStatusCode.BadRequest, (await PostAsync(token, "/api/finance/cheques", new { direction = "Issued", serial = "L1", amount = 1m, partyName = "x", issueDate = D(TestFinance.Today), dueDate = D(TestFinance.Today), accountId = account, entryId = income.Id })).Response.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await PostAsync(token, "/api/finance/cheques", new { direction = "Issued", serial = "L2", amount = 1m, partyName = "x", issueDate = D(TestFinance.Today), dueDate = D(TestFinance.Today), accountId = account, entryId = voided.Id })).Response.StatusCode);
        var (ok, body) = await PostAsync(token, "/api/finance/cheques", new { direction = "Issued", serial = "L3", amount = 12_000m, partyName = "x", issueDate = D(TestFinance.Today), dueDate = D(TestFinance.Today), accountId = account, entryId = expense.Id });
        Assert.Equal(HttpStatusCode.Created, ok.StatusCode);
        Assert.Equal(expense.EntryNo, body.GetProperty("entryNo").GetString());
        Assert.Equal(HttpStatusCode.BadRequest, (await PostAsync(token, "/api/finance/cheques", new { direction = "Issued", serial = "L4", amount = 12_000m, partyName = "x", issueDate = D(TestFinance.Today), dueDate = D(TestFinance.Today), accountId = account, entryId = expense.Id })).Response.StatusCode);
    }

    [Fact]
    public async Task Update_FixesAnOpenCheque()
    {
        var token = await ManagerAsync();
        var account = await BankAsync();
        var (_, cheque) = await IssueAsync(token, account, "U1", 100m, dueInDays: 5);
        var id = cheque.GetProperty("id").GetInt32();

        var response = await api.Client.SendAsync(Req(HttpMethod.Put, $"/api/finance/cheques/{id}", token, JsonContent.Create(new
        {
            serial = "U1", amount = 150m, partyName = "Corrected Name", issueDate = D(TestFinance.Today.AddDays(-2)), dueDate = D(TestFinance.Today.AddDays(30)), accountId = account,
        })));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await TestWorkers.ReadJsonAsync(response);
        Assert.Equal(150m, body.GetProperty("amount").GetDecimal());
        Assert.Equal("Corrected Name", body.GetProperty("partyName").GetString());
        Assert.Single(await TestFinance.AuditAsync(api.ConnectionString, "FinChequeUpdated", id.ToString()));
    }

    [Fact]
    public async Task Access_ManagerWrites_PartnerReads_OthersAreRefused()
    {
        var partner = (await TestWorkers.SignInAsync(api, Roles.Viewer)).Token;
        Assert.Equal(HttpStatusCode.OK, (await api.Client.SendAsync(Req(HttpMethod.Get, "/api/finance/cheques", partner))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await api.Client.SendAsync(Req(HttpMethod.Get, "/api/finance/cheques/summary", partner))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await PostAsync(partner, "/api/finance/cheques", new { direction = "Issued" })).Response.StatusCode);
        var supervisor = (await TestWorkers.SignInAsync(api, Roles.Supervisor)).Token;
        Assert.Equal(HttpStatusCode.Forbidden, (await api.Client.SendAsync(Req(HttpMethod.Get, "/api/finance/cheques", supervisor))).StatusCode);
    }
}
