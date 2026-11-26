using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Integration;

public class FinanceAccountantReviewTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private async Task<string> ManagerAsync() => (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;
    private async Task<JsonElement> GetAsync(string path, string token)
    {
        var response = await api.GetAsync(path, token);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<JsonElement>());
    }

    [Fact]
    public async Task TrialBalance_ShowsClosingBalances_NotBothSidesOfTheAccountTurnover()
    {
        var token = await ManagerAsync();
        var bank = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 1000m);
        await TestFinance.AddEntryAsync(api.ConnectionString, bank.Id, "Expense", 200m);
        var trial = await GetAsync("/api/finance/ledger/trial-balance", token);
        var row = trial.GetProperty("accounts").EnumerateArray().Single(a => a.GetProperty("name").GetString() == bank.Name);
        Assert.Equal(800m, row.GetProperty("debit").GetDecimal());
        Assert.Equal(0m, row.GetProperty("credit").GetDecimal());
        Assert.True(trial.GetProperty("balanced").GetBoolean());
    }

    [Fact]
    public async Task Reconciliation_DoesNotHideManualPostingsToCash()
    {
        var token = await ManagerAsync();
        var bank = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 1000m);
        await GetAsync("/api/finance/ledger/accounts", token);
        await using var db = TestUsers.NewContext(api.ConnectionString);
        var ledgerId = (await db.FinAccounts.SingleAsync(a => a.Id == bank.Id)).LedgerAccountId!.Value;
        var expenseId = await db.LedgerAccounts.Where(a => a.Code == "5600").Select(a => a.Id).SingleAsync();
        var posted = await api.PostAsync("/api/finance/ledger/journals", new { date = TestFinance.Today.ToString("yyyy-MM-dd"), description = "Unreconciled cash adjustment", lines = new[] { new { accountId = expenseId, debit = 10m, credit = 0m }, new { accountId = ledgerId, debit = 0m, credit = 10m } } }, token);
        Assert.Equal(HttpStatusCode.Created, posted.StatusCode);
        var check = await GetAsync("/api/finance/ledger/check", token);
        var row = check.GetProperty("checks").EnumerateArray().Single(c => c.GetProperty("subject").GetString() == bank.Name);
        Assert.False(row.GetProperty("agrees").GetBoolean());
        Assert.Equal(990m, row.GetProperty("ledger").GetDecimal());
        Assert.False(check.GetProperty("allAgree").GetBoolean());
    }

    [Fact]
    public async Task Reconciliation_FlagsLegacyInvoicePaymentsWithoutBankLinks()
    {
        var token = await ManagerAsync();
        await using (var db = TestUsers.NewContext(api.ConnectionString))
        {
            var invoice = new Invoice { Number = "LEGACY-" + Guid.NewGuid().ToString("N")[..8], Status = "Issued", InvoiceDate = TestFinance.Today, DueDate = TestFinance.Today, ClientName = "Legacy receipt", SubTotal = 100m, VatTotal = 5m, Total = 105m, IssuedUtc = DateTime.UtcNow, CreatedUtc = DateTime.UtcNow, UpdatedUtc = DateTime.UtcNow };
            invoice.Payments.Add(new InvoicePayment { Amount = 20m, PaidDate = TestFinance.Today, Method = "Bank transfer", RecordedUtc = DateTime.UtcNow });
            db.Invoices.Add(invoice);
            await db.SaveChangesAsync();
        }
        var check = await GetAsync("/api/finance/ledger/check", token);
        var receivables = check.GetProperty("checks").EnumerateArray().Single(c => c.GetProperty("name").GetString() == "Receivables");
        Assert.False(receivables.GetProperty("agrees").GetBoolean());
        Assert.Equal(20m, receivables.GetProperty("ledger").GetDecimal() - receivables.GetProperty("screens").GetDecimal());
    }

    [Fact]
    public async Task APaymentMadeBeforeCutOver_IsClearedByTheJournalInTheRunbook()
    {
        var token = await ManagerAsync();
        async Task<decimal> DifferenceAsync()
        {
            var row = (await GetAsync("/api/finance/ledger/check", token)).GetProperty("checks").EnumerateArray().Single(c => c.GetProperty("name").GetString() == "Receivables");
            return row.GetProperty("ledger").GetDecimal() - row.GetProperty("screens").GetDecimal();
        }
        var before = await DifferenceAsync();
        await using (var db = TestUsers.NewContext(api.ConnectionString))
        {
            var invoice = new Invoice { Number = "OLD-" + Guid.NewGuid().ToString("N")[..8], Status = "Issued", InvoiceDate = TestFinance.Today, DueDate = TestFinance.Today, ClientName = "Paid before cut-over", SubTotal = 100m, VatTotal = 5m, Total = 105m, IssuedUtc = DateTime.UtcNow, CreatedUtc = DateTime.UtcNow, UpdatedUtc = DateTime.UtcNow };
            invoice.Payments.Add(new InvoicePayment { Amount = 105m, PaidDate = TestFinance.Today, Method = "Bank transfer", RecordedUtc = DateTime.UtcNow });
            db.Invoices.Add(invoice);
            await db.SaveChangesAsync();
        }
        Assert.Equal(before + 105m, await DifferenceAsync());

        await using var read = TestUsers.NewContext(api.ConnectionString);
        var ids = await read.LedgerAccounts.Where(a => a.Code == "1550" || a.Code == "4900" || a.Code == "2200").ToDictionaryAsync(a => a.Code, a => a.Id);
        var posted = await api.PostAsync("/api/finance/ledger/journals", new { date = TestFinance.Today.ToString("yyyy-MM-dd"), description = "Invoice paid before cut-over", lines = new[] {
            new { accountId = ids["4900"], debit = 100m, credit = 0m }, new { accountId = ids["2200"], debit = 5m, credit = 0m }, new { accountId = ids["1550"], debit = 0m, credit = 105m } } }, token);

        Assert.Equal(HttpStatusCode.Created, posted.StatusCode);
        Assert.Equal(before, await DifferenceAsync());
    }

    [Fact]
    public async Task DuplicateSupplierReference_IsProtectedAcrossConcurrentRequests()
    {
        var token = await ManagerAsync();
        var bill = new { supplierName = TestFinance.Unique("Concurrent"), supplierRef = "SAME-REFERENCE", billDate = TestFinance.Today.ToString("yyyy-MM-dd"), dueDate = TestFinance.Today.ToString("yyyy-MM-dd"), lines = new[] { new { categoryId = 1, amount = 100m } } };
        var results = await Task.WhenAll(api.PostAsync("/api/finance/bills", bill, token), api.PostAsync("/api/finance/bills", bill, token));
        Assert.Single(results, r => r.StatusCode == HttpStatusCode.Created);
        Assert.Single(results, r => r.StatusCode == HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task SalaryAdvanceFallback_RemainsAnAsset_WhenTheStandardAccountWasRepurposed()
    {
        var token = await ManagerAsync();
        await GetAsync("/api/finance/ledger/accounts", token);
        await using (var db = TestUsers.NewContext(api.ConnectionString))
        {
            (await db.LedgerAccounts.SingleAsync(a => a.Code == "1510")).Name = "Custom employee receivable";
            (await db.FinCategories.SingleAsync(c => c.Name == "Salary Advance" && c.Kind == "Expense")).LedgerAccountId = null;
            db.FinCategories.Add(new FinCategory { Name = "Monthly Salary", Kind = "Income" });
            await db.SaveChangesAsync();
        }
        await GetAsync("/api/finance/ledger/accounts", token);
        await using var check = TestUsers.NewContext(api.ConnectionString);
        var advance = await check.FinCategories.SingleAsync(c => c.Name == "Salary Advance" && c.Kind == "Expense");
        var income = await check.FinCategories.SingleAsync(c => c.Name == "Monthly Salary" && c.Kind == "Income");
        Assert.Equal("Asset", (await check.LedgerAccounts.SingleAsync(a => a.Id == advance.LedgerAccountId)).Type);
        Assert.Equal("Revenue", (await check.LedgerAccounts.SingleAsync(a => a.Id == income.LedgerAccountId)).Type);
    }

    [Fact]
    public async Task NewInvoicePayments_RequireAReceivingAccountAtTheApiBoundary()
    {
        var token = await ManagerAsync();
        int id;
        await using (var db = TestUsers.NewContext(api.ConnectionString))
        {
            var invoice = new Invoice { Number = "ACCOUNT-" + Guid.NewGuid().ToString("N")[..8], Status = "Issued", InvoiceDate = TestFinance.Today, DueDate = TestFinance.Today, Total = 105m, SubTotal = 100m, VatTotal = 5m, IssuedUtc = DateTime.UtcNow, CreatedUtc = DateTime.UtcNow, UpdatedUtc = DateTime.UtcNow };
            db.Invoices.Add(invoice); await db.SaveChangesAsync(); id = invoice.Id;
        }
        var response = await api.PostAsync($"/api/invoices/{id}/payments", new { paidDate = TestFinance.Today.ToString("yyyy-MM-dd"), amount = 10m, method = "Bank transfer" }, token);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.True((await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors").TryGetProperty("accountId", out _));
    }

    [Fact]
    public async Task VatPeriod_CanBeAssignedOutsideCalendarQuarters_AndViewerCannotChangeIt()
    {
        var token = await ManagerAsync();
        var settings = new { months = 3, startMonth = 2, confirmed = true };
        Assert.Equal(HttpStatusCode.OK, (await api.SendAsync(HttpMethod.Put, "/api/finance/tax-period", settings, token)).StatusCode);
        var saved = await GetAsync("/api/finance/tax-period", token);
        Assert.Equal(2, saved.GetProperty("startMonth").GetInt32());
        Assert.True(saved.GetProperty("confirmed").GetBoolean());
        Assert.Equal(HttpStatusCode.BadRequest, (await api.SendAsync(HttpMethod.Put, "/api/finance/tax-period", new { months = 0, startMonth = 13, confirmed = true }, token)).StatusCode);
        var viewer = (await TestWorkers.SignInAsync(api, Roles.Viewer)).Token;
        Assert.Equal(HttpStatusCode.Forbidden, (await api.SendAsync(HttpMethod.Put, "/api/finance/tax-period", settings, viewer)).StatusCode);
    }

    [Fact]
    public async Task DuplicateSupplierReference_IsRejected_ButAnotherSupplierCanUseIt()
    {
        var token = await ManagerAsync();
        var supplier = TestFinance.Unique("Supplier");
        object Bill(string name, string reference) => new { supplierName = name, supplierRef = reference, billDate = TestFinance.Today.ToString("yyyy-MM-dd"), dueDate = TestFinance.Today.AddDays(30).ToString("yyyy-MM-dd"), lines = new[] { new { categoryId = 1, amount = 100m } } };
        Assert.Equal(HttpStatusCode.Created, (await api.PostAsync("/api/finance/bills", Bill(supplier, "INV-77"), token)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await api.PostAsync("/api/finance/bills", Bill(supplier.ToUpperInvariant(), " inv-77 "), token)).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await api.PostAsync("/api/finance/bills", Bill(TestFinance.Unique("Other"), "INV-77"), token)).StatusCode);
    }
}
