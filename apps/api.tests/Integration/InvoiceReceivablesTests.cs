using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>
/// An issued tax invoice is a receivable until it is paid: issuing books the sale and the VAT, a payment moves money into the bank and clears the receivable,
/// removing the payment puts it back, and the books keep agreeing with the invoices.
/// </summary>
public class InvoiceReceivablesTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private static string D(DateOnly d) => d.ToString("yyyy-MM-dd");
    private static DateOnly Today => TestFinance.Today;

    private async Task<(HttpStatusCode Status, JsonElement Body)> SendAsync(HttpMethod method, string url, string token, object? body = null)
    {
        var request = new HttpRequestMessage(method, url) { Content = body is null ? null : JsonContent.Create(body) };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var response = await api.Client.SendAsync(request);
        var text = await response.Content.ReadAsStringAsync();
        return (response.StatusCode, string.IsNullOrWhiteSpace(text) ? default : JsonDocument.Parse(text).RootElement);
    }

    private async Task<string> ManagerAsync() => (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;

    private async Task<decimal> BalanceAsync(string token, string code) =>
        (await SendAsync(HttpMethod.Get, "/api/finance/ledger/accounts", token)).Body.EnumerateArray().Single(a => a.GetProperty("code").GetString() == code).GetProperty("balance").GetDecimal();

    private async Task<decimal> BankAsync(string token, int id) =>
        (await SendAsync(HttpMethod.Get, "/api/finance/accounts", token)).Body.EnumerateArray().Single(a => a.GetProperty("id").GetInt32() == id).GetProperty("balance").GetDecimal();

    private async Task<int> IssueAsync(string token, DateOnly date, DateOnly due, decimal rate = 1000m, string client = "Acme Glass LLC")
    {
        var body = new
        {
            clientName = client, clientTrn = "100", clientAddress = "Dubai", invoiceDate = D(date), dueDate = D(due), paymentTerms = "Net 30", lpoRef = "L", project = "P", scope = "S", notes = "",
            lines = new[] { new { description = "Aluminium works", quantity = 1m, rate } },
        };
        var created = await SendAsync(HttpMethod.Post, "/api/invoices", token, body);
        Assert.Equal(HttpStatusCode.Created, created.Status);
        var id = created.Body.GetProperty("id").GetInt32();
        var issued = await SendAsync(HttpMethod.Post, $"/api/invoices/{id}/issue", token, new { });
        Assert.Equal(HttpStatusCode.OK, issued.Status);
        return id;
    }

    private Task<(HttpStatusCode Status, JsonElement Body)> PayAsync(string token, int invoice, decimal amount, int? account, DateOnly? date = null) =>
        SendAsync(HttpMethod.Post, $"/api/invoices/{invoice}/payments", token, new { paidDate = D(date ?? Today), amount, method = "Bank transfer", reference = "TRF-1", accountId = account });

    private async Task<bool> AllAgreeAsync(string token) => (await SendAsync(HttpMethod.Get, "/api/finance/ledger/check", token)).Body.GetProperty("allAgree").GetBoolean();

    private static JsonElement Row(JsonElement report, int id) => report.GetProperty("rows").EnumerateArray().Single(r => r.GetProperty("invoiceId").GetInt32() == id);

    [Fact]
    public async Task IssuePayRemoveCancel_KeepsReceivablesSalesVatAndBankInStep()
    {
        var token = await ManagerAsync();
        var account = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 10_000m, openingDate: Today.AddDays(-90));
        var (ar0, sales0, vat0) = (await BalanceAsync(token, "1550"), await BalanceAsync(token, "4900"), await BalanceAsync(token, "2200"));

        var id = await IssueAsync(token, Today.AddDays(-60), Today.AddDays(-40));      // 1,000 + 5% VAT = 1,050, 40 days late
        Assert.Equal(ar0 + 1_050m, await BalanceAsync(token, "1550"));
        Assert.Equal(sales0 + 1_000m, await BalanceAsync(token, "4900"));
        Assert.Equal(vat0 + 50m, await BalanceAsync(token, "2200"));
        Assert.Equal(10_000m, await BankAsync(token, account.Id));                    // nothing has been paid yet
        var aging = (await SendAsync(HttpMethod.Get, "/api/finance/ledger/receivables", token)).Body;
        Assert.Equal(1_050m, Row(aging, id).GetProperty("balance").GetDecimal());
        Assert.Equal("31 to 60 days", Row(aging, id).GetProperty("bucket").GetString());
        Assert.True(await AllAgreeAsync(token));

        var part = await PayAsync(token, id, 400m, account.Id);
        Assert.Equal(HttpStatusCode.OK, part.Status);
        Assert.Equal(10_400m, await BankAsync(token, account.Id));
        Assert.Equal(ar0 + 650m, await BalanceAsync(token, "1550"));
        Assert.Equal(sales0 + 1_000m, await BalanceAsync(token, "4900"));              // a payment is not new revenue
        Assert.Equal(650m, Row((await SendAsync(HttpMethod.Get, "/api/finance/ledger/receivables", token)).Body, id).GetProperty("balance").GetDecimal());
        Assert.True(part.Body.GetProperty("payments")[0].GetProperty("inBooks").GetBoolean());
        Assert.True(await AllAgreeAsync(token));

        // The income entry belongs to the invoice: it cannot be voided on its own.
        var entryId = await EntryIdAsync(token, account.Id);
        var voided = await SendAsync(HttpMethod.Post, $"/api/finance/income/{entryId}/void", token, new { reason = "x" });
        Assert.Equal(HttpStatusCode.Conflict, voided.Status);
        Assert.Contains("tax invoice", voided.Body.GetProperty("title").GetString());

        var paymentId = part.Body.GetProperty("payments")[0].GetProperty("id").GetInt32();
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(HttpMethod.Delete, $"/api/invoices/{id}/payments/{paymentId}", token)).Status);
        Assert.Equal(10_000m, await BankAsync(token, account.Id));
        Assert.Equal(ar0 + 1_050m, await BalanceAsync(token, "1550"));
        Assert.True(await AllAgreeAsync(token));

        Assert.Equal(HttpStatusCode.OK, (await PayAsync(token, id, 1_050m, account.Id)).Status);                 // paid in full: it leaves the aging
        Assert.Equal(11_050m, await BankAsync(token, account.Id));
        Assert.Equal(ar0, await BalanceAsync(token, "1550"));
        Assert.DoesNotContain((await SendAsync(HttpMethod.Get, "/api/finance/ledger/receivables", token)).Body.GetProperty("rows").EnumerateArray(), r => r.GetProperty("invoiceId").GetInt32() == id);

        var other = await IssueAsync(token, Today.AddDays(-5), Today.AddDays(25), 200m);
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(HttpMethod.Post, $"/api/invoices/{other}/cancel", token, new { reason = "Wrong client" })).Status);
        Assert.Equal(ar0, await BalanceAsync(token, "1550"));                           // cancelled: the sale is reversed
        Assert.Equal(sales0 + 1_000m, await BalanceAsync(token, "4900"));
        Assert.True(await AllAgreeAsync(token));
    }

    [Fact]
    public async Task VatReturn_CountsAnInvoiceOnceFromTheDayItIsIssued_NotWhenItIsPaid()
    {
        var token = await ManagerAsync();
        var account = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 1_000m, openingDate: Today.AddDays(-90));
        var from = D(Today.AddDays(-30));
        var before = (await SendAsync(HttpMethod.Get, $"/api/finance/reports/vat?from={from}&to={D(Today)}", token)).Body;

        var id = await IssueAsync(token, Today.AddDays(-10), Today.AddDays(20), 2_000m);   // VAT 100
        await PayAsync(token, id, 2_100m, account.Id);

        var after = (await SendAsync(HttpMethod.Get, $"/api/finance/reports/vat?from={from}&to={D(Today)}", token)).Body;
        Assert.Equal(before.GetProperty("outputVat").GetDecimal() + 100m, after.GetProperty("outputVat").GetDecimal());   // once, not twice
    }

    [Fact]
    public async Task ALockedMonth_RefusesIssuingAnInvoiceAndPayingIntoIt()
    {
        var token = await ManagerAsync();
        var account = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 1_000m, openingDate: new DateOnly(2022, 1, 1));
        var id = await IssueAsync(token, Today.AddDays(-5), Today.AddDays(25), 100m);
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(HttpMethod.Post, "/api/finance/month-locks/2022-03/lock", token)).Status);

        var late = await SendAsync(HttpMethod.Post, "/api/invoices", token, new
        {
            clientName = "Old Client", clientTrn = "1", clientAddress = "x", invoiceDate = "2022-03-10", dueDate = "2022-04-10", paymentTerms = "", lpoRef = "", project = "", scope = "", notes = "",
            lines = new[] { new { description = "x", quantity = 1m, rate = 10m } },
        });
        var issued = await SendAsync(HttpMethod.Post, $"/api/invoices/{late.Body.GetProperty("id").GetInt32()}/issue", token, new { });
        Assert.Equal(HttpStatusCode.Conflict, issued.Status);

        var payment = await PayAsync(token, id, 50m, account.Id, new DateOnly(2022, 3, 15));
        Assert.Equal(HttpStatusCode.BadRequest, payment.Status);
        Assert.True(payment.Body.GetProperty("errors").TryGetProperty("paidDate", out _));
    }

    private async Task<int> EntryIdAsync(string token, int accountId)
    {
        var list = (await SendAsync(HttpMethod.Get, $"/api/finance/income?accountId={accountId}", token)).Body;
        return list.GetProperty("items").EnumerateArray().First().GetProperty("id").GetInt32();
    }
}
