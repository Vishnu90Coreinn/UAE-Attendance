using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>The ledger is derived from the finance records: the posting rules, reversals, idempotence, and the checks that it agrees with the screens.</summary>
public class FinanceLedgerTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private static string D(DateOnly d) => d.ToString("yyyy-MM-dd");
    private async Task<string> ManagerAsync() => (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;

    private async Task<(HttpStatusCode Status, JsonElement Body)> SendAsync(HttpMethod method, string url, string token, object? body = null)
    {
        var request = new HttpRequestMessage(method, url) { Content = body is null ? null : JsonContent.Create(body) };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var response = await api.Client.SendAsync(request);
        var text = await response.Content.ReadAsStringAsync();
        return (response.StatusCode, string.IsNullOrWhiteSpace(text) ? default : JsonDocument.Parse(text).RootElement);
    }

    /// <summary>The ledger account behind a finance account, found after a sync has made it.</summary>
    private async Task<int> LedgerOfAsync(string token, int finAccountId)
    {
        await SendAsync(HttpMethod.Post, "/api/finance/ledger/sync", token);
        await using var db = TestUsers.NewContext(api.ConnectionString);
        return (await db.FinAccounts.AsNoTracking().SingleAsync(a => a.Id == finAccountId)).LedgerAccountId!.Value;
    }

    private async Task<JsonElement> StatementAsync(string token, int ledgerId) =>
        (await SendAsync(HttpMethod.Get, $"/api/finance/ledger/accounts/{ledgerId}/statement?from=2000-01-01&to={D(TestFinance.Today)}", token)).Body;

    [Fact]
    public async Task OpeningBalance_DebitsTheAccount_AgainstOpeningBalanceEquity()
    {
        var token = await ManagerAsync();
        var account = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 10_162m);

        var ledgerId = await LedgerOfAsync(token, account.Id);

        var statement = await StatementAsync(token, ledgerId);
        Assert.Equal(10_162m, statement.GetProperty("closing").GetDecimal());
        var journals = (await SendAsync(HttpMethod.Get, "/api/finance/ledger/journals?source=Opening&sourceId=" + account.Id, token)).Body.GetProperty("items");
        var lines = journals[0].GetProperty("lines").EnumerateArray().ToList();
        Assert.Equal(10_162m, lines.Single(l => l.GetProperty("accountCode").GetString() == "3900").GetProperty("credit").GetDecimal());
        Assert.Equal(10_162m, lines.Single(l => l.GetProperty("accountName").GetString() == account.Name).GetProperty("debit").GetDecimal());
    }

    [Fact]
    public async Task Expense_DebitsItsCategoryAccount_AndCreditsTheBank_AndSplitsPostOneDebitPerLine()
    {
        var token = await ManagerAsync();
        var account = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 20_000m);
        var plain = await TestFinance.AddEntryAsync(api.ConnectionString, account.Id, "Expense", 156.45m, categoryId: 1);
        await using (var db = TestUsers.NewContext(api.ConnectionString))   // a 5,000 payment split 2,000 / 3,000
        {
            var split = new FinEntry { Kind = "Expense", EntryNo = "EXP-S" + Guid.NewGuid().ToString("N")[..8], EntryDate = TestFinance.Today.AddDays(-3), CategoryId = 9, Party = "Agent", AccountId = account.Id, Amount = 5_000m, CreatedBy = "t", CreatedUtc = DateTime.UtcNow };
            split.Lines.Add(new FinEntryLine { CategoryId = 5, Amount = 2_000m, Note = "Deposit" });
            split.Lines.Add(new FinEntryLine { CategoryId = 9, Amount = 3_000m, Note = "Commission" });
            db.FinEntries.Add(split);
            await db.SaveChangesAsync();
        }

        var ledgerId = await LedgerOfAsync(token, account.Id);

        Assert.Equal(20_000m - 156.45m - 5_000m, (await StatementAsync(token, ledgerId)).GetProperty("closing").GetDecimal());
        var plainJournal = (await SendAsync(HttpMethod.Get, $"/api/finance/ledger/journals?source=Entry&sourceId={plain.Id}", token)).Body.GetProperty("items").EnumerateArray().Single();
        var plainLines = plainJournal.GetProperty("lines").EnumerateArray().ToList();
        Assert.Equal(156.45m, plainLines.Single(l => l.GetProperty("accountName").GetString() == "General company expenses").GetProperty("debit").GetDecimal());
        Assert.Equal(156.45m, plainLines.Single(l => l.GetProperty("accountName").GetString() == account.Name).GetProperty("credit").GetDecimal());
        var journal = (await SendAsync(HttpMethod.Get, "/api/finance/ledger/journals?source=Entry", token)).Body.GetProperty("items").EnumerateArray()
            .Single(j => j.GetProperty("description").GetString()!.EndsWith("Agent"));
        var debits = journal.GetProperty("lines").EnumerateArray().Where(l => l.GetProperty("debit").GetDecimal() > 0).Select(l => (l.GetProperty("accountName").GetString(), l.GetProperty("debit").GetDecimal())).ToList();
        Assert.Equal([("Recruitment commission", 3_000m), ("Worker accommodation rent", 2_000m)], debits);
    }

    [Fact]
    public async Task Income_Transfer_AndCapital_PostTheRightSides()
    {
        var token = await ManagerAsync();
        var bank = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 0m);
        var cash = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 0m, kind: "Cash");
        var partner = await TestFinance.AddPartnerAsync(api.ConnectionString, opening: 0m);
        await TestFinance.AddEntryAsync(api.ConnectionString, bank.Id, "Income", 111_767.04m);
        await TestFinance.AddCapitalAsync(api.ConnectionString, bank.Id, partner.Id, 26_960.11m);
        await TestFinance.AddCapitalAsync(api.ConnectionString, bank.Id, partner.Id, 960.11m, kind: "CapitalOut");
        await TestFinance.AddTransferAsync(api.ConnectionString, bank.Id, cash.Id, 3_000m);

        var bankLedger = await LedgerOfAsync(token, bank.Id);
        var cashLedger = await LedgerOfAsync(token, cash.Id);

        Assert.Equal(111_767.04m + 26_960.11m - 960.11m - 3_000m, (await StatementAsync(token, bankLedger)).GetProperty("closing").GetDecimal());
        Assert.Equal(3_000m, (await StatementAsync(token, cashLedger)).GetProperty("closing").GetDecimal());
        await using var db = TestUsers.NewContext(api.ConnectionString);
        var partnerLedger = (await db.FinPartners.AsNoTracking().SingleAsync(p => p.Id == partner.Id)).LedgerAccountId!.Value;
        Assert.Equal(26_000m, (await StatementAsync(token, partnerLedger)).GetProperty("closing").GetDecimal());   // a credit-normal equity account
    }

    [Fact]
    public async Task Void_IsReversedNotErased_AndNetsToZero_AndPendingOrRejectedNeverPost()
    {
        var token = await ManagerAsync();
        var account = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 1_000m);
        var voided = await TestFinance.AddEntryAsync(api.ConnectionString, account.Id, "Expense", 400m);
        var pending = await TestFinance.AddEntryAsync(api.ConnectionString, account.Id, "Expense", 70m, status: "Pending");
        var ledgerId = await LedgerOfAsync(token, account.Id);
        Assert.Equal(1_000m - 400m, (await StatementAsync(token, ledgerId)).GetProperty("closing").GetDecimal());

        await using (var db = TestUsers.NewContext(api.ConnectionString))   // the void and the approval happen later
        {
            var e = await db.FinEntries.SingleAsync(x => x.Id == voided.Id);
            e.Status = "Voided"; e.VoidReason = "mistake"; e.VoidedBy = "t"; e.VoidedUtc = DateTime.UtcNow;
            await db.SaveChangesAsync();
        }

        var sync = await SendAsync(HttpMethod.Post, "/api/finance/ledger/sync", token);

        Assert.Equal(1, sync.Body.GetProperty("reversed").GetInt32());
        var statement = await StatementAsync(token, ledgerId);
        Assert.Equal(1_000m, statement.GetProperty("closing").GetDecimal());   // back to the opening balance
        var parts = statement.GetProperty("lines").EnumerateArray().Select(l => l.GetProperty("part").GetString()).ToList();
        Assert.Equal(1, parts.Count(p => p == "Reversal"));   // the opening balance, the expense and its reversal are all still on record
        Assert.Equal(2, parts.Count(p => p == "Post"));
        Assert.DoesNotContain((await SendAsync(HttpMethod.Get, "/api/finance/ledger/journals?source=Entry", token)).Body.GetProperty("items").EnumerateArray(), j => j.GetProperty("sourceId").GetInt32() == pending.Id);

        await using (var db = TestUsers.NewContext(api.ConnectionString))   // approved: now it posts
        {
            (await db.FinEntries.SingleAsync(x => x.Id == pending.Id)).Status = "Active";
            await db.SaveChangesAsync();
        }

        await SendAsync(HttpMethod.Post, "/api/finance/ledger/sync", token);
        Assert.Equal(1_000m - 70m, (await StatementAsync(token, ledgerId)).GetProperty("closing").GetDecimal());
    }

    [Fact]
    public async Task Sync_IsIdempotent_AndAChangedOpeningBalanceIsReversedAndPostedAgain()
    {
        var token = await ManagerAsync();
        var account = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 500m);
        var ledgerId = await LedgerOfAsync(token, account.Id);

        var again = await SendAsync(HttpMethod.Post, "/api/finance/ledger/sync", token);
        Assert.Equal(0, again.Body.GetProperty("posted").GetInt32());
        Assert.Equal(0, again.Body.GetProperty("reversed").GetInt32());

        await using (var db = TestUsers.NewContext(api.ConnectionString))
        {
            (await db.FinAccounts.SingleAsync(a => a.Id == account.Id)).OpeningBalance = 750m;
            await db.SaveChangesAsync();
        }

        var changed = await SendAsync(HttpMethod.Post, "/api/finance/ledger/sync", token);
        Assert.Equal(1, changed.Body.GetProperty("posted").GetInt32());
        Assert.Equal(1, changed.Body.GetProperty("reversed").GetInt32());
        Assert.Equal(750m, (await StatementAsync(token, ledgerId)).GetProperty("closing").GetDecimal());
    }

    [Fact]
    public async Task Check_AgreesWithTheFinanceScreens_AndTheTrialBalanceBalances()
    {
        var token = await ManagerAsync();
        var bank = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 5_000m);
        var partner = await TestFinance.AddPartnerAsync(api.ConnectionString, opening: 5_000m);
        await TestFinance.AddEntryAsync(api.ConnectionString, bank.Id, "Expense", 123.45m);
        await TestFinance.AddEntryAsync(api.ConnectionString, bank.Id, "Income", 999m);
        await TestFinance.AddCapitalAsync(api.ConnectionString, bank.Id, partner.Id, 2_000m);

        var check = (await SendAsync(HttpMethod.Get, "/api/finance/ledger/check", token)).Body;

        Assert.True(check.GetProperty("allAgree").GetBoolean(), string.Join("; ", check.GetProperty("checks").EnumerateArray().Where(c => !c.GetProperty("agrees").GetBoolean()).Select(c => c.GetProperty("subject").GetString())));
        Assert.Equal(check.GetProperty("totalDebit").GetDecimal(), check.GetProperty("totalCredit").GetDecimal());
        var trial = (await SendAsync(HttpMethod.Get, "/api/finance/ledger/trial-balance", token)).Body;
        Assert.True(trial.GetProperty("balanced").GetBoolean());
        Assert.Equal(trial.GetProperty("totalDebit").GetDecimal(), trial.GetProperty("totalCredit").GetDecimal());
    }

    [Fact]
    public async Task Rebuild_GivesTheSameBooks_AndAMappingChangeMovesTheAmounts()
    {
        var token = await ManagerAsync();
        var account = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 1_000m);
        await TestFinance.AddEntryAsync(api.ConnectionString, account.Id, "Expense", 200m, categoryId: 7);   // Office Rent
        var ledgerId = await LedgerOfAsync(token, account.Id);
        var before = (await StatementAsync(token, ledgerId)).GetProperty("closing").GetDecimal();

        // The accountant maps Office Rent onto a different (new) account, then the books are rebuilt.
        int target;
        await using (var db = TestUsers.NewContext(api.ConnectionString))
        {
            var created = new LedgerAccount { Code = "5990", Name = "Premises costs", Type = "Expense", CreatedUtc = DateTime.UtcNow };
            db.LedgerAccounts.Add(created);
            await db.SaveChangesAsync();
            (await db.FinCategories.SingleAsync(c => c.Id == 7)).LedgerAccountId = created.Id;
            await db.SaveChangesAsync();
            target = created.Id;
        }

        var rebuilt = await SendAsync(HttpMethod.Post, "/api/finance/ledger/rebuild", (await TestWorkers.SignInAsync(api, Roles.Administrator)).Token);
        Assert.Equal(HttpStatusCode.OK, rebuilt.Status);
        Assert.Equal(before, (await StatementAsync(token, ledgerId)).GetProperty("closing").GetDecimal());
        Assert.Equal(200m, (await StatementAsync(token, target)).GetProperty("closing").GetDecimal());
        Assert.True((await SendAsync(HttpMethod.Get, "/api/finance/ledger/check", token)).Body.GetProperty("allAgree").GetBoolean());
    }

    [Fact]
    public async Task Rebuild_IsForAdministratorsOnly_AndRefusedOnceAMonthIsLocked()
    {
        var manager = await ManagerAsync();
        Assert.Equal(HttpStatusCode.Forbidden, (await SendAsync(HttpMethod.Post, "/api/finance/ledger/rebuild", manager)).Status);
        var partner = (await TestWorkers.SignInAsync(api, Roles.Viewer)).Token;
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(HttpMethod.Get, "/api/finance/ledger/trial-balance", partner)).Status);   // the Partner reads the books
        Assert.Equal(HttpStatusCode.Forbidden, (await SendAsync(HttpMethod.Post, "/api/finance/ledger/sync", partner)).Status);
        var hr = (await TestWorkers.SignInAsync(api, Roles.HR)).Token;
        Assert.Equal(HttpStatusCode.Forbidden, (await SendAsync(HttpMethod.Get, "/api/finance/ledger/accounts", hr)).Status);

        var admin = (await TestWorkers.SignInAsync(api, Roles.Administrator)).Token;
        await SendAsync(HttpMethod.Post, "/api/finance/month-locks/2012-02/lock", manager);
        Assert.Equal(HttpStatusCode.Conflict, (await SendAsync(HttpMethod.Post, "/api/finance/ledger/rebuild", admin)).Status);
    }
}
