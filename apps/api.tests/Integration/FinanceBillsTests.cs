using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>
/// A supplier bill is a debt until paid: entering it books the cost and the VAT, a payment moves money out of the bank and clears the debt, taking the payment back
/// owes it again, and the books keep agreeing with the bills.
/// </summary>
public class FinanceBillsTests(ApiFixture api) : IClassFixture<ApiFixture>
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

    private object Bill(DateOnly date, DateOnly due, int? taxTypeId, params (int Category, decimal Amount)[] lines) => new
    {
        supplierName = "Gulf Aluminium Supplies", supplierRef = "SUP-77", billDate = D(date), dueDate = D(due), notes = "", taxTypeId,
        lines = lines.Select(l => new { categoryId = l.Category, amount = l.Amount }).ToArray(),
    };

    private async Task<JsonElement> EnterAsync(string token, object body)
    {
        var made = await SendAsync(HttpMethod.Post, "/api/finance/bills", token, body);
        Assert.Equal(HttpStatusCode.Created, made.Status);
        return made.Body;
    }

    private Task<(HttpStatusCode Status, JsonElement Body)> PayAsync(string token, int bill, decimal amount, int account, DateOnly? date = null) =>
        SendAsync(HttpMethod.Post, $"/api/finance/bills/{bill}/pay", token, new { date = D(date ?? Today), amount, accountId = account, reference = "CHQ-9" });

    private async Task<bool> AllAgreeAsync(string token) => (await SendAsync(HttpMethod.Get, "/api/finance/ledger/check", token)).Body.GetProperty("allAgree").GetBoolean();

    [Fact]
    public async Task EnterPayTakeBackVoid_KeepsPayablesVatAndBankInStep()
    {
        var token = await ManagerAsync();
        var account = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 10_000m, openingDate: Today.AddDays(-90));
        var (ap0, vat0) = (await BalanceAsync(token, "2300"), await BalanceAsync(token, "1500"));

        var bill = await EnterAsync(token, Bill(Today.AddDays(-60), Today.AddDays(-40), 1, (5, 1_000m), (1, 500m)));   // 1,500 + 5% VAT
        var id = bill.GetProperty("id").GetInt32();
        Assert.Equal(1_575m, bill.GetProperty("total").GetDecimal());
        Assert.Equal(75m, bill.GetProperty("taxAmount").GetDecimal());
        Assert.StartsWith("BILL-", bill.GetProperty("billNo").GetString());
        Assert.Equal("Overdue", bill.GetProperty("display").GetString());
        Assert.Equal(ap0 + 1_575m, await BalanceAsync(token, "2300"));
        Assert.Equal(vat0 + 75m, await BalanceAsync(token, "1500"));
        Assert.Equal(10_000m, await BankAsync(token, account.Id));                     // nothing paid yet, so the bank has not moved
        var aging = (await SendAsync(HttpMethod.Get, "/api/finance/ledger/payables", token)).Body;
        var row = aging.GetProperty("rows").EnumerateArray().Single(r => r.GetProperty("billId").GetInt32() == id);
        Assert.Equal(1_575m, row.GetProperty("balance").GetDecimal());
        Assert.Equal("31 to 60 days", row.GetProperty("bucket").GetString());
        Assert.True(await AllAgreeAsync(token));

        var part = await PayAsync(token, id, 500m, account.Id);
        Assert.Equal(HttpStatusCode.OK, part.Status);
        Assert.Equal(9_500m, await BankAsync(token, account.Id));
        Assert.Equal(ap0 + 1_075m, await BalanceAsync(token, "2300"));
        Assert.Equal(vat0 + 75m, await BalanceAsync(token, "1500"));                     // paying is not a new cost or new VAT
        Assert.Equal(500m, part.Body.GetProperty("paid").GetDecimal());
        Assert.True(await AllAgreeAsync(token));

        Assert.Equal(HttpStatusCode.BadRequest, (await PayAsync(token, id, 2_000m, account.Id)).Status);          // more than is owed
        var entryId = part.Body.GetProperty("payments")[0].GetProperty("entryId").GetInt32();
        var voidedEntry = await SendAsync(HttpMethod.Post, $"/api/finance/expenses/{entryId}/void", token, new { reason = "x" });
        Assert.Equal(HttpStatusCode.Conflict, voidedEntry.Status);                     // belongs to the bill
        Assert.Contains("supplier bill", voidedEntry.Body.GetProperty("title").GetString());
        Assert.Equal(HttpStatusCode.Conflict, (await SendAsync(HttpMethod.Post, $"/api/finance/bills/{id}/void", token, new { reason = "x" })).Status);   // has a payment

        var back = await SendAsync(HttpMethod.Post, $"/api/finance/bills/{id}/payments/{entryId}/remove", token, new { reason = "Paid twice by mistake" });
        Assert.Equal(HttpStatusCode.OK, back.Status);
        Assert.Equal(10_000m, await BankAsync(token, account.Id));
        Assert.Equal(ap0 + 1_575m, await BalanceAsync(token, "2300"));

        var paid = await PayAsync(token, id, 1_575m, account.Id);
        Assert.Equal("Paid", paid.Body.GetProperty("display").GetString());
        Assert.Equal(8_425m, await BankAsync(token, account.Id));
        Assert.Equal(ap0, await BalanceAsync(token, "2300"));
        Assert.DoesNotContain((await SendAsync(HttpMethod.Get, "/api/finance/ledger/payables", token)).Body.GetProperty("rows").EnumerateArray(), r => r.GetProperty("billId").GetInt32() == id);

        // A reverse-charge bill owes the supplier no VAT, but the company records the VAT as both payable and recoverable. Voiding undoes it.
        var (inVat, outVat) = (await BalanceAsync(token, "1500"), await BalanceAsync(token, "2200"));
        var rc = await EnterAsync(token, Bill(Today.AddDays(-5), Today.AddDays(25), 4, (1, 2_000m)));
        Assert.Equal(2_000m, rc.GetProperty("total").GetDecimal());
        Assert.Equal(inVat + 100m, await BalanceAsync(token, "1500"));
        Assert.Equal(outVat + 100m, await BalanceAsync(token, "2200"));
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(HttpMethod.Post, $"/api/finance/bills/{rc.GetProperty("id").GetInt32()}/void", token, new { reason = "Duplicate" })).Status);
        Assert.Equal(inVat, await BalanceAsync(token, "1500"));
        Assert.Equal(outVat, await BalanceAsync(token, "2200"));
        Assert.Equal(ap0, await BalanceAsync(token, "2300"));
        Assert.True(await AllAgreeAsync(token));
    }

    [Fact]
    public async Task VatReturn_CountsABillOnceFromItsDate_NotWhenItIsPaid()
    {
        var token = await ManagerAsync();
        var account = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 5_000m, openingDate: Today.AddDays(-90));
        var url = $"/api/finance/reports/vat?from={D(Today.AddDays(-30))}&to={D(Today)}";
        var before = (await SendAsync(HttpMethod.Get, url, token)).Body.GetProperty("inputVat").GetDecimal();

        var bill = await EnterAsync(token, Bill(Today.AddDays(-10), Today.AddDays(20), 1, (1, 1_000m)));   // VAT 50
        await PayAsync(token, bill.GetProperty("id").GetInt32(), 1_050m, account.Id);

        Assert.Equal(before + 50m, (await SendAsync(HttpMethod.Get, url, token)).Body.GetProperty("inputVat").GetDecimal());
    }

    [Fact]
    public async Task ARejectedBill_ExplainsWhy_AndALockedMonthTakesNoBills()
    {
        var token = await ManagerAsync();
        var none = await SendAsync(HttpMethod.Post, "/api/finance/bills", token, new { supplierName = "", billDate = D(Today.AddDays(1)), dueDate = "x", lines = Array.Empty<object>() });
        Assert.Equal(HttpStatusCode.BadRequest, none.Status);
        foreach (var key in new[] { "supplierName", "billDate", "dueDate", "lines" }) Assert.True(none.Body.GetProperty("errors").TryGetProperty(key, out _), key);
        var income = await SendAsync(HttpMethod.Post, "/api/finance/bills", token, Bill(Today.AddDays(-1), Today.AddDays(5), null, (10, 100m)));   // category 10 is income
        Assert.Equal(HttpStatusCode.BadRequest, income.Status);

        await TestFinance.AddAccountAsync(api.ConnectionString, opening: 100m, openingDate: new DateOnly(2022, 1, 1));
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(HttpMethod.Post, "/api/finance/month-locks/2022-03/lock", token)).Status);
        var locked = await SendAsync(HttpMethod.Post, "/api/finance/bills", token, Bill(new DateOnly(2022, 3, 10), new DateOnly(2022, 4, 10), null, (1, 100m)));
        Assert.Equal(HttpStatusCode.Conflict, locked.Status);
    }

    private static readonly byte[] Pdf = "%PDF-1.4 supplier invoice"u8.ToArray();

    private async Task<(HttpStatusCode Status, JsonElement Body)> UploadAsync(string token, int bill, params (string Name, byte[] Bytes)[] files)
    {
        var content = new MultipartFormDataContent();
        foreach (var (name, bytes) in files) content.Add(new ByteArrayContent(bytes), "files", name);
        var request = new HttpRequestMessage(HttpMethod.Post, $"/api/finance/bills/{bill}/files") { Content = content };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var response = await api.Client.SendAsync(request);
        var text = await response.Content.ReadAsStringAsync();
        return (response.StatusCode, string.IsNullOrWhiteSpace(text) ? default : JsonDocument.Parse(text).RootElement);
    }

    [Fact]
    public async Task TheSuppliersInvoice_CanBeKeptWithTheBill_ReadBack_AndRemoved()
    {
        var token = await ManagerAsync();
        var bill = (await EnterAsync(token, Bill(Today.AddDays(-3), Today.AddDays(27), 1, (1, 400m)))).GetProperty("id").GetInt32();
        Assert.Equal(0, (await SendAsync(HttpMethod.Get, $"/api/finance/bills/{bill}", token)).Body.GetProperty("files").GetArrayLength());

        var added = await UploadAsync(token, bill, ("supplier-77.pdf", Pdf));
        Assert.Equal(HttpStatusCode.OK, added.Status);
        var file = added.Body.GetProperty("files")[0];
        Assert.Equal("supplier-77.pdf", file.GetProperty("fileName").GetString());
        Assert.Equal("application/pdf", file.GetProperty("contentType").GetString());

        var request = new HttpRequestMessage(HttpMethod.Get, $"/api/finance/bills/files/{file.GetProperty("id").GetInt32()}");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var download = await api.Client.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, download.StatusCode);
        Assert.Equal(Pdf, await download.Content.ReadAsByteArrayAsync());

        var removed = await SendAsync(HttpMethod.Delete, $"/api/finance/bills/{bill}/files/{file.GetProperty("id").GetInt32()}", token);
        Assert.Equal(HttpStatusCode.OK, removed.Status);
        Assert.Equal(0, removed.Body.GetProperty("files").GetArrayLength());
        var gone = new HttpRequestMessage(HttpMethod.Get, $"/api/finance/bills/files/{file.GetProperty("id").GetInt32()}");
        gone.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        Assert.Equal(HttpStatusCode.NotFound, (await api.Client.SendAsync(gone)).StatusCode);
    }

    [Fact]
    public async Task AFileThatIsNotAPdfOrImage_IsRefused_NoMatterWhatItIsCalled_AndAVoidedBillTakesNone()
    {
        var token = await ManagerAsync();
        var bill = (await EnterAsync(token, Bill(Today.AddDays(-3), Today.AddDays(27), null, (1, 50m)))).GetProperty("id").GetInt32();

        var script = await UploadAsync(token, bill, ("invoice.pdf", "<script>alert(1)</script>"u8.ToArray()));
        Assert.Equal(HttpStatusCode.BadRequest, script.Status);                    // judged by its bytes, not its name
        Assert.True(script.Body.GetProperty("errors").TryGetProperty("files", out _));
        Assert.Equal(HttpStatusCode.BadRequest, (await UploadAsync(token, bill)).Status);   // nothing chosen
        var six = Enumerable.Range(0, 6).Select(i => ($"f{i}.pdf", Pdf)).ToArray();
        Assert.Equal(HttpStatusCode.BadRequest, (await UploadAsync(token, bill, six)).Status);   // at most five

        Assert.Equal(HttpStatusCode.OK, (await SendAsync(HttpMethod.Post, $"/api/finance/bills/{bill}/void", token, new { reason = "Wrong supplier" })).Status);
        Assert.Equal(HttpStatusCode.Conflict, (await UploadAsync(token, bill, ("late.pdf", Pdf))).Status);
    }
}
