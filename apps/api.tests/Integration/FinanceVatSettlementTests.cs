using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>Paying the tax authority clears "VAT payable" (a refund clears "VAT recoverable"). It is money out of the bank, but neither a cost nor VAT of its own.</summary>
public class FinanceVatSettlementTests(ReceiptsFixture api) : IClassFixture<ReceiptsFixture>
{
    private static readonly byte[] Pdf = "%PDF-1.4\n1 0 obj\n<<>>\nendobj\n"u8.ToArray();
    private static string D(DateOnly d) => d.ToString("yyyy-MM-dd");
    private static DateOnly Day => new(2007, 3, 12);

    private async Task<(HttpStatusCode Status, JsonElement Body)> SendAsync(HttpMethod method, string url, string token, object? body = null, HttpContent? content = null)
    {
        var request = new HttpRequestMessage(method, url) { Content = content ?? (body is null ? null : JsonContent.Create(body)) };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var response = await api.Client.SendAsync(request);
        var text = await response.Content.ReadAsStringAsync();
        return (response.StatusCode, string.IsNullOrWhiteSpace(text) ? default : JsonDocument.Parse(text).RootElement);
    }

    private static MultipartFormDataContent Form(int account, decimal amount, int category, int? taxType = null, string? lines = null)
    {
        var form = new MultipartFormDataContent
        {
            { new StringContent(D(Day)), "entryDate" }, { new StringContent(account.ToString()), "accountId" }, { new StringContent("Federal Tax Authority"), "party" },
            { new StringContent(amount.ToString(System.Globalization.CultureInfo.InvariantCulture)), "amount" },
        };
        if (lines is null) form.Add(new StringContent(category.ToString()), "categoryId"); else form.Add(new StringContent(lines), "linesJson");
        if (taxType is not null) form.Add(new StringContent(taxType.ToString()!), "taxTypeId");
        var file = new ByteArrayContent(Pdf);
        file.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        form.Add(file, "files", "payment-advice.pdf");
        return form;
    }

    private async Task<decimal> BalanceAsync(string token, string code) =>
        (await SendAsync(HttpMethod.Get, "/api/finance/ledger/accounts", token)).Body.EnumerateArray().Single(a => a.GetProperty("code").GetString() == code).GetProperty("balance").GetDecimal();

    private async Task<decimal> BankAsync(string token, int id) =>
        (await SendAsync(HttpMethod.Get, "/api/finance/accounts", token)).Body.EnumerateArray().Single(a => a.GetProperty("id").GetInt32() == id).GetProperty("balance").GetDecimal();

    [Fact]
    public async Task PayingTheTaxAuthority_LeavesTheBank_AndClearsVatPayable_WithoutBeingACostOrCarryingVat()
    {
        var token = (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;
        var account = (await TestFinance.AddAccountAsync(api.ConnectionString, opening: 10_000m, openingDate: new DateOnly(2006, 1, 1))).Id;
        var (payable0, plAccounts) = (await BalanceAsync(token, "2200"), (await SendAsync(HttpMethod.Get, "/api/finance/ledger/profit-and-loss?from=2007-03-01&to=2007-03-31", token)).Body.GetProperty("totalExpenses").GetDecimal());
        var vat = $"/api/finance/reports/vat?from=2007-03-01&to=2007-03-31";
        var before = (await SendAsync(HttpMethod.Get, vat, token)).Body;

        // Even if a VAT type is sent, a VAT payment carries none.
        var paid = await SendAsync(HttpMethod.Post, "/api/finance/expenses", token, content: Form(account, 500m, 13, taxType: 1));

        Assert.Equal(HttpStatusCode.Created, paid.Status);
        Assert.Equal(0m, paid.Body.GetProperty("taxAmount").GetDecimal());
        Assert.Equal(9_500m, await BankAsync(token, account));
        Assert.Equal(payable0 - 500m, await BalanceAsync(token, "2200"));        // what we owe the tax authority went down
        Assert.Equal(plAccounts, (await SendAsync(HttpMethod.Get, "/api/finance/ledger/profit-and-loss?from=2007-03-01&to=2007-03-31", token)).Body.GetProperty("totalExpenses").GetDecimal());   // not a cost
        var after = (await SendAsync(HttpMethod.Get, vat, token)).Body;
        Assert.Equal(before.GetProperty("outputVat").GetDecimal(), after.GetProperty("outputVat").GetDecimal());           // and not part of the VAT return
        Assert.Equal(before.GetProperty("inputVat").GetDecimal(), after.GetProperty("inputVat").GetDecimal());
        Assert.Equal(before.GetProperty("unrecordedPurchases").GetProperty("count").GetInt32(), after.GetProperty("unrecordedPurchases").GetProperty("count").GetInt32());
        Assert.True((await SendAsync(HttpMethod.Get, "/api/finance/ledger/check", token)).Body.GetProperty("allAgree").GetBoolean());
    }

    [Fact]
    public async Task ARefundFromTheTaxAuthority_EntersTheBank_AndClearsVatRecoverable()
    {
        var token = (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;
        var account = (await TestFinance.AddAccountAsync(api.ConnectionString, opening: 1_000m, openingDate: new DateOnly(2006, 1, 1))).Id;
        var recoverable0 = await BalanceAsync(token, "1500");

        var refund = await SendAsync(HttpMethod.Post, "/api/finance/income", token, content: Form(account, 200m, 14));

        Assert.Equal(HttpStatusCode.Created, refund.Status);
        Assert.Equal(1_200m, await BankAsync(token, account));
        Assert.Equal(recoverable0 - 200m, await BalanceAsync(token, "1500"));    // an asset that shrinks as it is repaid
        Assert.True((await SendAsync(HttpMethod.Get, "/api/finance/ledger/check", token)).Body.GetProperty("allAgree").GetBoolean());
    }

    [Fact]
    public async Task TheVatCategories_CannotBeSplit_OrUsedOnASupplierBill()
    {
        var token = (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;
        var account = (await TestFinance.AddAccountAsync(api.ConnectionString, opening: 1_000m, openingDate: new DateOnly(2006, 1, 1))).Id;

        var split = await SendAsync(HttpMethod.Post, "/api/finance/expenses", token, content: Form(account, 300m, 0, lines: "[{\"categoryId\":13,\"amount\":100},{\"categoryId\":1,\"amount\":200}]"));
        Assert.Equal(HttpStatusCode.BadRequest, split.Status);

        var bill = await SendAsync(HttpMethod.Post, "/api/finance/bills", token, new
        {
            supplierName = "X", billDate = D(new DateOnly(2007, 3, 1)), dueDate = D(new DateOnly(2007, 3, 31)), taxTypeId = (int?)null, lines = new[] { new { categoryId = 13, amount = 100m } },
        });
        Assert.Equal(HttpStatusCode.BadRequest, bill.Status);
    }

    [Fact]
    public async Task TheVatCategories_AreListedForTheManagerLikeAnyOther()
    {
        var token = (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;
        var categories = (await SendAsync(HttpMethod.Get, "/api/finance/categories", token)).Body.EnumerateArray().Select(c => c.GetProperty("name").GetString()).ToList();
        Assert.Contains("VAT paid to tax authority", categories);                  // the Manager sees them with the others
        Assert.Contains("VAT refund from tax authority", categories);
    }
}
