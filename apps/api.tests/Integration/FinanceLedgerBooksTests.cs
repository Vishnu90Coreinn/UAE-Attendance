using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ClosedXML.Excel;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>The accountant's tools: editing the chart, choosing where records post, journals posted by hand, and the downloads.</summary>
public class FinanceLedgerBooksTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private static string D(DateOnly d) => d.ToString("yyyy-MM-dd");
    private async Task<string> ManagerAsync() => (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;
    private async Task<string> AdminAsync() => (await TestWorkers.SignInAsync(api, Roles.Administrator)).Token;

    private async Task<(HttpStatusCode Status, JsonElement Body)> SendAsync(HttpMethod method, string url, string token, object? body = null)
    {
        var request = new HttpRequestMessage(method, url) { Content = body is null ? null : JsonContent.Create(body) };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var response = await api.Client.SendAsync(request);
        var text = await response.Content.ReadAsStringAsync();
        return (response.StatusCode, string.IsNullOrWhiteSpace(text) ? default : JsonDocument.Parse(text).RootElement);
    }

    private async Task<byte[]> DownloadAsync(string url, string token)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var response = await api.Client.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.Content.ReadAsByteArrayAsync();
    }

    private async Task<int> NewLedgerAccountAsync(string token, string type, string? name = null)
    {
        var code = "9" + Random.Shared.Next(1000, 9999) + Guid.NewGuid().ToString("N")[..3];
        var made = await SendAsync(HttpMethod.Post, "/api/finance/ledger/accounts", token, new { code, name = name ?? "Test " + code, type });
        Assert.Equal(HttpStatusCode.Created, made.Status);
        return made.Body.GetProperty("id").GetInt32();
    }

    private async Task<int> LedgerOfAsync(string token, int finAccountId)
    {
        await SendAsync(HttpMethod.Post, "/api/finance/ledger/sync", token);
        await using var db = TestUsers.NewContext(api.ConnectionString);
        return (await db.FinAccounts.AsNoTracking().SingleAsync(a => a.Id == finAccountId)).LedgerAccountId!.Value;
    }

    private async Task<decimal> ClosingAsync(string token, int ledgerId) =>
        (await SendAsync(HttpMethod.Get, $"/api/finance/ledger/accounts/{ledgerId}/statement?from=2000-01-01&to={D(TestFinance.Today)}", token)).Body.GetProperty("closing").GetDecimal();

    // ---- chart of accounts ---------------------------------------------------------------------------------------------

    [Fact]
    public async Task Chart_AddRenameAndCodeRules()
    {
        var token = await ManagerAsync();
        var id = await NewLedgerAccountAsync(token, "Expense", "Premises costs");

        var duplicate = await SendAsync(HttpMethod.Post, "/api/finance/ledger/accounts", token, new { code = "3900", name = "Dup", type = "Equity" });
        Assert.Equal(HttpStatusCode.BadRequest, duplicate.Status);   // 3900 belongs to opening balance equity
        Assert.Equal(HttpStatusCode.BadRequest, (await SendAsync(HttpMethod.Post, "/api/finance/ledger/accounts", token, new { code = "bad code!", name = "x", type = "Asset" })).Status);
        Assert.Equal(HttpStatusCode.BadRequest, (await SendAsync(HttpMethod.Post, "/api/finance/ledger/accounts", token, new { code = "9000", name = "x", type = "Sideways" })).Status);

        var renamed = await SendAsync(HttpMethod.Put, $"/api/finance/ledger/accounts/{id}", token, new { name = "Premises and rates" });
        Assert.Equal(HttpStatusCode.OK, renamed.Status);
        Assert.Equal("Premises and rates", renamed.Body.GetProperty("name").GetString());
        Assert.Single(await TestFinance.AuditAsync(api.ConnectionString, "LedgerAccountUpdated", id.ToString()));
    }

    [Fact]
    public async Task Chart_SystemAndInUseAccountsCannotBeSwitchedOff_AndTypeFreezesOncePosted()
    {
        var token = await ManagerAsync();
        var bank = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 100m);
        var mapped = await LedgerOfAsync(token, bank.Id);
        var chart = (await SendAsync(HttpMethod.Get, "/api/finance/ledger/accounts", token)).Body.EnumerateArray().ToList();
        var equity = chart.Single(a => a.GetProperty("code").GetString() == "3900").GetProperty("id").GetInt32();

        Assert.Equal(HttpStatusCode.BadRequest, (await SendAsync(HttpMethod.Put, $"/api/finance/ledger/accounts/{equity}", token, new { isActive = false })).Status);
        var inUse = await SendAsync(HttpMethod.Put, $"/api/finance/ledger/accounts/{mapped}", token, new { isActive = false });
        Assert.Equal(HttpStatusCode.BadRequest, inUse.Status);
        Assert.Contains("still where", inUse.Body.GetProperty("errors").GetProperty("isActive")[0].GetString());
        Assert.Equal(HttpStatusCode.BadRequest, (await SendAsync(HttpMethod.Put, $"/api/finance/ledger/accounts/{mapped}", token, new { type = "Expense" })).Status);   // it has an opening posting

        var spare = await NewLedgerAccountAsync(token, "Asset");
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(HttpMethod.Put, $"/api/finance/ledger/accounts/{spare}", token, new { isActive = false })).Status);
    }

    // ---- mapping -------------------------------------------------------------------------------------------------------

    [Fact]
    public async Task Mapping_MovesPastPostingsToTheChosenAccount_AndTheBooksStillAgree()
    {
        var token = await ManagerAsync();
        var admin = await AdminAsync();
        var bank = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 1_000m);
        await TestFinance.AddEntryAsync(api.ConnectionString, bank.Id, "Expense", 300m, categoryId: 8);   // Dubai Insurance
        var insurance = await NewLedgerAccountAsync(token, "Expense", "Insurance premiums");
        await SendAsync(HttpMethod.Post, "/api/finance/ledger/sync", token);

        var set = await SendAsync(HttpMethod.Put, "/api/finance/ledger/mappings/Category/8", admin, new { ledgerAccountId = insurance });

        Assert.Equal(HttpStatusCode.OK, set.Status);
        Assert.Equal(insurance, set.Body.GetProperty("ledgerAccountId").GetInt32());
        Assert.True(await ClosingAsync(token, insurance) >= 300m);
        Assert.True((await SendAsync(HttpMethod.Get, "/api/finance/ledger/check", token)).Body.GetProperty("allAgree").GetBoolean());
        Assert.NotEmpty(await TestFinance.AuditAsync(api.ConnectionString, "LedgerMappingChanged"));
    }

    [Fact]
    public async Task Mapping_RefusesTheWrongTypeASharedAccountAndNonAdministrators()
    {
        var token = await ManagerAsync();
        var admin = await AdminAsync();
        var one = await TestFinance.AddAccountAsync(api.ConnectionString);
        var two = await TestFinance.AddAccountAsync(api.ConnectionString);
        var oneLedger = await LedgerOfAsync(token, one.Id);
        await LedgerOfAsync(token, two.Id);
        var expense = await NewLedgerAccountAsync(token, "Expense");

        Assert.Equal(HttpStatusCode.BadRequest, (await SendAsync(HttpMethod.Put, $"/api/finance/ledger/mappings/Account/{two.Id}", admin, new { ledgerAccountId = expense })).Status);   // a bank is an asset
        Assert.Equal(HttpStatusCode.BadRequest, (await SendAsync(HttpMethod.Put, $"/api/finance/ledger/mappings/Account/{two.Id}", admin, new { ledgerAccountId = oneLedger })).Status);   // one ledger account each
        Assert.Equal(HttpStatusCode.Forbidden, (await SendAsync(HttpMethod.Put, "/api/finance/ledger/mappings/Category/1", token, new { ledgerAccountId = expense })).Status);
        Assert.Equal(HttpStatusCode.NotFound, (await SendAsync(HttpMethod.Put, "/api/finance/ledger/mappings/Nothing/1", admin, new { ledgerAccountId = expense })).Status);
        var mappings = (await SendAsync(HttpMethod.Get, "/api/finance/ledger/mappings", token)).Body.EnumerateArray().ToList();
        Assert.Contains(mappings, m => m.GetProperty("kind").GetString() == "Category" && m.GetProperty("name").GetString() == "Office Rent");
    }

    // ---- manual journals -----------------------------------------------------------------------------------------------

    private static object Journal(int debit, int credit, decimal amount, string description = "Depreciation of site equipment", DateOnly? date = null) => new
    {
        date = D(date ?? TestFinance.Today.AddDays(-1)), description,
        lines = new object[] { new { accountId = debit, debit = amount, memo = "Monthly" }, new { accountId = credit, credit = amount } },
    };

    [Fact]
    public async Task ManualJournal_PostsBalanced_ShowsAsManual_MovesTheTrialBalance_AndDoesNotBreakTheCheck()
    {
        var token = await ManagerAsync();
        var bank = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 5_000m);
        var bankLedger = await LedgerOfAsync(token, bank.Id);
        var expense = await NewLedgerAccountAsync(token, "Expense", "Bank charges adjustment");

        var posted = await SendAsync(HttpMethod.Post, "/api/finance/ledger/journals", token, Journal(expense, bankLedger, 12.5m, "Bank charge not yet entered"));

        Assert.Equal(HttpStatusCode.Created, posted.Status);
        Assert.True(posted.Body.GetProperty("isManual").GetBoolean());
        Assert.Matches(@"^JNL-\d{6}$", posted.Body.GetProperty("number").GetString());
        Assert.Equal(5_000m - 12.5m, await ClosingAsync(token, bankLedger));
        Assert.Equal(12.5m, await ClosingAsync(token, expense));
        var check = (await SendAsync(HttpMethod.Get, "/api/finance/ledger/check", token)).Body;
        Assert.False(check.GetProperty("allAgree").GetBoolean());   // manual cash postings must be reconciled to the operational account
        Assert.True(check.GetProperty("manualJournals").GetInt32() >= 1);
        Assert.True((await SendAsync(HttpMethod.Get, "/api/finance/ledger/trial-balance", token)).Body.GetProperty("balanced").GetBoolean());
        Assert.NotEmpty(await TestFinance.AuditAsync(api.ConnectionString, "LedgerManualJournalPosted"));
    }

    [Fact]
    public async Task ManualJournal_RefusesWhatIsNotBalancedNotOneSidedOrNotAllowed()
    {
        var token = await ManagerAsync();
        var a = await NewLedgerAccountAsync(token, "Asset");
        var b = await NewLedgerAccountAsync(token, "Expense");
        var off = await NewLedgerAccountAsync(token, "Expense");
        await SendAsync(HttpMethod.Put, $"/api/finance/ledger/accounts/{off}", token, new { isActive = false });

        async Task<(HttpStatusCode Status, JsonElement Body)> Post(object body) => await SendAsync(HttpMethod.Post, "/api/finance/ledger/journals", token, body);
        var line = (int acc, decimal? debit, decimal? credit) => new { accountId = acc, debit, credit };
        var day = D(TestFinance.Today.AddDays(-1));

        var unbalanced = await Post(new { date = day, description = "x", lines = new[] { line(a, 100m, null), line(b, null, 90m) } });
        Assert.Equal(HttpStatusCode.BadRequest, unbalanced.Status);
        Assert.Contains("does not balance", unbalanced.Body.GetProperty("errors").GetProperty("lines")[0].GetString());
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(new { date = day, description = "x", lines = new[] { line(a, 100m, 100m), line(b, null, 0m) } })).Status);   // both sides on one line
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(new { date = day, description = "x", lines = new[] { line(a, 100m, null) } })).Status);                     // one line only
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(new { date = day, description = "x", lines = new[] { line(a, 0.001m, null), line(b, null, 0.001m) } })).Status);   // not money
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(new { date = day, description = "x", lines = new[] { line(a, 5m, null), line(off, null, 5m) } })).Status);     // an account that is switched off
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(new { date = D(TestFinance.Today.AddDays(3)), description = "x", lines = new[] { line(a, 5m, null), line(b, null, 5m) } })).Status);   // the future
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(new { date = day, description = "", lines = new[] { line(a, 5m, null), line(b, null, 5m) } })).Status);
    }

    [Fact]
    public async Task ManualJournal_CannotGoInALockedMonth_AndReversalIsOnceOnlyForManualOnes()
    {
        var token = await ManagerAsync();
        var a = await NewLedgerAccountAsync(token, "Asset");
        var b = await NewLedgerAccountAsync(token, "Expense");
        var bank = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 10m);
        await LedgerOfAsync(token, bank.Id);
        await SendAsync(HttpMethod.Post, "/api/finance/month-locks/2010-05/lock", token);
        Assert.Equal(HttpStatusCode.Conflict, (await SendAsync(HttpMethod.Post, "/api/finance/ledger/journals", token, Journal(b, a, 5m, date: new DateOnly(2010, 5, 20)))).Status);
        await SendAsync(HttpMethod.Post, "/api/finance/month-locks/2010-05/unlock", token, new { reason = "Test finished" });   // locks settle the books for every test that follows

        var posted = await SendAsync(HttpMethod.Post, "/api/finance/ledger/journals", token, Journal(b, a, 40m));
        var id = posted.Body.GetProperty("id").GetInt32();
        Assert.Equal(HttpStatusCode.BadRequest, (await SendAsync(HttpMethod.Post, $"/api/finance/ledger/journals/{id}/reverse", token, new { reason = "" })).Status);
        var reversed = await SendAsync(HttpMethod.Post, $"/api/finance/ledger/journals/{id}/reverse", token, new { reason = "Posted to the wrong account" });
        Assert.Equal(HttpStatusCode.OK, reversed.Status);
        Assert.Equal("Reversal", reversed.Body.GetProperty("part").GetString());
        Assert.Equal(0m, await ClosingAsync(token, b));   // undone, and both postings remain on record
        Assert.Equal(HttpStatusCode.Conflict, (await SendAsync(HttpMethod.Post, $"/api/finance/ledger/journals/{id}/reverse", token, new { reason = "again" })).Status);

        var systemJournal = (await SendAsync(HttpMethod.Get, "/api/finance/ledger/journals?source=Opening", token)).Body.GetProperty("items")[0].GetProperty("id").GetInt32();
        Assert.Equal(HttpStatusCode.Conflict, (await SendAsync(HttpMethod.Post, $"/api/finance/ledger/journals/{systemJournal}/reverse", token, new { reason = "no" })).Status);
    }

    [Fact]
    public async Task Rebuild_KeepsTheAccountantsManualJournals()
    {
        var token = await ManagerAsync();
        var a = await NewLedgerAccountAsync(token, "Asset");
        var b = await NewLedgerAccountAsync(token, "Expense");
        await SendAsync(HttpMethod.Post, "/api/finance/ledger/journals", token, Journal(b, a, 77m));

        var rebuilt = await SendAsync(HttpMethod.Post, "/api/finance/ledger/rebuild", await AdminAsync());

        Assert.Equal(HttpStatusCode.OK, rebuilt.Status);
        Assert.Equal(77m, await ClosingAsync(token, b));
    }

    // ---- downloads -----------------------------------------------------------------------------------------------------

    [Fact]
    public async Task Downloads_CarryTheSameFiguresAsTheScreens()
    {
        var token = await ManagerAsync();
        var bank = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 2_000m);
        await TestFinance.AddEntryAsync(api.ConnectionString, bank.Id, "Expense", 250.5m);
        var ledgerId = await LedgerOfAsync(token, bank.Id);
        var today = D(TestFinance.Today);

        var trial = (await SendAsync(HttpMethod.Get, "/api/finance/ledger/trial-balance", token)).Body;
        using (var book = new XLWorkbook(new MemoryStream(await DownloadAsync("/api/finance/ledger/trial-balance?format=xlsx", token))))
        {
            var total = book.Worksheet("Trial balance").RowsUsed().Single(r => r.Cell(2).GetString() == "Total");
            Assert.Equal(trial.GetProperty("totalDebit").GetDecimal(), (decimal)total.Cell(4).GetDouble());
            Assert.Equal(trial.GetProperty("totalCredit").GetDecimal(), (decimal)total.Cell(5).GetDouble());
        }

        var csv = System.Text.Encoding.UTF8.GetString(await DownloadAsync($"/api/finance/ledger/accounts/{ledgerId}/statement?from=2000-01-01&to={today}&format=csv", token));
        Assert.Contains("Closing balance", csv);
        Assert.Contains("1749.50", csv);   // 2,000 less 250.50
        using (var book = new XLWorkbook(new MemoryStream(await DownloadAsync($"/api/finance/ledger/accounts/{ledgerId}/statement?from=2000-01-01&to={today}&format=xlsx", token))))
            Assert.NotNull(book.Worksheet("Ledger"));

        Assert.Equal(new byte[] { 0x25, 0x50, 0x44, 0x46 }, (await DownloadAsync("/api/finance/ledger/trial-balance?format=pdf", token))[..4]);
        var journals = System.Text.Encoding.UTF8.GetString(await DownloadAsync("/api/finance/ledger/journals?format=csv", token));
        Assert.StartsWith("﻿Date,Journal,Description", journals);
        Assert.Contains("No", journals);
        Assert.Equal(HttpStatusCode.Forbidden, (await SendAsync(HttpMethod.Post, "/api/finance/ledger/journals", (await TestWorkers.SignInAsync(api, Roles.Viewer)).Token, new { })).Status);
    }
}
