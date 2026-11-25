using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>
/// A cheque is a promise until the bank acts: while it is open the money sits in "cheques payable" (or "cheques receivable"), so the bank in the books matches
/// the bank statement. Clearing moves it; cancelling or bouncing puts things back; the books balance throughout.
/// </summary>
public class FinanceChequeBooksTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private static string D(DateOnly d) => d.ToString("yyyy-MM-dd");
    private static DateOnly Today => TestFinance.Today;
    private async Task<string> ManagerAsync() => (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;

    private async Task<(HttpStatusCode Status, JsonElement Body)> SendAsync(HttpMethod method, string url, string token, object? body = null)
    {
        var request = new HttpRequestMessage(method, url) { Content = body is null ? null : JsonContent.Create(body) };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var response = await api.Client.SendAsync(request);
        var text = await response.Content.ReadAsStringAsync();
        return (response.StatusCode, string.IsNullOrWhiteSpace(text) ? default : JsonDocument.Parse(text).RootElement);
    }

    private async Task<JsonElement> AccountAsync(string token, int id) =>
        (await SendAsync(HttpMethod.Get, "/api/finance/accounts", token)).Body.EnumerateArray().Single(a => a.GetProperty("id").GetInt32() == id);

    private async Task<decimal> LedgerBalanceAsync(string token, int finAccountId)
    {
        await SendAsync(HttpMethod.Post, "/api/finance/ledger/sync", token);
        await using var db = TestUsers.NewContext(api.ConnectionString);
        var ledgerId = (await Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions.SingleAsync(db.FinAccounts, a => a.Id == finAccountId)).LedgerAccountId!.Value;
        return (await SendAsync(HttpMethod.Get, $"/api/finance/ledger/accounts/{ledgerId}/statement?from=2000-01-01&to={D(Today)}", token)).Body.GetProperty("closing").GetDecimal();
    }

    private async Task<decimal> SystemBalanceAsync(string token, string name) =>
        (await SendAsync(HttpMethod.Get, "/api/finance/ledger/accounts", token)).Body.EnumerateArray().Single(a => a.GetProperty("name").GetString()!.StartsWith(name)).GetProperty("balance").GetDecimal();

    private object Cheque(string serial, string direction, int account, decimal amount, int? entry, int dueInDays = 30) => new
    {
        direction, serial, amount, partyName = "M S K Luxuries", issueDate = D(Today.AddDays(-3)), dueDate = D(Today.AddDays(dueInDays)), accountId = account, entryId = entry,
    };

    private async Task<(int Account, int Entry)> ExpenseAsync(decimal opening = 50_000m, decimal amount = 10_000m)
    {
        var account = await TestFinance.AddAccountAsync(api.ConnectionString, opening: opening);
        var entry = await TestFinance.AddEntryAsync(api.ConnectionString, account.Id, "Expense", amount, Today.AddDays(-3), categoryId: 5);
        return (account.Id, entry.Id);
    }

    [Fact]
    public async Task IssuedCheque_KeepsTheMoneyInTheBankUntilItClears_AndTheBooksAgree()
    {
        var token = await ManagerAsync();
        var (account, entry) = await ExpenseAsync();
        var payableBefore = await SystemBalanceAsync(token, "Cheques payable");

        var made = await SendAsync(HttpMethod.Post, "/api/finance/cheques", token, Cheque("C-1", "Issued", account, 10_000m, entry));
        Assert.Equal(HttpStatusCode.Created, made.Status);

        var row = await AccountAsync(token, account);
        Assert.Equal(40_000m, row.GetProperty("balance").GetDecimal());           // the expense is recorded, so the company has 40,000 left to spend
        Assert.Equal(10_000m, row.GetProperty("unclearedCheques").GetDecimal());
        Assert.Equal(50_000m, row.GetProperty("bankBalance").GetDecimal());       // the bank has not paid it yet, so the statement still says 50,000
        Assert.Equal(50_000m, await LedgerBalanceAsync(token, account));         // and the books' bank account agrees with the statement
        Assert.Equal(payableBefore + 10_000m, await SystemBalanceAsync(token, "Cheques payable"));
        var check = (await SendAsync(HttpMethod.Get, "/api/finance/ledger/check", token)).Body;
        Assert.True(check.GetProperty("allAgree").GetBoolean());
    }

    [Fact]
    public async Task Clearing_MovesTheMoneyOutOfTheBank_AndEmptiesChequesPayable()
    {
        var token = await ManagerAsync();
        var (account, entry) = await ExpenseAsync();
        var id = (await SendAsync(HttpMethod.Post, "/api/finance/cheques", token, Cheque("C-2", "Issued", account, 10_000m, entry))).Body.GetProperty("id").GetInt32();
        var payableBefore = await SystemBalanceAsync(token, "Cheques payable");
        await SendAsync(HttpMethod.Post, $"/api/finance/cheques/{id}/status", token, new { status = "Delivered" });
        Assert.Equal(50_000m, await LedgerBalanceAsync(token, account));

        var cleared = await SendAsync(HttpMethod.Post, $"/api/finance/cheques/{id}/status", token, new { status = "Cleared", date = D(Today) });

        Assert.Equal(HttpStatusCode.OK, cleared.Status);
        var row = await AccountAsync(token, account);
        Assert.Equal(0m, row.GetProperty("unclearedCheques").GetDecimal());
        Assert.Equal(40_000m, row.GetProperty("bankBalance").GetDecimal());       // the bank has paid it: statement and balance agree again
        Assert.Equal(40_000m, await LedgerBalanceAsync(token, account));
        Assert.Equal(payableBefore - 10_000m, await SystemBalanceAsync(token, "Cheques payable"));
        Assert.True((await SendAsync(HttpMethod.Get, "/api/finance/ledger/check", token)).Body.GetProperty("allAgree").GetBoolean());
    }

    [Fact]
    public async Task CancelledOrBouncedCheque_PutsTheBooksBack_AndTheExpenseCanThenBeVoided()
    {
        var token = await ManagerAsync();
        var (account, entry) = await ExpenseAsync();
        var id = (await SendAsync(HttpMethod.Post, "/api/finance/cheques", token, Cheque("C-3", "Issued", account, 10_000m, entry))).Body.GetProperty("id").GetInt32();
        Assert.Equal(HttpStatusCode.Conflict, (await SendAsync(HttpMethod.Post, $"/api/finance/expenses/{entry}/void", token, new { reason = "wrong" })).Status);   // not while the cheque is live

        await SendAsync(HttpMethod.Post, $"/api/finance/cheques/{id}/status", token, new { status = "Cancelled", note = "Written twice" });

        var row = await AccountAsync(token, account);
        Assert.Equal(0m, row.GetProperty("unclearedCheques").GetDecimal());
        Assert.Equal(40_000m, await LedgerBalanceAsync(token, account));
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(HttpMethod.Post, $"/api/finance/expenses/{entry}/void", token, new { reason = "cheque cancelled" })).Status);
        Assert.Equal(50_000m, await LedgerBalanceAsync(token, account));
        Assert.True((await SendAsync(HttpMethod.Get, "/api/finance/ledger/check", token)).Body.GetProperty("allAgree").GetBoolean());
    }

    [Fact]
    public async Task ReceivedCheque_IsNotInTheBankUntilItClears()
    {
        var token = await ManagerAsync();
        var receivableBefore = await SystemBalanceAsync(token, "Cheques receivable");
        var account = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 1_000m);
        var income = await TestFinance.AddEntryAsync(api.ConnectionString, account.Id, "Income", 8_000m, Today.AddDays(-2), categoryId: 10);
        var id = (await SendAsync(HttpMethod.Post, "/api/finance/cheques", token, Cheque("R-1", "Received", account.Id, 8_000m, income.Id, 15))).Body.GetProperty("id").GetInt32();

        var row = await AccountAsync(token, account.Id);
        Assert.Equal(9_000m, row.GetProperty("balance").GetDecimal());
        Assert.Equal(-8_000m, row.GetProperty("unclearedCheques").GetDecimal());
        Assert.Equal(1_000m, row.GetProperty("bankBalance").GetDecimal());       // the cheque is in a drawer, not in the bank
        Assert.Equal(1_000m, await LedgerBalanceAsync(token, account.Id));
        Assert.Equal(receivableBefore + 8_000m, await SystemBalanceAsync(token, "Cheques receivable"));

        await SendAsync(HttpMethod.Post, $"/api/finance/cheques/{id}/status", token, new { status = "Deposited" });
        await SendAsync(HttpMethod.Post, $"/api/finance/cheques/{id}/status", token, new { status = "Cleared", date = D(Today) });

        Assert.Equal(9_000m, (await AccountAsync(token, account.Id)).GetProperty("bankBalance").GetDecimal());
        Assert.Equal(9_000m, await LedgerBalanceAsync(token, account.Id));
        Assert.Equal(receivableBefore, await SystemBalanceAsync(token, "Cheques receivable"));   // cleared: nothing left in the drawer
    }

    [Fact]
    public async Task UnlinkingAnOpenCheque_PutsTheMoneyBack_AndAnUnlinkedChequeChangesNothing()
    {
        var token = await ManagerAsync();
        var (account, entry) = await ExpenseAsync();
        var id = (await SendAsync(HttpMethod.Post, "/api/finance/cheques", token, Cheque("C-5", "Issued", account, 10_000m, entry))).Body.GetProperty("id").GetInt32();
        Assert.Equal(50_000m, await LedgerBalanceAsync(token, account));

        var unlink = await SendAsync(HttpMethod.Put, $"/api/finance/cheques/{id}", token, Cheque("C-5", "Issued", account, 10_000m, null));

        Assert.Equal(HttpStatusCode.OK, unlink.Status);
        Assert.Equal(40_000m, await LedgerBalanceAsync(token, account));
        Assert.Equal(0m, (await AccountAsync(token, account)).GetProperty("unclearedCheques").GetDecimal());

        var loose = await SendAsync(HttpMethod.Post, "/api/finance/cheques", token, Cheque("C-6", "Issued", account, 500m, null));   // a post-dated cheque not yet an expense
        Assert.Equal(HttpStatusCode.Created, loose.Status);
        Assert.Equal(40_000m, await LedgerBalanceAsync(token, account));
    }

    [Fact]
    public async Task LinkingRules_SameAccountAndNotMoreThanTheEntry()
    {
        var token = await ManagerAsync();
        var (account, entry) = await ExpenseAsync(amount: 1_000m);
        var other = (await TestFinance.AddAccountAsync(api.ConnectionString)).Id;

        var differentAccount = await SendAsync(HttpMethod.Post, "/api/finance/cheques", token, Cheque("L-1", "Issued", other, 1_000m, entry));
        Assert.Equal(HttpStatusCode.BadRequest, differentAccount.Status);
        Assert.Contains("different account", differentAccount.Body.GetProperty("errors").GetProperty("entryId")[0].GetString());
        var tooMuch = await SendAsync(HttpMethod.Post, "/api/finance/cheques", token, Cheque("L-2", "Issued", account, 1_500m, entry));
        Assert.Equal(HttpStatusCode.BadRequest, tooMuch.Status);
        Assert.Equal(HttpStatusCode.Created, (await SendAsync(HttpMethod.Post, "/api/finance/cheques", token, Cheque("L-3", "Issued", account, 600m, entry))).Status);   // a part-payment by cheque is fine
        Assert.Equal(600m, (await AccountAsync(token, account)).GetProperty("unclearedCheques").GetDecimal());
    }

    [Fact]
    public async Task TheBalanceSheetBalances_WithAnOpenChequeOnTheBooks_AndTotalAssetsFollowTheBank()
    {
        var token = await ManagerAsync();
        var account = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 5_000m, openingDate: new DateOnly(2002, 1, 1));
        var entry = await TestFinance.AddEntryAsync(api.ConnectionString, account.Id, "Expense", 2_000m, new DateOnly(2002, 6, 1), categoryId: 7);
        var cheque = new { direction = "Issued", serial = "BS-1", amount = 2_000m, partyName = "Landlord", issueDate = "2002-06-01", dueDate = "2002-12-01", accountId = account.Id, entryId = (int?)entry.Id };
        Assert.Equal(HttpStatusCode.Created, (await SendAsync(HttpMethod.Post, "/api/finance/cheques", token, cheque)).Status);

        var sheet = (await SendAsync(HttpMethod.Get, "/api/finance/ledger/balance-sheet?asOf=2002-09-01", token)).Body;

        Assert.True(sheet.GetProperty("balanced").GetBoolean());
        Assert.Equal(5_000m, sheet.GetProperty("totalAssets").GetDecimal());       // the bank still holds it all
        Assert.Equal(2_000m, sheet.GetProperty("totalLiabilities").GetDecimal());  // and 2,000 of it is promised to the landlord
        Assert.Equal(3_000m, sheet.GetProperty("totalEquity").GetDecimal());       // equity is what is left: 5,000 less the 2,000 owed
    }

    [Fact]
    public async Task ALinkedCheque_CannotBeWrittenOrClearedIntoALockedMonth()
    {
        var token = await ManagerAsync();
        var account = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 50_000m, openingDate: new DateOnly(2018, 1, 1));
        var entry = await TestFinance.AddEntryAsync(api.ConnectionString, account.Id, "Expense", 1_000m, new DateOnly(2018, 3, 5), categoryId: 5);
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(HttpMethod.Post, "/api/finance/month-locks/2018-03/lock", token)).Status);

        var late = new { direction = "Issued", serial = "L-1", amount = 1_000m, partyName = "Landlord", issueDate = "2018-03-06", dueDate = "2018-03-06", accountId = account.Id, entryId = entry.Id };
        var made = await SendAsync(HttpMethod.Post, "/api/finance/cheques", token, late);
        Assert.Equal(HttpStatusCode.Conflict, made.Status);                      // the booking would land in a locked month

        var open = await SendAsync(HttpMethod.Post, "/api/finance/cheques", token, new { late.direction, serial = "L-2", late.amount, late.partyName, issueDate = D(Today.AddDays(-2)), dueDate = D(Today.AddDays(10)), late.accountId, entryId = (int?)null });
        Assert.Equal(HttpStatusCode.Created, open.Status);                       // unlinked cheques change no books, so a lock does not matter to them
    }
}
