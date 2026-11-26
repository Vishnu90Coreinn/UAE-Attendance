using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ClosedXML.Excel;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>VAT on expenses and income: the tax types, the arithmetic as it reaches the books, and the VAT return.</summary>
public class FinanceVatTests(ReceiptsFixture api) : IClassFixture<ReceiptsFixture>
{
    private static readonly byte[] Pdf = "%PDF-1.4\n1 0 obj\n<<>>\nendobj\n"u8.ToArray();
    private static string D(DateOnly d) => d.ToString("yyyy-MM-dd");
    private const int Standard = 1, ZeroRated = 2, Exempt = 3, ReverseCharge = 4;

    private async Task<string> ManagerAsync() => (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;

    private async Task<(HttpStatusCode Status, JsonElement Body)> SendAsync(HttpMethod method, string url, string token, object? body = null, HttpContent? content = null)
    {
        var request = new HttpRequestMessage(method, url) { Content = content ?? (body is null ? null : JsonContent.Create(body)) };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var response = await api.Client.SendAsync(request);
        var text = await response.Content.ReadAsStringAsync();
        return (response.StatusCode, string.IsNullOrWhiteSpace(text) ? default : JsonDocument.Parse(text).RootElement);
    }

    private static MultipartFormDataContent Form(int account, decimal amount, DateOnly date, int? taxType, bool? inclusive = null, int category = 1, string? lines = null, string party = "Supplier")
    {
        var form = new MultipartFormDataContent
        {
            { new StringContent(D(date)), "entryDate" }, { new StringContent(account.ToString()), "accountId" }, { new StringContent(party), "party" },
            { new StringContent(amount.ToString(System.Globalization.CultureInfo.InvariantCulture)), "amount" },
        };
        if (lines is null) form.Add(new StringContent(category.ToString()), "categoryId");
        else form.Add(new StringContent(lines), "linesJson");
        if (taxType is not null) form.Add(new StringContent(taxType.ToString()!), "taxTypeId");
        if (inclusive is not null) form.Add(new StringContent(inclusive.Value ? "true" : "false"), "taxInclusive");
        var file = new ByteArrayContent(Pdf);
        file.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        form.Add(file, "files", "receipt.pdf");
        return form;
    }

    /// <summary>March 2006: every VAT figure in this class is its own.</summary>
    private static DateOnly Day(int d) => new(2006, 3, d);

    private async Task<int> AccountAsync() => (await TestFinance.AddAccountAsync(api.ConnectionString, opening: 100_000m, openingDate: new DateOnly(2005, 1, 1))).Id;

    private async Task<Dictionary<string, (decimal Debit, decimal Credit)>> JournalOfAsync(string token, string noteStartsWith)
    {
        var items = (await SendAsync(HttpMethod.Get, "/api/finance/ledger/journals?source=Entry", token)).Body.GetProperty("items").EnumerateArray()
            .Single(j => j.GetProperty("description").GetString()!.EndsWith(noteStartsWith));
        return items.GetProperty("lines").EnumerateArray().GroupBy(l => l.GetProperty("accountName").GetString()!)
            .ToDictionary(g => g.Key, g => (g.Sum(l => l.GetProperty("debit").GetDecimal()), g.Sum(l => l.GetProperty("credit").GetDecimal())));
    }

    [Fact]
    public async Task PartialInputTaxRecovery_PostsBlockedVatAsCost_AndOnlyClaimsRecoverableVat()
    {
        var token = await ManagerAsync();
        var account = await AccountAsync();
        var date = new DateOnly(2007, 7, 10);
        var form = Form(account, 105m, date, Standard, party: "Partial recovery Co");
        form.Add(new StringContent("40"), "recoverableTaxPercent");
        var made = await SendAsync(HttpMethod.Post, "/api/finance/expenses", token, content: form);
        Assert.Equal(HttpStatusCode.Created, made.Status);
        Assert.Equal(40m, made.Body.GetProperty("recoverableTaxPercent").GetDecimal());
        var journal = await JournalOfAsync(token, "Partial recovery Co");
        Assert.Equal(103m, journal["General company expenses"].Debit);
        Assert.Equal(2m, journal["VAT recoverable (input VAT)"].Debit);
        var report = (await SendAsync(HttpMethod.Get, $"/api/finance/reports/vat?from={D(date)}&to={D(date)}", token)).Body;
        Assert.Equal(2m, report.GetProperty("inputVat").GetDecimal());
    }

    [Theory]
    [InlineData(0, 0, 105)]
    [InlineData(40, 2, 103)]
    public async Task SupplierBill_WithPartialRecovery_PostsOnlyEligibleVat(decimal percent, decimal recoverable, decimal cost)
    {
        var token = await ManagerAsync();
        var date = new DateOnly(2007, 9, 10 + (int)percent / 40);
        var made = await SendAsync(HttpMethod.Post, "/api/finance/bills", token, new { supplierName = "Partial recovery bill", supplierRef = "PR-" + percent, billDate = D(date), dueDate = D(date.AddDays(30)), taxTypeId = Standard, recoverableTaxPercent = percent, lines = new[] { new { categoryId = 1, amount = 100m } } });
        Assert.Equal(HttpStatusCode.Created, made.Status);
        var report = (await SendAsync(HttpMethod.Get, $"/api/finance/reports/vat?from={D(date)}&to={D(date)}", token)).Body;
        Assert.Equal(recoverable, report.GetProperty("inputVat").GetDecimal());
        var journal = (await SendAsync(HttpMethod.Get, "/api/finance/ledger/journals?source=Bill&sourceId=" + made.Body.GetProperty("id").GetInt32(), token)).Body.GetProperty("items")[0];
        Assert.Equal(cost, journal.GetProperty("lines").EnumerateArray().Single(l => l.GetProperty("accountName").GetString() == "General company expenses").GetProperty("debit").GetDecimal());
    }

    [Theory]
    [InlineData(1, 105, 0)]
    [InlineData(4, 100, 5)]
    public async Task BlockedVat_BecomesCost_AndReverseChargeStillAccountsForOutput(int type, decimal amount, decimal output)
    {
        var token = await ManagerAsync();
        var account = await AccountAsync();
        var date = new DateOnly(2007, 8, 10 + type);
        var form = Form(account, amount, date, type, party: "Blocked VAT " + type);
        form.Add(new StringContent("0"), "recoverableTaxPercent");
        Assert.Equal(HttpStatusCode.Created, (await SendAsync(HttpMethod.Post, "/api/finance/expenses", token, content: form)).Status);
        var report = (await SendAsync(HttpMethod.Get, $"/api/finance/reports/vat?from={D(date)}&to={D(date)}", token)).Body;
        Assert.Equal(0m, report.GetProperty("inputVat").GetDecimal());
        Assert.Equal(output, report.GetProperty("outputVat").GetDecimal());
        var journal = await JournalOfAsync(token, "Blocked VAT " + type);
        Assert.Equal(105m, journal["General company expenses"].Debit);
        Assert.False(journal.ContainsKey("VAT recoverable (input VAT)"));
    }

    [Fact]
    public async Task ReverseChargeBill_PartialRecovery_SplitsBlockedVatAndExportsTheRoundedClaim()
    {
        var token = await ManagerAsync();
        var date = new DateOnly(2007, 10, 10);
        var made = await SendAsync(HttpMethod.Post, "/api/finance/bills", token, new { supplierName = "Split reverse charge bill", supplierRef = "RCM-SPLIT", billDate = D(date), dueDate = D(date.AddDays(30)), taxTypeId = 4, recoverableTaxPercent = 33.33m, lines = new[] { new { categoryId = 1, amount = 17m }, new { categoryId = 5, amount = 33.02m } } });
        Assert.Equal(HttpStatusCode.Created, made.Status);
        var journal = (await SendAsync(HttpMethod.Get, "/api/finance/ledger/journals?source=Bill&sourceId=" + made.Body.GetProperty("id").GetInt32(), token)).Body.GetProperty("items")[0];
        var lines = journal.GetProperty("lines").EnumerateArray().ToList();
        Assert.Equal(lines.Sum(l => l.GetProperty("debit").GetDecimal()), lines.Sum(l => l.GetProperty("credit").GetDecimal()));
        Assert.Equal(0.83m, lines.Single(l => l.GetProperty("accountCode").GetString() == "1500").GetProperty("debit").GetDecimal());
        Assert.Equal(2.50m, lines.Single(l => l.GetProperty("accountCode").GetString() == "2200").GetProperty("credit").GetDecimal());
        Assert.Equal(17.57m, lines.Single(l => l.GetProperty("accountCode").GetString() == "5400").GetProperty("debit").GetDecimal());
        var file = await api.GetAsync($"/api/finance/reports/vat?from={D(date)}&to={D(date)}&format=csv", token);
        file.EnsureSuccessStatusCode();
        var csv = await file.Content.ReadAsStringAsync();
        Assert.EndsWith(",0.83", csv.Split("\r\n").Single(l => l.Contains("VAT reclaimable (input)")));
    }

    [Fact]
    public async Task TaxTypes_AreTheAccountantsList()
    {
        var types = (await SendAsync(HttpMethod.Get, "/api/finance/tax-types", await ManagerAsync())).Body.EnumerateArray().ToList();
        Assert.Equal(["Standard Rated (VAT)", "Zero Rated", "Exempt", "Reverse Charges (VAT)", "Intra GCC"], types.Select(t => t.GetProperty("name").GetString()));
        Assert.Equal(5m, types[0].GetProperty("rate").GetDecimal());
    }

    [Fact]
    public async Task Standard_Included_KeepsTheAmountAsCash_AndSplitsItIntoNetAndVat_InTheBooks()
    {
        var token = await ManagerAsync();
        var account = await AccountAsync();

        var made = await SendAsync(HttpMethod.Post, "/api/finance/expenses", token, content: Form(account, 105m, Day(10), Standard, party: "Included Co"));

        Assert.Equal(HttpStatusCode.Created, made.Status);
        Assert.Equal(105m, made.Body.GetProperty("amount").GetDecimal());
        Assert.Equal(5m, made.Body.GetProperty("taxAmount").GetDecimal());
        Assert.Equal(5m, made.Body.GetProperty("taxRate").GetDecimal());
        var accounts = (await SendAsync(HttpMethod.Get, "/api/finance/accounts", token)).Body.EnumerateArray();
        Assert.Equal(100_000m - 105m, accounts.Single(a => a.GetProperty("id").GetInt32() == account).GetProperty("balance").GetDecimal());   // the whole 105 left the bank
        var journal = await JournalOfAsync(token, "Included Co");
        Assert.Equal(100m, journal["General company expenses"].Debit);                       // the cost is the net
        Assert.Equal(5m, journal["VAT recoverable (input VAT)"].Debit);              // the VAT is claimable
    }

    [Fact]
    public async Task Standard_AddedOnTop_RaisesTheCash()
    {
        var token = await ManagerAsync();
        var account = await AccountAsync();

        var made = await SendAsync(HttpMethod.Post, "/api/finance/expenses", token, content: Form(account, 100m, Day(11), Standard, inclusive: false, party: "On Top Co"));

        Assert.Equal(105m, made.Body.GetProperty("amount").GetDecimal());   // 100 typed, 5 added
        Assert.Equal(5m, made.Body.GetProperty("taxAmount").GetDecimal());
        Assert.False(made.Body.GetProperty("taxInclusive").GetBoolean());
    }

    [Fact]
    public async Task SplitExpenseWithVatAddedOnTop_ScalesTheLines_AndPostsEachLinesNet()
    {
        var token = await ManagerAsync();
        var account = await AccountAsync();
        var lines = "[{\"categoryId\":5,\"amount\":2000},{\"categoryId\":9,\"amount\":3000}]";

        var made = await SendAsync(HttpMethod.Post, "/api/finance/expenses", token, content: Form(account, 5000m, Day(12), Standard, inclusive: false, lines: lines, party: "Split VAT Co"));

        Assert.Equal(5250m, made.Body.GetProperty("amount").GetDecimal());
        Assert.Equal(250m, made.Body.GetProperty("taxAmount").GetDecimal());
        Assert.Equal([3150m, 2100m], made.Body.GetProperty("lines").EnumerateArray().Select(l => l.GetProperty("amount").GetDecimal()));   // each line carries its VAT; they add up to the cash
        var journal = await JournalOfAsync(token, "Split VAT Co");
        Assert.Equal(2000m, journal["Worker accommodation rent"].Debit);
        Assert.Equal(3000m, journal["Recruitment commission"].Debit);
        Assert.Equal(250m, journal["VAT recoverable (input VAT)"].Debit);
    }

    [Fact]
    public async Task Income_Standard_PostsOutputVat()
    {
        var token = await ManagerAsync();
        var account = await AccountAsync();
        var form = Form(account, 1050m, Day(13), Standard, category: 10, party: "Customer VAT Co");

        var made = await SendAsync(HttpMethod.Post, "/api/finance/income", token, content: form);

        Assert.Equal(HttpStatusCode.Created, made.Status);
        var journal = await JournalOfAsync(token, "Customer VAT Co");
        Assert.Equal(1000m, journal["Other income"].Credit);
        Assert.Equal(50m, journal["VAT payable (output VAT)"].Credit);
        Assert.Equal(1050m, journal.Single(j => j.Key != "Other income" && j.Key != "VAT payable (output VAT)").Value.Debit);
    }

    [Fact]
    public async Task ReverseCharge_PaysNoVatInCash_ButPostsTheMatchingPairForTheReturn()
    {
        var token = await ManagerAsync();
        var account = await AccountAsync();

        var made = await SendAsync(HttpMethod.Post, "/api/finance/expenses", token, content: Form(account, 1000m, Day(14), ReverseCharge, party: "Abroad Ltd"));

        Assert.Equal(1000m, made.Body.GetProperty("amount").GetDecimal());   // nothing extra leaves the bank
        Assert.Equal(50m, made.Body.GetProperty("taxAmount").GetDecimal());
        var journal = await JournalOfAsync(token, "Abroad Ltd");
        Assert.Equal(1000m, journal["General company expenses"].Debit);
        Assert.Equal(50m, journal["VAT recoverable (input VAT)"].Debit);
        Assert.Equal(50m, journal["VAT payable (output VAT)"].Credit);
    }

    [Theory]
    [InlineData(ZeroRated)]
    [InlineData(Exempt)]
    public async Task ZeroRatedAndExempt_CarryNoVat_AndPostNoVatLines(int type)
    {
        var token = await ManagerAsync();
        var account = await AccountAsync();
        var party = $"Plain {type} Co";

        var made = await SendAsync(HttpMethod.Post, "/api/finance/expenses", token, content: Form(account, 500m, Day(15), type, party: party));

        Assert.Equal(0m, made.Body.GetProperty("taxAmount").GetDecimal());
        var journal = await JournalOfAsync(token, party);
        Assert.DoesNotContain(journal.Keys, k => k.StartsWith("VAT"));
    }

    [Fact]
    public async Task CategoryDefault_IsUsedWhenNothingIsChosen_AndZeroMeansNoVat()
    {
        var token = await ManagerAsync();
        var account = await AccountAsync();
        var set = await SendAsync(HttpMethod.Put, "/api/finance/categories/2/tax-default", token, new { taxTypeId = Exempt });   // government fees
        Assert.Equal(Exempt, set.Body.GetProperty("defaultTaxTypeId").GetInt32());

        var defaulted = await SendAsync(HttpMethod.Post, "/api/finance/expenses", token, content: Form(account, 300m, Day(16), null, category: 2, party: "Default Co"));
        var none = await SendAsync(HttpMethod.Post, "/api/finance/expenses", token, content: Form(account, 300m, Day(16), 0, category: 2, party: "None Co"));
        await SendAsync(HttpMethod.Put, "/api/finance/categories/2/tax-default", token, new { taxTypeId = (int?)null });

        Assert.Equal(Exempt, defaulted.Body.GetProperty("taxTypeId").GetInt32());
        Assert.Equal(JsonValueKind.Null, none.Body.GetProperty("taxTypeId").ValueKind);   // 0 says "no VAT recorded", on purpose
        Assert.Equal(HttpStatusCode.BadRequest, (await SendAsync(HttpMethod.Put, "/api/finance/categories/2/tax-default", token, new { taxTypeId = 99 })).Status);
    }

    [Fact]
    public async Task UnknownTaxType_IsRefused()
    {
        var token = await ManagerAsync();
        var made = await SendAsync(HttpMethod.Post, "/api/finance/expenses", token, content: Form(await AccountAsync(), 10m, Day(17), 99));
        Assert.Equal(HttpStatusCode.BadRequest, made.Status);
        Assert.True(made.Body.GetProperty("errors").TryGetProperty("taxTypeId", out _));
    }

    [Fact]
    public async Task Correction_CarriesTheVatToo()
    {
        var token = await ManagerAsync();
        var account = await AccountAsync();
        var made = await SendAsync(HttpMethod.Post, "/api/finance/expenses", token, content: Form(account, 105m, Day(18), Standard, party: "Fix Co"));

        var fixedIt = await SendAsync(HttpMethod.Put, $"/api/finance/expenses/{made.Body.GetProperty("id").GetInt32()}", token, content: Form(account, 210m, Day(18), Standard, party: "Fix Co"));

        Assert.Equal(HttpStatusCode.Created, fixedIt.Status);
        Assert.Equal(10m, fixedIt.Body.GetProperty("taxAmount").GetDecimal());
    }

    [Fact]
    public async Task VatReport_ShowsSalesPurchasesAndTheNetPayable_AndWhatHasNoTypeYet()
    {
        var token = await ManagerAsync();
        var account = (await TestFinance.AddAccountAsync(api.ConnectionString, opening: 100_000m, openingDate: new DateOnly(2003, 1, 1))).Id;
        var d = new DateOnly(2004, 8, 10);   // a month nobody else uses
        await SendAsync(HttpMethod.Post, "/api/finance/income", token, content: Form(account, 2100m, d, Standard, category: 10, party: "Sale 1"));   // net 2,000, output 100
        await SendAsync(HttpMethod.Post, "/api/finance/income", token, content: Form(account, 400m, d, ZeroRated, category: 10, party: "Export"));
        await SendAsync(HttpMethod.Post, "/api/finance/expenses", token, content: Form(account, 105m, d, Standard, party: "Buy 1"));    // net 100, input 5
        await SendAsync(HttpMethod.Post, "/api/finance/expenses", token, content: Form(account, 1000m, d, ReverseCharge, party: "Abroad"));   // 50 out and 50 in
        await SendAsync(HttpMethod.Post, "/api/finance/expenses", token, content: Form(account, 70m, d, 0, party: "No type"));

        var vat = (await SendAsync(HttpMethod.Get, "/api/finance/reports/vat?from=2004-08-01&to=2004-08-31", token)).Body;

        Assert.Equal(150m, vat.GetProperty("outputVat").GetDecimal());   // 100 on the sale + 50 reverse charge
        Assert.Equal(55m, vat.GetProperty("inputVat").GetDecimal());     // 5 + 50 reclaimed
        Assert.Equal(95m, vat.GetProperty("netPayable").GetDecimal());   // owed to the tax authority
        var sales = vat.GetProperty("sales").EnumerateArray().ToDictionary(r => r.GetProperty("treatment").GetString()!);
        Assert.Equal(2000m, sales["Standard"].GetProperty("net").GetDecimal());
        Assert.Equal(400m, sales["ZeroRated"].GetProperty("net").GetDecimal());
        var purchases = vat.GetProperty("purchases").EnumerateArray().ToDictionary(r => r.GetProperty("treatment").GetString()!);
        Assert.Equal(100m, purchases["Standard"].GetProperty("net").GetDecimal());
        Assert.Equal(1000m, purchases["ReverseCharge"].GetProperty("net").GetDecimal());
        Assert.Equal(1, vat.GetProperty("unrecordedPurchases").GetProperty("count").GetInt32());
        Assert.Equal(70m, vat.GetProperty("unrecordedPurchases").GetProperty("amount").GetDecimal());
    }

    [Fact]
    public async Task VatReport_DownloadsAndAccess()
    {
        var token = await ManagerAsync();
        async Task<byte[]> Get(string format)
        {
            var request = new HttpRequestMessage(HttpMethod.Get, $"/api/finance/reports/vat?from=2004-08-01&to=2004-08-31&format={format}");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            var response = await api.Client.SendAsync(request);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            return await response.Content.ReadAsByteArrayAsync();
        }

        using (var book = new XLWorkbook(new MemoryStream(await Get("xlsx")))) Assert.NotNull(book.Worksheet("VAT return"));
        Assert.Contains("Net VAT payable", System.Text.Encoding.UTF8.GetString(await Get("csv")));
        Assert.Equal(new byte[] { 0x25, 0x50, 0x44, 0x46 }, (await Get("pdf"))[..4]);
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(HttpMethod.Get, "/api/finance/reports/vat", (await TestWorkers.SignInAsync(api, Roles.Viewer)).Token)).Status);
        Assert.Equal(HttpStatusCode.Forbidden, (await SendAsync(HttpMethod.Get, "/api/finance/reports/vat", (await TestWorkers.SignInAsync(api, Roles.HR)).Token)).Status);
        Assert.Equal(HttpStatusCode.BadRequest, (await SendAsync(HttpMethod.Get, "/api/finance/reports/vat?from=2004-09-01&to=2004-08-01", token)).Status);
    }

    [Fact]
    public async Task TheBooksStillBalanceAndAgreeWithTheScreens_WithEveryKindOfVat()
    {
        var token = await ManagerAsync();
        var account = await AccountAsync();
        foreach (var (type, inclusive) in new[] { (Standard, true), (Standard, false), (ReverseCharge, true), (ZeroRated, true), (Exempt, true) })
            await SendAsync(HttpMethod.Post, "/api/finance/expenses", token, content: Form(account, 333.33m, Day(20), type, inclusive, party: $"Mix {type} {inclusive}"));

        var check = (await SendAsync(HttpMethod.Get, "/api/finance/ledger/check", token)).Body;
        Assert.True(check.GetProperty("allAgree").GetBoolean(), string.Join("; ", check.GetProperty("checks").EnumerateArray().Where(c => !c.GetProperty("agrees").GetBoolean()).Select(c => c.GetProperty("subject").GetString())));
        Assert.True((await SendAsync(HttpMethod.Get, "/api/finance/ledger/balance-sheet", token)).Body.GetProperty("balanced").GetBoolean());
    }
}
