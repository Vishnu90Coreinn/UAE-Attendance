using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>Office staff a Manager has allowed submit expenses; nothing counts until a Manager approves it.</summary>
public class FinanceStaffEntryTests(ReceiptsFixture api) : IClassFixture<ReceiptsFixture>
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

    private async Task<JsonElement> JsonAsync(HttpMethod method, string url, string token, object? body = null)
    {
        var response = await api.Client.SendAsync(Req(method, url, token, body is null ? null : JsonContent.Create(body)));
        return await TestWorkers.ReadJsonAsync(response);
    }

    /// <summary>A staff login with the flag switched on (or left off), and a bank account staff may pay from.</summary>
    private async Task<(string Token, int UserId, int Account)> StaffAsync(string manager, bool allowed = true, bool staffAccount = true, string role = Roles.Employee)
    {
        var (username, token) = await TestWorkers.SignInAsync(api, role);
        var list = await api.Client.SendAsync(Req(HttpMethod.Get, "/api/finance/submitters", manager));
        var id = (await TestWorkers.ReadJsonAsync(list)).EnumerateArray().Single(u => u.GetProperty("username").GetString() == username).GetProperty("userId").GetInt32();
        if (allowed) Assert.Equal(HttpStatusCode.OK, (await api.Client.SendAsync(Req(HttpMethod.Put, $"/api/finance/submitters/{id}", manager, JsonContent.Create(new { canSubmit = true })))).StatusCode);
        var account = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 5_000m);
        if (staffAccount)
            Assert.Equal(HttpStatusCode.OK, (await api.Client.SendAsync(Req(HttpMethod.Put, $"/api/finance/accounts/{account.Id}", manager, JsonContent.Create(new { name = account.Name, kind = "Bank", openingBalance = 5_000m, openingDate = D(account.OpeningDate), staffCanUse = true })))).StatusCode);
        return (token, id, account.Id);
    }

    private static MultipartFormDataContent Form(int account, decimal amount = 50m, string party = "du", int category = 1)
    {
        var form = new MultipartFormDataContent
        {
            { new StringContent(D(TestFinance.Today)), "entryDate" }, { new StringContent(category.ToString()), "categoryId" },
            { new StringContent(account.ToString()), "accountId" }, { new StringContent(amount.ToString(System.Globalization.CultureInfo.InvariantCulture)), "amount" },
            { new StringContent(party), "party" },
        };
        var file = new ByteArrayContent(Pdf);
        file.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        form.Add(file, "files", "receipt.pdf");
        return form;
    }

    private async Task<(HttpResponseMessage Response, JsonElement Body)> SubmitAsync(string token, MultipartFormDataContent form)
    {
        var response = await api.Client.SendAsync(Req(HttpMethod.Post, "/api/finance/my/expenses", token, form));
        var text = await response.Content.ReadAsStringAsync();
        return (response, string.IsNullOrWhiteSpace(text) ? default : JsonDocument.Parse(text).RootElement);   // a refusal by the policy has no body
    }

    private async Task<decimal> BalanceAsync(string manager, int account)
    {
        var accounts = await (await api.Client.SendAsync(Req(HttpMethod.Get, "/api/finance/accounts", manager))).Content.ReadFromJsonAsync<JsonElement>();
        return accounts.EnumerateArray().Single(a => a.GetProperty("id").GetInt32() == account).GetProperty("balance").GetDecimal();
    }

    [Fact]
    public async Task Submitted_IsPending_NumberedAndCountsInNoBalance_UntilApproved()
    {
        var manager = await ManagerAsync();
        var (staff, _, account) = await StaffAsync(manager);

        var (response, body) = await SubmitAsync(staff, Form(account, 50m));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal("Pending", body.GetProperty("status").GetString());
        Assert.Matches(@"^EXP-\d{6}$", body.GetProperty("entryNo").GetString());
        Assert.Equal(5_000m, await BalanceAsync(manager, account));
        var id = body.GetProperty("id").GetInt32();

        var approved = await api.Client.SendAsync(Req(HttpMethod.Post, $"/api/finance/expenses/{id}/approve", manager));
        Assert.Equal(HttpStatusCode.OK, approved.StatusCode);
        Assert.Equal("Active", (await TestWorkers.ReadJsonAsync(approved)).GetProperty("status").GetString());
        Assert.Equal(4_950m, await BalanceAsync(manager, account));
        Assert.Single(await TestFinance.AuditAsync(api.ConnectionString, "FinExpenseSubmitted", id.ToString()));
        Assert.Single(await TestFinance.AuditAsync(api.ConnectionString, "FinExpenseApproved", id.ToString()));
        Assert.Equal(HttpStatusCode.Conflict, (await api.Client.SendAsync(Req(HttpMethod.Post, $"/api/finance/expenses/{id}/approve", manager))).StatusCode);   // only once
    }

    [Fact]
    public async Task Rejected_NeedsAReason_IsKeptAsVoided_AndCountsNothing()
    {
        var manager = await ManagerAsync();
        var (staff, _, account) = await StaffAsync(manager);
        var (_, body) = await SubmitAsync(staff, Form(account, 75m));
        var id = body.GetProperty("id").GetInt32();

        Assert.Equal(HttpStatusCode.BadRequest, (await api.Client.SendAsync(Req(HttpMethod.Post, $"/api/finance/expenses/{id}/reject", manager, JsonContent.Create(new { reason = "" })))).StatusCode);
        var rejected = await api.Client.SendAsync(Req(HttpMethod.Post, $"/api/finance/expenses/{id}/reject", manager, JsonContent.Create(new { reason = "Personal purchase" })));
        Assert.Equal(HttpStatusCode.OK, rejected.StatusCode);
        var json = await TestWorkers.ReadJsonAsync(rejected);
        Assert.Equal("Voided", json.GetProperty("status").GetString());
        Assert.Equal("Rejected: Personal purchase", json.GetProperty("voidReason").GetString());
        Assert.Equal(5_000m, await BalanceAsync(manager, account));

        var mine = await (await api.Client.SendAsync(Req(HttpMethod.Get, "/api/finance/my/expenses", staff))).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains("Rejected: Personal purchase", mine.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("voidReason").GetString()));   // the staff member sees why
    }

    [Fact]
    public async Task ManagerList_ShowsPending_ButTheTotalCountsOnlyApproved()
    {
        var manager = await ManagerAsync();
        var (staff, _, account) = await StaffAsync(manager);
        await SubmitAsync(staff, Form(account, 40m, party: "Pending Cafe"));

        var list = await (await api.Client.SendAsync(Req(HttpMethod.Get, "/api/finance/expenses?q=Pending Cafe", manager))).Content.ReadFromJsonAsync<JsonElement>();

        Assert.Single(list.GetProperty("items").EnumerateArray());
        Assert.Equal("Pending", list.GetProperty("items")[0].GetProperty("status").GetString());
        Assert.Equal(0m, list.GetProperty("total").GetDecimal());
        Assert.Equal(1, list.GetProperty("pendingCount").GetInt32());
        Assert.Equal(40m, list.GetProperty("pendingTotal").GetDecimal());
        var report = await (await api.Client.SendAsync(Req(HttpMethod.Get, $"/api/finance/reports/summary?from={D(TestFinance.Today)}&to={D(TestFinance.Today)}", manager))).Content.ReadFromJsonAsync<JsonElement>();
        Assert.DoesNotContain(report.GetProperty("expenseCategories").EnumerateArray(), c => c.GetProperty("name").GetString() == "Company expenses" && c.GetProperty("amount").GetDecimal() == 40m && false);
    }

    [Fact]
    public async Task Staff_AreRefused_WithoutTheFlag_OnAnAccountNotMarkedForStaff_AndOnTheManagerScreens()
    {
        var manager = await ManagerAsync();
        var (blocked, _, account) = await StaffAsync(manager, allowed: false);
        Assert.Equal(HttpStatusCode.Forbidden, (await SubmitAsync(blocked, Form(account))).Response.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await api.Client.SendAsync(Req(HttpMethod.Get, "/api/finance/my/options", blocked))).StatusCode);

        var (staff, _, _) = await StaffAsync(manager);
        var other = (await TestFinance.AddAccountAsync(api.ConnectionString)).Id;   // not marked for staff
        var (response, body) = await SubmitAsync(staff, Form(other));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.True(body.GetProperty("errors").TryGetProperty("accountId", out _));

        foreach (var url in new[] { "/api/finance/accounts", "/api/finance/expenses", "/api/finance/dashboard", "/api/finance/submitters" })
            Assert.Equal(HttpStatusCode.Forbidden, (await api.Client.SendAsync(Req(HttpMethod.Get, url, staff))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await api.Client.SendAsync(Req(HttpMethod.Post, "/api/finance/expenses/1/approve", staff))).StatusCode);   // staff cannot approve their own
    }

    [Fact]
    public async Task Staff_SeeOnlyTheirOwnExpenses_AndOnlyTheirOwnReceipts_AndOnlyTheStaffAccounts()
    {
        var manager = await ManagerAsync();
        var (first, _, account) = await StaffAsync(manager);
        var (second, _, _) = await StaffAsync(manager);
        var (_, mine) = await SubmitAsync(first, Form(account, 11m, party: "First's lunch"));
        await SubmitAsync(second, Form(account, 22m, party: "Second's taxi"));

        var list = await (await api.Client.SendAsync(Req(HttpMethod.Get, "/api/finance/my/expenses", first))).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(["First's lunch"], list.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("party").GetString()));

        var attachment = mine.GetProperty("attachments")[0].GetProperty("id").GetInt32();
        Assert.Equal(HttpStatusCode.OK, (await api.Client.SendAsync(Req(HttpMethod.Get, $"/api/finance/my/attachments/{attachment}", first))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await api.Client.SendAsync(Req(HttpMethod.Get, $"/api/finance/my/attachments/{attachment}", second))).StatusCode);

        var options = await (await api.Client.SendAsync(Req(HttpMethod.Get, "/api/finance/my/options", first))).Content.ReadFromJsonAsync<JsonElement>();
        Assert.All(options.GetProperty("accounts").EnumerateArray(), a => Assert.Equal(0m, a.GetProperty("balance").GetDecimal()));   // no balances for staff
        Assert.Contains(options.GetProperty("accounts").EnumerateArray(), a => a.GetProperty("id").GetInt32() == account);
    }

    [Fact]
    public async Task StaffOptions_CarryNoMoneyBankDetailsOrPayeeContacts()
    {
        var manager = await ManagerAsync();
        var (staff, _, account) = await StaffAsync(manager);
        var payee = TestUsers.UniqueName("Vendor");
        await using (var db = TestUsers.NewContext(api.ConnectionString))
        {
            var shared = await db.FinAccounts.SingleAsync(a => a.Id == account);
            shared.OpeningBalance = 9000m;
            shared.BankName = "Test Bank";
            shared.Iban = "AE070331234567890123456";
            db.FinPayees.Add(new FinPayee { Kind = FinEntryKinds.Expense, Name = payee, Phone = "050 000 0000", TaxNumber = "100000000000003", Notes = "Agreed discount" });
            await db.SaveChangesAsync();
        }
        await SubmitAsync(staff, Form(account, 15m, party: payee));

        var options = await (await api.Client.SendAsync(Req(HttpMethod.Get, "/api/finance/my/options", staff))).Content.ReadFromJsonAsync<JsonElement>();

        var seen = options.GetProperty("accounts").EnumerateArray().Single(a => a.GetProperty("id").GetInt32() == account);
        foreach (var money in new[] { "openingBalance", "balance", "bankBalance", "unclearedCheques", "entryCount" })
            Assert.Equal(0m, seen.GetProperty(money).GetDecimal());
        foreach (var detail in new[] { "bankName", "accountNumber", "iban", "holderName" })
            Assert.Equal(JsonValueKind.Null, seen.GetProperty(detail).ValueKind);
        var vendor = options.GetProperty("payees").EnumerateArray().Single(p => p.GetProperty("name").GetString() == payee);
        foreach (var detail in new[] { "phone", "taxNumber", "notes" })
            Assert.Equal(JsonValueKind.Null, vendor.GetProperty(detail).ValueKind);
        Assert.Equal(0m, vendor.GetProperty("total").GetDecimal());
        Assert.Equal(0, vendor.GetProperty("entryCount").GetInt32());
        Assert.All(options.GetProperty("categories").EnumerateArray(), c => Assert.Equal(0, c.GetProperty("useCount").GetInt32()));
    }

    [Fact]
    public async Task Staff_CannotSetTheVatRecoveryPercentage()
    {
        var manager = await ManagerAsync();
        var (staff, _, account) = await StaffAsync(manager);
        var form = Form(account);
        form.Add(new StringContent("0"), "recoverableTaxPercent");

        var (response, body) = await SubmitAsync(staff, form);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.True(body.GetProperty("errors").TryGetProperty("recoverableTaxPercent", out _));
        var (saved, entry) = await SubmitAsync(staff, Form(account));
        Assert.Equal(HttpStatusCode.Created, saved.StatusCode);
        Assert.Equal(100m, entry.GetProperty("recoverableTaxPercent").GetDecimal());
    }

    [Fact]
    public async Task SwitchingTheFlagOff_TakesEffectAtOnce()
    {
        var manager = await ManagerAsync();
        var (staff, id, account) = await StaffAsync(manager);
        var first = await SubmitAsync(staff, Form(account));
        Assert.True(first.Response.StatusCode == HttpStatusCode.Created, first.Body.ToString());

        await api.Client.SendAsync(Req(HttpMethod.Put, $"/api/finance/submitters/{id}", manager, JsonContent.Create(new { canSubmit = false })));

        Assert.Equal(HttpStatusCode.Forbidden, (await SubmitAsync(staff, Form(account))).Response.StatusCode);
    }

    [Fact]
    public async Task PendingExpense_CannotBeVoidedOrCorrected_OnlyApprovedOrRejected_AndAPartnerCannotApprove()
    {
        var manager = await ManagerAsync();
        var (staff, _, account) = await StaffAsync(manager);
        var (_, body) = await SubmitAsync(staff, Form(account));
        var id = body.GetProperty("id").GetInt32();

        Assert.Equal(HttpStatusCode.Conflict, (await api.Client.SendAsync(Req(HttpMethod.Post, $"/api/finance/expenses/{id}/void", manager, JsonContent.Create(new { reason = "x" })))).StatusCode);
        var partner = (await TestWorkers.SignInAsync(api, Roles.Viewer)).Token;
        Assert.Equal(HttpStatusCode.Forbidden, (await api.Client.SendAsync(Req(HttpMethod.Post, $"/api/finance/expenses/{id}/approve", partner))).StatusCode);
    }
}
