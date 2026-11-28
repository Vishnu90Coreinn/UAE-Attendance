using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>Petty cash held by a staff member: an advance is a transfer, their approved expenses spend it, the rest can be returned.</summary>
public class FinancePettyCashTests(ReceiptsFixture api) : IClassFixture<ReceiptsFixture>
{
    private static readonly byte[] Pdf = "%PDF-1.4\n1 0 obj\n<<>>\nendobj\n"u8.ToArray();
    private static string D(DateOnly date) => date.ToString("yyyy-MM-dd");
    private async Task<string> ManagerAsync() => (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;

    private HttpRequestMessage Req(HttpMethod method, string url, string token, HttpContent? content = null)
    {
        var r = new HttpRequestMessage(method, url) { Content = content };
        r.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return r;
    }

    private async Task<(HttpResponseMessage Response, JsonElement Body)> SendAsync(HttpMethod method, string url, string token, object? body = null)
    {
        var response = await api.Client.SendAsync(Req(method, url, token, body is null ? null : JsonContent.Create(body)));
        var text = await response.Content.ReadAsStringAsync();
        return (response, string.IsNullOrWhiteSpace(text) ? default : JsonDocument.Parse(text).RootElement);
    }

    private async Task<(string Token, int UserId)> StaffAsync(string manager, bool allowed = true)
    {
        var (username, token) = await TestWorkers.SignInAsync(api, Roles.Employee);
        var list = (await SendAsync(HttpMethod.Get, "/api/finance/submitters", manager)).Body;
        var id = list.EnumerateArray().Single(u => u.GetProperty("username").GetString() == username).GetProperty("userId").GetInt32();
        if (allowed) await SendAsync(HttpMethod.Put, $"/api/finance/submitters/{id}", manager, new { canSubmit = true });
        return (token, id);
    }

    private async Task<(HttpResponseMessage Response, JsonElement Body)> CustodyAsync(string manager, int? holder, decimal opening = 0m, string? name = null) =>
        await SendAsync(HttpMethod.Post, "/api/finance/accounts", manager, new
        {
            name = name ?? TestFinance.Unique("Petty"), kind = "Custody", openingBalance = opening, openingDate = D(TestFinance.Today.AddDays(-60)), holderUserId = holder,
        });

    private async Task<decimal> BalanceAsync(string manager, int account)
    {
        var accounts = (await SendAsync(HttpMethod.Get, "/api/finance/accounts", manager)).Body;
        return accounts.EnumerateArray().Single(a => a.GetProperty("id").GetInt32() == account).GetProperty("balance").GetDecimal();
    }

    private static MultipartFormDataContent Form(int account, decimal amount)
    {
        var form = new MultipartFormDataContent
        {
            { new StringContent(D(TestFinance.Today)), "entryDate" }, { new StringContent("1"), "categoryId" }, { new StringContent(account.ToString()), "accountId" },
            { new StringContent(amount.ToString(System.Globalization.CultureInfo.InvariantCulture)), "amount" }, { new StringContent("Site shop"), "party" },
        };
        var file = new ByteArrayContent(Pdf);
        file.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        form.Add(file, "files", "receipt.pdf");
        return form;
    }

    [Fact]
    public async Task Custody_NeedsAStaffHolder_OnePerPerson_AndShowsTheHoldersName()
    {
        var manager = await ManagerAsync();
        var (_, holder) = await StaffAsync(manager);

        var (noHolder, noHolderBody) = await CustodyAsync(manager, null);
        Assert.Equal(HttpStatusCode.BadRequest, noHolder.StatusCode);
        Assert.True(noHolderBody.GetProperty("errors").TryGetProperty("holderUserId", out _));

        var (created, body) = await CustodyAsync(manager, holder);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Equal("Custody", body.GetProperty("kind").GetString());
        Assert.Equal(holder, body.GetProperty("holderUserId").GetInt32());
        Assert.False(string.IsNullOrEmpty(body.GetProperty("holderName").GetString()));
        Assert.Equal(HttpStatusCode.BadRequest, (await CustodyAsync(manager, holder)).Response.StatusCode);   // a second account for the same person

        var managerUser = (await SendAsync(HttpMethod.Get, "/api/finance/submitters", manager)).Body;   // managers are not office staff, so cannot hold petty cash
        Assert.DoesNotContain(managerUser.EnumerateArray(), u => u.GetProperty("role").GetString() == "Manager");
        var (bank, _) = await SendAsync(HttpMethod.Post, "/api/finance/accounts", manager, new { name = TestFinance.Unique("Bank"), kind = "Bank", openingBalance = 0, openingDate = D(TestFinance.Today.AddDays(-5)), holderUserId = holder });
        Assert.Equal(HttpStatusCode.Created, bank.StatusCode);   // a holder on a non-custody account is simply ignored
    }

    [Fact]
    public async Task Advance_MovesCashToTheHolder_WithoutChangingTheCompanysTotal_AndReturnPutsItBack()
    {
        var manager = await ManagerAsync();
        var (_, holder) = await StaffAsync(manager);
        var main = (await TestFinance.AddAccountAsync(api.ConnectionString, opening: 10_000m)).Id;
        var custody = (await CustodyAsync(manager, holder)).Body.GetProperty("id").GetInt32();

        var advance = await SendAsync(HttpMethod.Post, "/api/finance/transfers", manager, new { transferDate = D(TestFinance.Today), fromAccountId = main, toAccountId = custody, amount = 1_500m, notes = "Site petty cash" });
        Assert.Equal(HttpStatusCode.Created, advance.Response.StatusCode);
        Assert.Equal(8_500m, await BalanceAsync(manager, main));
        Assert.Equal(1_500m, await BalanceAsync(manager, custody));

        var back = await SendAsync(HttpMethod.Post, "/api/finance/transfers", manager, new { transferDate = D(TestFinance.Today), fromAccountId = custody, toAccountId = main, amount = 400m, notes = "Unspent" });
        Assert.Equal(HttpStatusCode.Created, back.Response.StatusCode);
        Assert.Equal(8_900m, await BalanceAsync(manager, main));
        Assert.Equal(1_100m, await BalanceAsync(manager, custody));
    }

    [Fact]
    public async Task TheHolder_SpendsTheirCustody_AfterApproval_WithoutTheAccountBeingMarkedForStaff()
    {
        var manager = await ManagerAsync();
        var (staff, holder) = await StaffAsync(manager);
        var main = (await TestFinance.AddAccountAsync(api.ConnectionString, opening: 10_000m)).Id;
        var custody = (await CustodyAsync(manager, holder)).Body.GetProperty("id").GetInt32();
        await SendAsync(HttpMethod.Post, "/api/finance/transfers", manager, new { transferDate = D(TestFinance.Today), fromAccountId = main, toAccountId = custody, amount = 1_000m });

        var options = (await SendAsync(HttpMethod.Get, "/api/finance/my/options", staff)).Body;
        var mine = options.GetProperty("accounts").EnumerateArray().Single(a => a.GetProperty("id").GetInt32() == custody);
        Assert.Equal(1_000m, mine.GetProperty("balance").GetDecimal());   // they can see what they hold
        Assert.DoesNotContain(options.GetProperty("accounts").EnumerateArray(), a => a.GetProperty("id").GetInt32() == main);

        var submit = await api.Client.SendAsync(Req(HttpMethod.Post, "/api/finance/my/expenses", staff, Form(custody, 120m)));
        Assert.Equal(HttpStatusCode.Created, submit.StatusCode);
        var id = (await TestWorkers.ReadJsonAsync(submit)).GetProperty("id").GetInt32();
        Assert.Equal(1_000m, await BalanceAsync(manager, custody));   // pending: not spent yet

        Assert.Equal(HttpStatusCode.OK, (await SendAsync(HttpMethod.Post, $"/api/finance/expenses/{id}/approve", manager)).Response.StatusCode);
        Assert.Equal(880m, await BalanceAsync(manager, custody));
        Assert.Equal(9_000m, await BalanceAsync(manager, main));
    }

    [Fact]
    public async Task SomeoneElsesCustody_IsNotOpenToOtherStaff()
    {
        var manager = await ManagerAsync();
        var (_, holder) = await StaffAsync(manager);
        var (other, _) = await StaffAsync(manager);
        var custody = (await CustodyAsync(manager, holder)).Body.GetProperty("id").GetInt32();

        var options = (await SendAsync(HttpMethod.Get, "/api/finance/my/options", other)).Body;
        Assert.DoesNotContain(options.GetProperty("accounts").EnumerateArray(), a => a.GetProperty("id").GetInt32() == custody);
        var submit = await api.Client.SendAsync(Req(HttpMethod.Post, "/api/finance/my/expenses", other, Form(custody, 20m)));
        Assert.Equal(HttpStatusCode.BadRequest, submit.StatusCode);
    }

    [Fact]
    public async Task ChequesBelongToBankAccounts_NotToPettyCash()
    {
        var manager = await ManagerAsync();
        var (_, holder) = await StaffAsync(manager);
        var custody = (await CustodyAsync(manager, holder)).Body.GetProperty("id").GetInt32();
        var (response, _) = await SendAsync(HttpMethod.Post, "/api/finance/cheques", manager, new { direction = "Issued", serial = "P1", amount = 5m, partyName = "x", issueDate = D(TestFinance.Today), dueDate = D(TestFinance.Today), accountId = custody });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
