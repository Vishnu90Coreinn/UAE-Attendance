using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>Payees (saved names with a default category) and expenses split between categories.</summary>
public class FinanceSplitAndPayeeTests(ReceiptsFixture api) : IClassFixture<ReceiptsFixture>
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

    private static MultipartFormDataContent Form(int accountId, decimal amount, string? linesJson = null, int? categoryId = 1, string? party = "Landlord LLC", int? payeeId = null)
    {
        var form = new MultipartFormDataContent
        {
            { new StringContent(D(TestFinance.Today)), "entryDate" },
            { new StringContent(accountId.ToString()), "accountId" },
            { new StringContent(amount.ToString(System.Globalization.CultureInfo.InvariantCulture)), "amount" },
        };
        if (categoryId is not null) form.Add(new StringContent(categoryId.ToString()!), "categoryId");
        if (party is not null) form.Add(new StringContent(party), "party");
        if (payeeId is not null) form.Add(new StringContent(payeeId.ToString()!), "payeeId");
        if (linesJson is not null) form.Add(new StringContent(linesJson), "linesJson");
        var file = new ByteArrayContent(Pdf);
        file.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        form.Add(file, "files", "receipt.pdf");
        return form;
    }

    private async Task<(HttpResponseMessage Response, JsonElement Body)> PostExpenseAsync(MultipartFormDataContent form, string token)
    {
        var response = await api.Client.SendAsync(Req(HttpMethod.Post, "/api/finance/expenses", token, form));
        return (response, await TestWorkers.ReadJsonAsync(response));
    }

    private async Task<int> AccountAsync() => (await TestFinance.AddAccountAsync(api.ConnectionString, opening: 50_000m)).Id;

    // --- split expenses ---------------------------------------------------------------------------------------

    [Fact]
    public async Task Split_SavesEveryLine_AndTheEntryKeepsItsFullAmount()
    {
        var token = await ManagerAsync();
        var account = await AccountAsync();
        // The real case: AED 5,000 paid to the agent = 2,000 deposit + 3,000 commission.
        var lines = "[{\"categoryId\":5,\"amount\":2000,\"note\":\"Security deposit\"},{\"categoryId\":9,\"amount\":3000,\"note\":\"Agency commission\"}]";

        var (response, body) = await PostExpenseAsync(Form(account, 5000m, lines, categoryId: null), token);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal(5000m, body.GetProperty("amount").GetDecimal());
        var saved = body.GetProperty("lines").EnumerateArray().ToList();
        Assert.Equal(2, saved.Count);
        Assert.Equal([3000m, 2000m], saved.Select(l => l.GetProperty("amount").GetDecimal()));   // largest first
        Assert.Equal("Commission for Labor", body.GetProperty("categoryName").GetString());        // the entry's own category is the largest line's
        var accounts = await (await api.Client.SendAsync(Req(HttpMethod.Get, "/api/finance/accounts", token))).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(45_000m, accounts.EnumerateArray().Single(a => a.GetProperty("id").GetInt32() == account).GetProperty("balance").GetDecimal());
    }

    [Fact]
    public async Task Split_RefusesLinesThatDoNotAddUpToTheAmount()
    {
        var token = await ManagerAsync();
        var account = await AccountAsync();

        var (response, body) = await PostExpenseAsync(Form(account, 5000m, "[{\"categoryId\":5,\"amount\":2000},{\"categoryId\":9,\"amount\":2500}]", categoryId: null), token);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("add up", body.GetProperty("errors").GetProperty("lines")[0].GetString());
    }

    [Theory]
    [InlineData("not json")]
    [InlineData("[]")]
    [InlineData("[{\"categoryId\":999,\"amount\":5000}]")]
    [InlineData("[{\"categoryId\":10,\"amount\":5000}]")]                      // an income category on an expense
    [InlineData("[{\"categoryId\":5,\"amount\":0},{\"categoryId\":9,\"amount\":5000}]")]
    [InlineData("[{\"categoryId\":5,\"amount\":2500.005},{\"categoryId\":9,\"amount\":2499.995}]")]
    public async Task Split_RefusesBadLines(string lines)
    {
        var token = await ManagerAsync();
        var account = await AccountAsync();

        var (response, body) = await PostExpenseAsync(Form(account, 5000m, lines, categoryId: null), token);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.True(body.GetProperty("errors").TryGetProperty("lines", out _));
    }

    private async Task<(Dictionary<string, decimal> Categories, decimal Expense, int Entries)> ReportAsync(string token)
    {
        var day = D(TestFinance.Today);
        var report = await (await api.Client.SendAsync(Req(HttpMethod.Get, $"/api/finance/reports/summary?from={day}&to={day}", token))).Content.ReadFromJsonAsync<JsonElement>();
        var categories = report.GetProperty("expenseCategories").EnumerateArray().ToDictionary(c => c.GetProperty("name").GetString()!, c => c.GetProperty("amount").GetDecimal());
        return (categories, report.GetProperty("period").GetProperty("expense").GetDecimal(), report.GetProperty("entryCount").GetInt32());
    }

    [Fact]
    public async Task Split_ReportCountsEachCategoryForItsOwnPart_AndTheEntryOnce()
    {
        var token = await ManagerAsync();
        var account = await AccountAsync();
        var before = await ReportAsync(token);
        await PostExpenseAsync(Form(account, 5000m, "[{\"categoryId\":5,\"amount\":2000},{\"categoryId\":9,\"amount\":3000}]", categoryId: null), token);
        await PostExpenseAsync(Form(account, 1000m), token);   // one ordinary line: Company expenses

        var after = await ReportAsync(token);
        Assert.Equal(3000m, after.Categories["Commission for Labor"] - before.Categories.GetValueOrDefault("Commission for Labor"));
        Assert.Equal(2000m, after.Categories["Worker Accommodation Rent"] - before.Categories.GetValueOrDefault("Worker Accommodation Rent"));
        Assert.Equal(1000m, after.Categories["Company expenses"] - before.Categories.GetValueOrDefault("Company expenses"));
        Assert.Equal(6000m, after.Expense - before.Expense);
        Assert.Equal(after.Expense, after.Categories.Values.Sum());   // the categories always add up to the period's expense
        Assert.Equal(2, after.Entries - before.Entries);              // two entries, not three lines
    }

    [Fact]
    public async Task Split_CanBeFilteredByAnyOfItsCategories_AndCorrectedIntoOneLine()
    {
        var token = await ManagerAsync();
        var account = await AccountAsync();
        var (_, created) = await PostExpenseAsync(Form(account, 5000m, "[{\"categoryId\":5,\"amount\":2000},{\"categoryId\":9,\"amount\":3000}]", categoryId: null, party: "Agent Split"), token);

        var byDeposit = await (await api.Client.SendAsync(Req(HttpMethod.Get, $"/api/finance/expenses?categoryId=5&q=Agent Split", token))).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Single(byDeposit.GetProperty("items").EnumerateArray());

        var id = created.GetProperty("id").GetInt32();
        var correct = await api.Client.SendAsync(Req(HttpMethod.Put, $"/api/finance/expenses/{id}", token, Form(account, 5000m, null, categoryId: 5, party: "Agent Split")));
        Assert.Equal(HttpStatusCode.Created, correct.StatusCode);
        var corrected = await TestWorkers.ReadJsonAsync(correct);
        Assert.Single(corrected.GetProperty("lines").EnumerateArray());
        var rent = await (await api.Client.SendAsync(Req(HttpMethod.Get, "/api/finance/expenses?categoryId=9&q=Agent Split", token))).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Empty(rent.GetProperty("items").EnumerateArray());   // the voided original no longer lists
    }

    // --- payees -----------------------------------------------------------------------------------------------

    private async Task<JsonElement> CreatePayeeAsync(string token, string name, string kind = "Expense", int? category = 5)
    {
        var response = await api.Client.SendAsync(Req(HttpMethod.Post, "/api/finance/payees", token, JsonContent.Create(new { kind, name, defaultCategoryId = category, phone = "04 000 0000" })));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await TestWorkers.ReadJsonAsync(response);
    }

    [Fact]
    public async Task Payee_CreateListUpdate_AndNamesAreUniquePerType()
    {
        var token = await ManagerAsync();
        var name = TestFinance.Unique("Landlord");
        var payee = await CreatePayeeAsync(token, name);
        Assert.Equal("Worker Accommodation Rent", payee.GetProperty("defaultCategoryName").GetString());

        var duplicate = await api.Client.SendAsync(Req(HttpMethod.Post, "/api/finance/payees", token, JsonContent.Create(new { kind = "Expense", name = name.ToUpperInvariant() })));
        Assert.Equal(HttpStatusCode.BadRequest, duplicate.StatusCode);
        await CreatePayeeAsync(token, name, "Income", 10);   // the same name may also be an income source

        var id = payee.GetProperty("id").GetInt32();
        var update = await api.Client.SendAsync(Req(HttpMethod.Put, $"/api/finance/payees/{id}", token, JsonContent.Create(new { name, defaultCategoryId = 9, isActive = false })));
        Assert.Equal(HttpStatusCode.OK, update.StatusCode);
        var list = await (await api.Client.SendAsync(Req(HttpMethod.Get, "/api/finance/payees?kind=Expense", token))).Content.ReadFromJsonAsync<JsonElement>();
        Assert.DoesNotContain(list.EnumerateArray(), p => p.GetProperty("id").GetInt32() == id);   // switched off: hidden from the pickers
        var all = await (await api.Client.SendAsync(Req(HttpMethod.Get, "/api/finance/payees?kind=Expense&includeInactive=true", token))).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains(all.EnumerateArray(), p => p.GetProperty("id").GetInt32() == id);
    }

    [Fact]
    public async Task Payee_RefusesACategoryOfTheOtherType()
    {
        var token = await ManagerAsync();
        var response = await api.Client.SendAsync(Req(HttpMethod.Post, "/api/finance/payees", token, JsonContent.Create(new { kind = "Expense", name = TestFinance.Unique("P"), defaultCategoryId = 10 })));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Entry_WithAPayee_TakesItsName_AndShowsInThePayeesTotals()
    {
        var token = await ManagerAsync();
        var account = await AccountAsync();
        var name = TestFinance.Unique("Insurer");
        var payee = await CreatePayeeAsync(token, name, "Expense", 8);
        var payeeId = payee.GetProperty("id").GetInt32();

        var (response, body) = await PostExpenseAsync(Form(account, 700m, categoryId: 8, party: "ignored text", payeeId: payeeId), token);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal(name, body.GetProperty("party").GetString());
        Assert.Equal(payeeId, body.GetProperty("payeeId").GetInt32());
        await PostExpenseAsync(Form(account, 300m, categoryId: 8, party: null, payeeId: payeeId), token);

        var list = await (await api.Client.SendAsync(Req(HttpMethod.Get, "/api/finance/payees?kind=Expense", token))).Content.ReadFromJsonAsync<JsonElement>();
        var row = list.EnumerateArray().Single(p => p.GetProperty("id").GetInt32() == payeeId);
        Assert.Equal(2, row.GetProperty("entryCount").GetInt32());
        Assert.Equal(1000m, row.GetProperty("total").GetDecimal());
        var byPayee = await (await api.Client.SendAsync(Req(HttpMethod.Get, $"/api/finance/expenses?payeeId={payeeId}", token))).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1000m, byPayee.GetProperty("total").GetDecimal());
    }

    [Fact]
    public async Task Entry_RefusesAPayeeThatIsSwitchedOffOrOfTheOtherType()
    {
        var token = await ManagerAsync();
        var account = await AccountAsync();
        var income = await CreatePayeeAsync(token, TestFinance.Unique("Client"), "Income", 10);

        var (response, body) = await PostExpenseAsync(Form(account, 50m, payeeId: income.GetProperty("id").GetInt32()), token);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.True(body.GetProperty("errors").TryGetProperty("payeeId", out _));
    }

    [Fact]
    public async Task Payees_AreForManagersAndAdmins_APartnerOnlyReads()
    {
        var partner = (await TestWorkers.SignInAsync(api, Roles.Viewer)).Token;
        Assert.Equal(HttpStatusCode.OK, (await api.Client.SendAsync(Req(HttpMethod.Get, "/api/finance/payees", partner))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await api.Client.SendAsync(Req(HttpMethod.Post, "/api/finance/payees", partner, JsonContent.Create(new { kind = "Expense", name = "x" })))).StatusCode);
        var hr = (await TestWorkers.SignInAsync(api, Roles.HR)).Token;
        Assert.Equal(HttpStatusCode.Forbidden, (await api.Client.SendAsync(Req(HttpMethod.Get, "/api/finance/payees", hr))).StatusCode);
    }
}
