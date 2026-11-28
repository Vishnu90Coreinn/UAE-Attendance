using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>Income: recorded like an expense, but the attachment is optional and it raises the balance.</summary>
public class FinanceIncomeTests(ReceiptsFixture api) : IClassFixture<ReceiptsFixture>
{
    private static readonly byte[] Pdf = "%PDF-1.4\n1 0 obj\n<<>>\nendobj\n"u8.ToArray();
    private static string D(DateOnly date) => date.ToString("yyyy-MM-dd");
    private async Task<string> ManagerAsync() => (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;

    private static MultipartFormDataContent Form(int accountId, int categoryId = 10, decimal amount = 5000m, string? party = "One by Binghatti",
        DateOnly? date = null, bool withFile = false)
    {
        var form = new MultipartFormDataContent
        {
            { new StringContent(D(date ?? TestFinance.Today)), "entryDate" },
            { new StringContent(categoryId.ToString()), "categoryId" },
            { new StringContent(accountId.ToString()), "accountId" },
            { new StringContent(amount.ToString(System.Globalization.CultureInfo.InvariantCulture)), "amount" },
        };
        if (party is not null) form.Add(new StringContent(party), "party");
        if (withFile)
        {
            var part = new ByteArrayContent(Pdf);
            part.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
            form.Add(part, "files", "remittance.pdf");
        }

        return form;
    }

    private Task<HttpResponseMessage> PostAsync(MultipartFormDataContent form, string token)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/finance/income") { Content = form };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return api.Client.SendAsync(request);
    }

    private async Task<int> AccountAsync(decimal opening = 100m) => (await TestFinance.AddAccountAsync(api.ConnectionString, opening: opening)).Id;

    [Fact]
    public async Task Create_NeedsNoAttachment_NumbersItIncAndAuditsIt()
    {
        var response = await PostAsync(Form(await AccountAsync()), await ManagerAsync());

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await TestWorkers.ReadJsonAsync(response);
        Assert.Matches(@"^INC-\d{6}$", body.GetProperty("entryNo").GetString());
        Assert.Equal("Income", body.GetProperty("kind").GetString());
        Assert.Equal("Other income", body.GetProperty("categoryName").GetString());
        Assert.Empty(body.GetProperty("attachments").EnumerateArray());
        Assert.Single(await TestFinance.AuditAsync(api.ConnectionString, "FinIncomeCreated", body.GetProperty("id").GetInt32().ToString()));
    }

    [Fact]
    public async Task Create_CanCarryAnAttachment()
    {
        var response = await PostAsync(Form(await AccountAsync(), withFile: true), await ManagerAsync());
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Single((await TestWorkers.ReadJsonAsync(response)).GetProperty("attachments").EnumerateArray());
    }

    [Fact]
    public async Task Create_RaisesTheAccountBalance()
    {
        var token = await ManagerAsync();
        var account = await AccountAsync(opening: 100m);
        await PostAsync(Form(account, amount: 111767.04m), token);

        var accounts = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/finance/accounts", token));

        Assert.Equal(111867.04m, accounts.EnumerateArray().Single(a => a.GetProperty("id").GetInt32() == account).GetProperty("balance").GetDecimal());
    }

    [Fact]
    public async Task Create_RefusesAnExpenseCategory_AndMissingReceivedFrom()
    {
        var response = await PostAsync(Form(await AccountAsync(), categoryId: 1, party: " "), await ManagerAsync());

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var errors = (await TestWorkers.ReadJsonAsync(response)).GetProperty("errors");
        Assert.True(errors.TryGetProperty("categoryId", out _));
        Assert.Contains("received from", errors.GetProperty("party")[0].GetString());
    }

    [Fact]
    public async Task List_ShowsOnlyIncome_WithItsTotal_AndExpensesDoNotLeakIn()
    {
        var token = await ManagerAsync();
        var account = await AccountAsync(opening: 0m);
        await TestFinance.AddEntryAsync(api.ConnectionString, account, FinEntryKinds.Income, 300m);
        await TestFinance.AddEntryAsync(api.ConnectionString, account, FinEntryKinds.Income, 700m, status: FinStatuses.Voided);
        await TestFinance.AddEntryAsync(api.ConnectionString, account, FinEntryKinds.Expense, 55m);

        var income = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/finance/income?accountId={account}", token));
        var expenses = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/finance/expenses?accountId={account}", token));

        Assert.Equal(300m, income.GetProperty("total").GetDecimal());
        Assert.Equal(1, income.GetProperty("count").GetInt32());
        Assert.Equal(55m, expenses.GetProperty("total").GetDecimal());
    }

    [Fact]
    public async Task Get_IsNotFoundForAnExpenseId()
    {
        var token = await ManagerAsync();
        var expense = await TestFinance.AddEntryAsync(api.ConnectionString, await AccountAsync(), FinEntryKinds.Expense, 10m);
        Assert.Equal(HttpStatusCode.NotFound, (await api.GetAsync($"/api/finance/income/{expense.Id}", token)).StatusCode);
    }

    [Fact]
    public async Task Parties_ListsOnlyIncomeSources()
    {
        var token = await ManagerAsync();
        var name = "Client " + Guid.NewGuid().ToString("N")[..8];
        await PostAsync(Form(await AccountAsync(), party: name), token);

        var parties = (await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/finance/income/parties", token))).EnumerateArray().Select(p => p.GetString()).ToList();

        Assert.Equal(name, parties[0]);
        Assert.DoesNotContain("Royal Palm Business Center", parties);
    }
}
