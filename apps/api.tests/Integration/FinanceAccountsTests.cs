using System.Net;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>Bank and cash accounts, their worked-out balances, transfers, and the database rules behind them.</summary>
public class FinanceAccountsTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private static string D(DateOnly date) => date.ToString("yyyy-MM-dd");

    private async Task<string> ManagerAsync() => (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;

    private static object NewAccount(string? name = null, decimal opening = 1000m, DateOnly? openingDate = null, string kind = "Bank",
        string? accountNumber = null, string? iban = null) =>
        new { name = name ?? TestFinance.Unique(), kind, bankName = "RAKBANK", accountNumber, iban, openingBalance = opening, openingDate = D(openingDate ?? TestFinance.Today.AddDays(-60)) };

    private async Task<JsonElement> AccountAsync(int id, string token, bool includeInactive = true)
    {
        var list = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/finance/accounts?includeInactive={includeInactive.ToString().ToLowerInvariant()}", token));
        return list.EnumerateArray().Single(a => a.GetProperty("id").GetInt32() == id);
    }

    private static async Task<JsonElement> ErrorsOf(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        return (await TestWorkers.ReadJsonAsync(response)).GetProperty("errors");
    }

    // --- create and list -------------------------------------------------------------------------------------

    [Fact]
    public async Task Create_ReturnsTheAccount_WithItsOpeningBalanceAsBalance_AndAuditsIt()
    {
        var token = await ManagerAsync();
        var name = TestFinance.Unique();

        var response = await api.PostAsync("/api/finance/accounts", NewAccount(name, 2500.75m), token);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await TestWorkers.ReadJsonAsync(response);
        Assert.Equal(name, body.GetProperty("name").GetString());
        Assert.Equal(2500.75m, body.GetProperty("openingBalance").GetDecimal());
        Assert.Equal(2500.75m, body.GetProperty("balance").GetDecimal());
        Assert.True(body.GetProperty("isActive").GetBoolean());
        Assert.Single(await TestFinance.AuditAsync(api.ConnectionString, "FinAccountCreated", body.GetProperty("id").GetInt32().ToString()));
    }

    [Fact]
    public async Task Create_RejectsBadInput_WithFieldErrors()
    {
        var token = await ManagerAsync();
        var response = await api.PostAsync("/api/finance/accounts", new
        {
            name = " ", kind = "Wallet", openingBalance = 10.005m, openingDate = D(TestFinance.Today.AddDays(2)),
        }, token);

        var errors = await ErrorsOf(response);
        Assert.True(errors.TryGetProperty("name", out _));
        Assert.True(errors.TryGetProperty("kind", out _));
        Assert.True(errors.TryGetProperty("openingBalance", out _));
        Assert.True(errors.TryGetProperty("openingDate", out _));
    }

    [Fact]
    public async Task Create_RejectsADuplicateName_IgnoringCase()
    {
        var token = await ManagerAsync();
        var name = TestFinance.Unique();
        Assert.Equal(HttpStatusCode.Created, (await api.PostAsync("/api/finance/accounts", NewAccount(name), token)).StatusCode);

        var errors = await ErrorsOf(await api.PostAsync("/api/finance/accounts", NewAccount(name.ToUpperInvariant()), token));

        Assert.True(errors.TryGetProperty("name", out _));
    }

    [Fact]
    public async Task List_HidesSwitchedOffAccountsUnlessAsked_AndOrdersByName()
    {
        var token = await ManagerAsync();
        var off = await TestFinance.AddAccountAsync(api.ConnectionString, isActive: false);
        var on = await TestFinance.AddAccountAsync(api.ConnectionString);

        var active = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/finance/accounts", token));
        var all = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/finance/accounts?includeInactive=true", token));

        Assert.Contains(active.EnumerateArray(), a => a.GetProperty("id").GetInt32() == on.Id);
        Assert.DoesNotContain(active.EnumerateArray(), a => a.GetProperty("id").GetInt32() == off.Id);
        Assert.Contains(all.EnumerateArray(), a => a.GetProperty("id").GetInt32() == off.Id);
    }

    // --- balances --------------------------------------------------------------------------------------------

    [Fact]
    public async Task Balance_IsWorkedOutFromEntriesAndTransfers_IgnoringVoidedRows()
    {
        var token = await ManagerAsync();
        var a = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 1000m);
        var b = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 50m);
        await TestFinance.AddEntryAsync(api.ConnectionString, a.Id, FinEntryKinds.Income, 250.50m);
        await TestFinance.AddEntryAsync(api.ConnectionString, a.Id, FinEntryKinds.Expense, 100.25m);
        await TestFinance.AddEntryAsync(api.ConnectionString, a.Id, FinEntryKinds.Expense, 40m, status: FinStatuses.Voided);
        await TestFinance.AddTransferAsync(api.ConnectionString, a.Id, b.Id, 200m);
        await TestFinance.AddTransferAsync(api.ConnectionString, b.Id, a.Id, 999m, status: FinStatuses.Voided);

        var accountA = await AccountAsync(a.Id, token);
        var accountB = await AccountAsync(b.Id, token);

        Assert.Equal(950.25m, accountA.GetProperty("balance").GetDecimal());   // 1000 + 250.50 - 100.25 - 200
        Assert.Equal(250m, accountB.GetProperty("balance").GetDecimal());      // 50 + 200
    }

    // --- update, switch off ----------------------------------------------------------------------------------

    [Fact]
    public async Task Update_ChangesTheAccount_AndAuditsOnlyWhenSomethingChanged()
    {
        var token = await ManagerAsync();
        var account = await TestFinance.AddAccountAsync(api.ConnectionString);
        var renamed = TestFinance.Unique("Renamed");

        var response = await api.SendAsync(HttpMethod.Put, $"/api/finance/accounts/{account.Id}",
            new { name = renamed, kind = "Bank", bankName = "RAKBANK", openingBalance = account.OpeningBalance, openingDate = D(account.OpeningDate) }, token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(renamed, (await TestWorkers.ReadJsonAsync(response)).GetProperty("name").GetString());
        Assert.Single(await TestFinance.AuditAsync(api.ConnectionString, "FinAccountUpdated", account.Id.ToString()));

        await api.SendAsync(HttpMethod.Put, $"/api/finance/accounts/{account.Id}",
            new { name = renamed, kind = "Bank", bankName = "RAKBANK", openingBalance = account.OpeningBalance, openingDate = D(account.OpeningDate) }, token);
        Assert.Single(await TestFinance.AuditAsync(api.ConnectionString, "FinAccountUpdated", account.Id.ToString()));
    }

    [Fact]
    public async Task Update_RefusesAnOpeningDateAfterTheFirstEntry()
    {
        var token = await ManagerAsync();
        var account = await TestFinance.AddAccountAsync(api.ConnectionString, openingDate: TestFinance.Today.AddDays(-60));
        await TestFinance.AddEntryAsync(api.ConnectionString, account.Id, FinEntryKinds.Expense, 10m, date: TestFinance.Today.AddDays(-20));

        var response = await api.SendAsync(HttpMethod.Put, $"/api/finance/accounts/{account.Id}",
            new { name = account.Name, kind = "Bank", openingBalance = 1000m, openingDate = D(TestFinance.Today.AddDays(-10)) }, token);

        Assert.True((await ErrorsOf(response)).TryGetProperty("openingDate", out _));
    }

    [Fact]
    public async Task Update_UnknownAccount_IsNotFound()
    {
        var response = await api.SendAsync(HttpMethod.Put, "/api/finance/accounts/999999", NewAccount(), await ManagerAsync());
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Deactivate_IsRefusedWhileTheAccountStillHoldsMoney_ThenAllowedAtZero()
    {
        var token = await ManagerAsync();
        var account = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 300m);

        var refused = await api.PostAsync($"/api/finance/accounts/{account.Id}/deactivate", new { }, token);
        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);

        await TestFinance.AddEntryAsync(api.ConnectionString, account.Id, FinEntryKinds.Expense, 300m);
        var done = await api.PostAsync($"/api/finance/accounts/{account.Id}/deactivate", new { }, token);
        Assert.Equal(HttpStatusCode.OK, done.StatusCode);
        Assert.False((await AccountAsync(account.Id, token)).GetProperty("isActive").GetBoolean());
        Assert.Single(await TestFinance.AuditAsync(api.ConnectionString, "FinAccountDeactivated", account.Id.ToString()));

        var back = await api.PostAsync($"/api/finance/accounts/{account.Id}/activate", new { }, token);
        Assert.Equal(HttpStatusCode.OK, back.StatusCode);
        Assert.True((await AccountAsync(account.Id, token)).GetProperty("isActive").GetBoolean());
    }

    // --- who sees account numbers ----------------------------------------------------------------------------

    [Fact]
    public async Task AccountNumberAndIban_AreFullForManagers_AndMaskedForThePartner()
    {
        var account = await TestFinance.AddAccountAsync(api.ConnectionString, accountNumber: "0353713938001", iban: "AE070331234567890123456");
        var manager = await ManagerAsync();
        var partner = (await TestWorkers.SignInAsync(api, Roles.Viewer)).Token;

        var full = await AccountAsync(account.Id, manager);
        var masked = await AccountAsync(account.Id, partner);

        Assert.Equal("0353713938001", full.GetProperty("accountNumber").GetString());
        Assert.Equal("AE070331234567890123456", full.GetProperty("iban").GetString());
        Assert.EndsWith("8001", masked.GetProperty("accountNumber").GetString());
        Assert.DoesNotContain("0353713938", masked.GetProperty("accountNumber").GetString());
        Assert.EndsWith("3456", masked.GetProperty("iban").GetString());
        Assert.DoesNotContain("AE0703312", masked.GetProperty("iban").GetString());
    }

    // --- transfers -------------------------------------------------------------------------------------------

    [Fact]
    public async Task Transfer_MovesMoneyBetweenAccounts_NumbersItAndAuditsIt()
    {
        var token = await ManagerAsync();
        var from = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 1000m);
        var to = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 0m, kind: FinAccountKinds.Cash);

        var response = await api.PostAsync("/api/finance/transfers", new
        {
            transferDate = D(TestFinance.Today), fromAccountId = from.Id, toAccountId = to.Id, amount = 400.40m, reference = "CHQ 12", notes = "Petty cash",
        }, token);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await TestWorkers.ReadJsonAsync(response);
        Assert.Matches(@"^TRF-\d{6}$", body.GetProperty("transferNo").GetString());
        Assert.Equal("Active", body.GetProperty("status").GetString());
        Assert.Equal(599.60m, (await AccountAsync(from.Id, token)).GetProperty("balance").GetDecimal());
        Assert.Equal(400.40m, (await AccountAsync(to.Id, token)).GetProperty("balance").GetDecimal());
        Assert.Single(await TestFinance.AuditAsync(api.ConnectionString, "FinTransferCreated", body.GetProperty("id").GetInt32().ToString()));
    }

    [Fact]
    public async Task Transfer_NumbersAreSequentialAndDistinct()
    {
        var token = await ManagerAsync();
        var a = await TestFinance.AddAccountAsync(api.ConnectionString);
        var b = await TestFinance.AddAccountAsync(api.ConnectionString);
        var request = new { transferDate = D(TestFinance.Today), fromAccountId = a.Id, toAccountId = b.Id, amount = 1m };

        var one = await TestWorkers.ReadJsonAsync(await api.PostAsync("/api/finance/transfers", request, token));
        var two = await TestWorkers.ReadJsonAsync(await api.PostAsync("/api/finance/transfers", request, token));

        Assert.Equal(one.GetProperty("id").GetInt32() + 1, two.GetProperty("id").GetInt32());
        Assert.NotEqual(one.GetProperty("transferNo").GetString(), two.GetProperty("transferNo").GetString());
    }

    public static IEnumerable<object[]> BadTransfers() =>
    [
        [1m, true, "toAccountId"],
        [0m, false, "amount"],
        [1.005m, false, "amount"],
        [10000000000m, false, "amount"],
    ];

    [Theory]
    [MemberData(nameof(BadTransfers))]
    public async Task Transfer_RejectsBadInput(decimal amount, bool sameAccount, string expectedField)
    {
        var token = await ManagerAsync();
        var a = await TestFinance.AddAccountAsync(api.ConnectionString);
        var b = await TestFinance.AddAccountAsync(api.ConnectionString);

        var response = await api.PostAsync("/api/finance/transfers", new
        {
            transferDate = D(TestFinance.Today), fromAccountId = a.Id, toAccountId = sameAccount ? a.Id : b.Id, amount,
        }, token);

        Assert.True((await ErrorsOf(response)).TryGetProperty(expectedField, out _));
    }

    [Fact]
    public async Task Transfer_RejectsFutureDates_AndDatesBeforeEitherOpeningDate()
    {
        var token = await ManagerAsync();
        var early = await TestFinance.AddAccountAsync(api.ConnectionString, openingDate: TestFinance.Today.AddDays(-60));
        var late = await TestFinance.AddAccountAsync(api.ConnectionString, openingDate: TestFinance.Today.AddDays(-10));

        var future = await api.PostAsync("/api/finance/transfers",
            new { transferDate = D(TestFinance.Today.AddDays(1)), fromAccountId = early.Id, toAccountId = late.Id, amount = 5m }, token);
        var tooEarly = await api.PostAsync("/api/finance/transfers",
            new { transferDate = D(TestFinance.Today.AddDays(-30)), fromAccountId = early.Id, toAccountId = late.Id, amount = 5m }, token);

        Assert.True((await ErrorsOf(future)).TryGetProperty("transferDate", out _));
        Assert.True((await ErrorsOf(tooEarly)).TryGetProperty("transferDate", out _));
    }

    [Fact]
    public async Task Transfer_RejectsAnUnknownOrSwitchedOffAccount()
    {
        var token = await ManagerAsync();
        var ok = await TestFinance.AddAccountAsync(api.ConnectionString);
        var off = await TestFinance.AddAccountAsync(api.ConnectionString, isActive: false);

        var unknown = await api.PostAsync("/api/finance/transfers",
            new { transferDate = D(TestFinance.Today), fromAccountId = ok.Id, toAccountId = 999999, amount = 5m }, token);
        var inactive = await api.PostAsync("/api/finance/transfers",
            new { transferDate = D(TestFinance.Today), fromAccountId = ok.Id, toAccountId = off.Id, amount = 5m }, token);

        Assert.True((await ErrorsOf(unknown)).TryGetProperty("toAccountId", out _));
        Assert.True((await ErrorsOf(inactive)).TryGetProperty("toAccountId", out _));
    }

    [Fact]
    public async Task Transfers_CanBeListed_ByAccount()
    {
        var token = await ManagerAsync();
        var a = await TestFinance.AddAccountAsync(api.ConnectionString);
        var b = await TestFinance.AddAccountAsync(api.ConnectionString);
        var c = await TestFinance.AddAccountAsync(api.ConnectionString);
        var ab = await TestFinance.AddTransferAsync(api.ConnectionString, a.Id, b.Id, 10m);
        await TestFinance.AddTransferAsync(api.ConnectionString, b.Id, c.Id, 20m);

        var list = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/finance/transfers?accountId={a.Id}", token));

        Assert.Equal(ab.Id, Assert.Single(list.EnumerateArray()).GetProperty("id").GetInt32());
    }

    // --- database rules --------------------------------------------------------------------------------------

    [Fact]
    public async Task Database_RefusesAnEntryOfZero_ATransferToTheSameAccount_AndAVoidWithoutTimestamp()
    {
        var account = await TestFinance.AddAccountAsync(api.ConnectionString);
        await using var db = TestUsers.NewContext(api.ConnectionString);

        db.FinEntries.Add(new FinEntry { EntryNo = "X-" + Guid.NewGuid().ToString("N")[..10], Kind = "Expense", EntryDate = TestFinance.Today, CategoryId = 1, Party = "p", AccountId = account.Id, Amount = 0m, CreatedBy = "t", CreatedUtc = DateTime.UtcNow });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        db.ChangeTracker.Clear();

        db.FinTransfers.Add(new FinTransfer { TransferNo = "T-" + Guid.NewGuid().ToString("N")[..10], TransferDate = TestFinance.Today, FromAccountId = account.Id, ToAccountId = account.Id, Amount = 5m, CreatedBy = "t", CreatedUtc = DateTime.UtcNow });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        db.ChangeTracker.Clear();

        db.FinEntries.Add(new FinEntry { EntryNo = "V-" + Guid.NewGuid().ToString("N")[..10], Kind = "Expense", EntryDate = TestFinance.Today, CategoryId = 1, Party = "p", AccountId = account.Id, Amount = 5m, Status = "Voided", CreatedBy = "t", CreatedUtc = DateTime.UtcNow });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task Database_RefusesDeletingAnAccountThatHasEntries()
    {
        var account = await TestFinance.AddAccountAsync(api.ConnectionString);
        await TestFinance.AddEntryAsync(api.ConnectionString, account.Id, FinEntryKinds.Expense, 5m);
        await using var db = TestUsers.NewContext(api.ConnectionString);

        var ex = await Assert.ThrowsAsync<DbUpdateException>(async () =>
        {
            db.FinAccounts.Remove(await db.FinAccounts.SingleAsync(a => a.Id == account.Id));
            await db.SaveChangesAsync();
        });

        Assert.IsType<SqlException>(ex.InnerException);
    }
}
