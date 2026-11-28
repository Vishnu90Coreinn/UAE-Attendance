using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>Voiding, correcting (original kept, replacement linked) and month locks, for expenses, income and transfers.</summary>
public class FinanceCorrectionTests(ReceiptsFixture api) : IClassFixture<ReceiptsFixture>
{
    private static readonly byte[] Pdf = "%PDF-1.4\n1 0 obj\n<<>>\nendobj\n"u8.ToArray();
    private static string D(DateOnly date) => date.ToString("yyyy-MM-dd");
    private async Task<string> ManagerAsync() => (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;

    private static MultipartFormDataContent Form(int accountId, decimal amount = 100m, DateOnly? date = null, string party = "Supplier A", int categoryId = 1,
        bool withFile = true, params int[] keep)
    {
        var form = new MultipartFormDataContent
        {
            { new StringContent(D(date ?? TestFinance.Today)), "entryDate" },
            { new StringContent(categoryId.ToString()), "categoryId" },
            { new StringContent(accountId.ToString()), "accountId" },
            { new StringContent(amount.ToString(System.Globalization.CultureInfo.InvariantCulture)), "amount" },
            { new StringContent(party), "party" },
        };
        foreach (var id in keep) form.Add(new StringContent(id.ToString()), "keepAttachmentIds");
        if (withFile)
        {
            var part = new ByteArrayContent(Pdf);
            part.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
            form.Add(part, "files", "r.pdf");
        }

        return form;
    }

    private Task<HttpResponseMessage> Send(HttpMethod method, string url, HttpContent? content, string token)
    {
        var request = new HttpRequestMessage(method, url) { Content = content };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return api.Client.SendAsync(request);
    }

    private async Task<int> AccountAsync(decimal opening = 1000m, DateOnly? openingDate = null) => (await TestFinance.AddAccountAsync(api.ConnectionString, opening: opening, openingDate: openingDate)).Id;

    private async Task<JsonElement> BalanceRowAsync(int account, string token) =>
        (await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/finance/accounts", token))).EnumerateArray().Single(a => a.GetProperty("id").GetInt32() == account);

    private async Task<JsonElement> AddExpenseAsync(int account, string token, decimal amount = 100m, DateOnly? date = null)
    {
        var response = await Send(HttpMethod.Post, "/api/finance/expenses", Form(account, amount, date), token);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await TestWorkers.ReadJsonAsync(response);
    }

    // --- void -----------------------------------------------------------------------------------------------

    [Fact]
    public async Task Void_NeedsAReason_KeepsTheRow_RestoresTheBalance_AndAudits()
    {
        var token = await ManagerAsync();
        var account = await AccountAsync(1000m);
        var expense = await AddExpenseAsync(account, token, 250m);
        var id = expense.GetProperty("id").GetInt32();
        Assert.Equal(750m, (await BalanceRowAsync(account, token)).GetProperty("balance").GetDecimal());

        var noReason = await api.PostAsync($"/api/finance/expenses/{id}/void", new { reason = " " }, token);
        Assert.Equal(HttpStatusCode.BadRequest, noReason.StatusCode);

        var response = await api.PostAsync($"/api/finance/expenses/{id}/void", new { reason = "Entered twice" }, token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await TestWorkers.ReadJsonAsync(response);
        Assert.Equal("Voided", body.GetProperty("status").GetString());
        Assert.Equal("Entered twice", body.GetProperty("voidReason").GetString());
        Assert.False(string.IsNullOrEmpty(body.GetProperty("voidedBy").GetString()));
        Assert.Equal(1000m, (await BalanceRowAsync(account, token)).GetProperty("balance").GetDecimal());
        Assert.Single(await TestFinance.AuditAsync(api.ConnectionString, "FinExpenseVoided", id.ToString()));
        var all = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/finance/expenses?accountId={account}&includeVoided=true", token));
        Assert.Equal(1, all.GetProperty("items").GetArrayLength());
        Assert.Equal(0m, all.GetProperty("total").GetDecimal());
    }

    [Fact]
    public async Task Void_TwiceIsAConflict_AndUnknownIsNotFound_AndIncomeWorksToo()
    {
        var token = await ManagerAsync();
        var account = await AccountAsync();
        var id = (await AddExpenseAsync(account, token)).GetProperty("id").GetInt32();
        await api.PostAsync($"/api/finance/expenses/{id}/void", new { reason = "x" }, token);

        Assert.Equal(HttpStatusCode.Conflict, (await api.PostAsync($"/api/finance/expenses/{id}/void", new { reason = "again" }, token)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await api.PostAsync("/api/finance/expenses/999999/void", new { reason = "x" }, token)).StatusCode);

        var income = await TestFinance.AddEntryAsync(api.ConnectionString, account, FinEntryKinds.Income, 40m);
        Assert.Equal(HttpStatusCode.NotFound, (await api.PostAsync($"/api/finance/expenses/{income.Id}/void", new { reason = "wrong kind" }, token)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await api.PostAsync($"/api/finance/income/{income.Id}/void", new { reason = "wrong amount" }, token)).StatusCode);
    }

    // --- correct --------------------------------------------------------------------------------------------

    [Fact]
    public async Task Correct_VoidsTheOriginal_AddsALinkedReplacement_AndKeepsBothVisible()
    {
        var token = await ManagerAsync();
        var account = await AccountAsync(1000m);
        var original = await AddExpenseAsync(account, token, 100m);
        var id = original.GetProperty("id").GetInt32();
        var receipt = original.GetProperty("attachments")[0].GetProperty("id").GetInt32();

        var response = await Send(HttpMethod.Put, $"/api/finance/expenses/{id}", Form(account, 175.5m, party: "Supplier B", withFile: false, keep: receipt), token);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var replacement = await TestWorkers.ReadJsonAsync(response);
        Assert.Equal(175.5m, replacement.GetProperty("amount").GetDecimal());
        Assert.Equal(id, replacement.GetProperty("replacesEntryId").GetInt32());
        Assert.Equal(original.GetProperty("entryNo").GetString(), replacement.GetProperty("replacesEntryNo").GetString());
        Assert.Single(replacement.GetProperty("attachments").EnumerateArray());   // the kept receipt came across

        var old = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/finance/expenses/{id}", token));
        Assert.Equal("Voided", old.GetProperty("status").GetString());
        Assert.Equal(replacement.GetProperty("entryNo").GetString(), old.GetProperty("replacedByEntryNo").GetString());
        Assert.Single(old.GetProperty("attachments").EnumerateArray());           // the original still has its receipt
        Assert.Equal(824.5m, (await BalanceRowAsync(account, token)).GetProperty("balance").GetDecimal());   // only the replacement counts
        Assert.Single(await TestFinance.AuditAsync(api.ConnectionString, "FinExpenseCorrected", id.ToString()));
    }

    [Fact]
    public async Task Correct_StillNeedsAReceipt_ValidatesLikeANewEntry_AndRefusesAVoidedOrAlreadyCorrectedEntry()
    {
        var token = await ManagerAsync();
        var account = await AccountAsync();
        var original = await AddExpenseAsync(account, token);
        var id = original.GetProperty("id").GetInt32();

        var noReceipt = await Send(HttpMethod.Put, $"/api/finance/expenses/{id}", Form(account, withFile: false), token);
        Assert.Equal(HttpStatusCode.BadRequest, noReceipt.StatusCode);
        Assert.True((await TestWorkers.ReadJsonAsync(noReceipt)).GetProperty("errors").TryGetProperty("files", out _));

        var badAmount = await Send(HttpMethod.Put, $"/api/finance/expenses/{id}", Form(account, amount: 0m), token);
        Assert.Equal(HttpStatusCode.BadRequest, badAmount.StatusCode);

        Assert.Equal(HttpStatusCode.Created, (await Send(HttpMethod.Put, $"/api/finance/expenses/{id}", Form(account, 90m), token)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Send(HttpMethod.Put, $"/api/finance/expenses/{id}", Form(account, 80m), token)).StatusCode);   // now voided
    }

    [Fact]
    public async Task Correct_RefusesAReceiptThatBelongsToAnotherEntry()
    {
        var token = await ManagerAsync();
        var account = await AccountAsync();
        var mine = await AddExpenseAsync(account, token);
        var other = await AddExpenseAsync(account, token);
        var foreign = other.GetProperty("attachments")[0].GetProperty("id").GetInt32();

        var response = await Send(HttpMethod.Put, $"/api/finance/expenses/{mine.GetProperty("id").GetInt32()}", Form(account, withFile: false, keep: foreign), token);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // --- month lock -----------------------------------------------------------------------------------------

    private static string MonthOf(DateOnly date) => date.ToString("yyyy-MM");

    [Fact]
    public async Task Lock_BlocksAddingCorrectingVoidingAndTransfers_InThatMonth_Only()
    {
        var token = await ManagerAsync();
        var account = await AccountAsync(1000m, TestFinance.Today.AddDays(-120));
        var other = await AccountAsync(0m, TestFinance.Today.AddDays(-120));
        var past = TestFinance.Today.AddMonths(-2);
        var kept = await AddExpenseAsync(account, token, 60m, past);
        var openMonth = await AddExpenseAsync(account, token, 70m, TestFinance.Today);

        var locked = await api.PostAsync($"/api/finance/month-locks/{MonthOf(past)}/lock", new { }, token);
        Assert.Equal(HttpStatusCode.OK, locked.StatusCode);

        Assert.Equal(HttpStatusCode.Conflict, (await Send(HttpMethod.Post, "/api/finance/expenses", Form(account, 5m, past), token)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await api.PostAsync($"/api/finance/expenses/{kept.GetProperty("id").GetInt32()}/void", new { reason = "x" }, token)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Send(HttpMethod.Put, $"/api/finance/expenses/{kept.GetProperty("id").GetInt32()}", Form(account, 6m, past), token)).StatusCode);
        var transfer = await api.PostAsync("/api/finance/transfers", new { transferDate = D(past), fromAccountId = account, toAccountId = other, amount = 1m }, token);
        Assert.Equal(HttpStatusCode.Conflict, transfer.StatusCode);
        var problem = await TestWorkers.ReadJsonAsync(transfer);
        Assert.Contains("is locked", problem.GetProperty("title").GetString());

        // An entry in an open month can still be corrected, but not moved into the locked month.
        Assert.Equal(HttpStatusCode.Created, (await Send(HttpMethod.Put, $"/api/finance/expenses/{openMonth.GetProperty("id").GetInt32()}", Form(account, 71m, TestFinance.Today), token)).StatusCode);
    }

    [Fact]
    public async Task Lock_RefusesMovingAnEntryOutOfALockedMonth_AndIsAudited()
    {
        var token = await ManagerAsync();
        var account = await AccountAsync(1000m, TestFinance.Today.AddDays(-200));
        var past = TestFinance.Today.AddMonths(-5);
        var inMonth = await AddExpenseAsync(account, token, 60m, past);
        await api.PostAsync($"/api/finance/month-locks/{MonthOf(past)}/lock", new { }, token);

        var move = await Send(HttpMethod.Put, $"/api/finance/expenses/{inMonth.GetProperty("id").GetInt32()}", Form(account, 60m, TestFinance.Today), token);

        Assert.Equal(HttpStatusCode.Conflict, move.StatusCode);
        Assert.Single(await TestFinance.AuditAsync(api.ConnectionString, "FinMonthLocked", MonthOf(past)));
    }

    [Fact]
    public async Task Unlock_NeedsAReason_ReopensTheMonth_AndKeepsWhoAndWhy()
    {
        var token = await ManagerAsync();
        var account = await AccountAsync(1000m, TestFinance.Today.AddDays(-120));
        var past = TestFinance.Today.AddMonths(-3);
        await api.PostAsync($"/api/finance/month-locks/{MonthOf(past)}/lock", new { }, token);

        Assert.Equal(HttpStatusCode.BadRequest, (await api.PostAsync($"/api/finance/month-locks/{MonthOf(past)}/unlock", new { reason = "" }, token)).StatusCode);
        var unlocked = await api.PostAsync($"/api/finance/month-locks/{MonthOf(past)}/unlock", new { reason = "Missed supplier invoice" }, token);

        Assert.Equal(HttpStatusCode.OK, unlocked.StatusCode);
        var body = await TestWorkers.ReadJsonAsync(unlocked);
        Assert.False(body.GetProperty("isLocked").GetBoolean());
        Assert.Equal("Missed supplier invoice", body.GetProperty("unlockReason").GetString());
        Assert.Equal(HttpStatusCode.Created, (await Send(HttpMethod.Post, "/api/finance/expenses", Form(account, 5m, past), token)).StatusCode);
        Assert.Single(await TestFinance.AuditAsync(api.ConnectionString, "FinMonthUnlocked", MonthOf(past)));
        Assert.Equal(HttpStatusCode.Conflict, (await api.PostAsync($"/api/finance/month-locks/{MonthOf(past)}/unlock", new { reason = "again" }, token)).StatusCode);

        // Locked again later: the row is reused and the earlier unlock details are cleared.
        Assert.Equal(HttpStatusCode.OK, (await api.PostAsync($"/api/finance/month-locks/{MonthOf(past)}/lock", new { }, token)).StatusCode);
    }

    [Theory]
    [InlineData("2026-13")]
    [InlineData("26-01")]
    [InlineData("abcd-ef")]
    public async Task Lock_RejectsABadMonth_AndAFutureMonth(string month)
    {
        var token = await ManagerAsync();
        Assert.Equal(HttpStatusCode.BadRequest, (await api.PostAsync($"/api/finance/month-locks/{month}/lock", new { }, token)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await api.PostAsync($"/api/finance/month-locks/{MonthOf(TestFinance.Today.AddMonths(2))}/lock", new { }, token)).StatusCode);
    }

    [Fact]
    public async Task Lock_ListShowsLockedMonths_AndOpeningBalancesAreSettledOnceAnyMonthIsLocked()
    {
        var token = await ManagerAsync();
        var account = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 500m, openingDate: TestFinance.Today.AddDays(-200));
        var month = MonthOf(TestFinance.Today.AddMonths(-4));
        await api.PostAsync($"/api/finance/month-locks/{month}/lock", new { }, token);

        var list = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/finance/month-locks", token));
        Assert.Contains(list.EnumerateArray(), l => l.GetProperty("month").GetString() == month && l.GetProperty("isLocked").GetBoolean());

        var change = await api.SendAsync(HttpMethod.Put, $"/api/finance/accounts/{account.Id}",
            new { name = account.Name, kind = "Bank", openingBalance = 999m, openingDate = D(account.OpeningDate) }, token);
        Assert.Equal(HttpStatusCode.BadRequest, change.StatusCode);
        var rename = await api.SendAsync(HttpMethod.Put, $"/api/finance/accounts/{account.Id}",
            new { name = TestFinance.Unique("Renamed"), kind = "Bank", openingBalance = 500m, openingDate = D(account.OpeningDate) }, token);
        Assert.Equal(HttpStatusCode.OK, rename.StatusCode);

        await api.PostAsync($"/api/finance/month-locks/{month}/unlock", new { reason = "cleanup" }, token);   // leave the shared host tidy
    }

    // --- transfers ------------------------------------------------------------------------------------------

    [Fact]
    public async Task Transfer_VoidRestoresBothBalances_AndCorrectLinksAReplacement()
    {
        var token = await ManagerAsync();
        var from = await AccountAsync(1000m);
        var to = await AccountAsync(0m);
        var created = await TestWorkers.ReadJsonAsync(await api.PostAsync("/api/finance/transfers", new { transferDate = D(TestFinance.Today), fromAccountId = from, toAccountId = to, amount = 300m }, token));
        var id = created.GetProperty("id").GetInt32();

        var corrected = await api.SendAsync(HttpMethod.Put, $"/api/finance/transfers/{id}", new { transferDate = D(TestFinance.Today), fromAccountId = from, toAccountId = to, amount = 450m }, token);

        Assert.Equal(HttpStatusCode.Created, corrected.StatusCode);
        Assert.Equal(550m, (await BalanceRowAsync(from, token)).GetProperty("balance").GetDecimal());
        Assert.Equal(450m, (await BalanceRowAsync(to, token)).GetProperty("balance").GetDecimal());
        Assert.Single(await TestFinance.AuditAsync(api.ConnectionString, "FinTransferCorrected", id.ToString()));
        Assert.Equal(HttpStatusCode.Conflict, (await api.PostAsync($"/api/finance/transfers/{id}/void", new { reason = "x" }, token)).StatusCode);   // original is already voided

        var newId = (await TestWorkers.ReadJsonAsync(corrected)).GetProperty("id").GetInt32();
        Assert.Equal(HttpStatusCode.BadRequest, (await api.PostAsync($"/api/finance/transfers/{newId}/void", new { reason = "" }, token)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await api.PostAsync($"/api/finance/transfers/{newId}/void", new { reason = "Cancelled by bank" }, token)).StatusCode);
        Assert.Equal(1000m, (await BalanceRowAsync(from, token)).GetProperty("balance").GetDecimal());
        Assert.Equal(0m, (await BalanceRowAsync(to, token)).GetProperty("balance").GetDecimal());
    }

    [Fact]
    public async Task Database_RefusesAMonthLockWithAnImpossibleMonth()
    {
        await using var db = TestUsers.NewContext(api.ConnectionString);
        db.FinMonthLocks.Add(new FinMonthLock { Year = 2020, Month = 13, IsLocked = true, LockedBy = "t", LockedUtc = DateTime.UtcNow });
        await Assert.ThrowsAsync<Microsoft.EntityFrameworkCore.DbUpdateException>(() => db.SaveChangesAsync());
    }
}
