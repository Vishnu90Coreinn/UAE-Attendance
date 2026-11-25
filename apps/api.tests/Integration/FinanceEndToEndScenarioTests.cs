using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ClosedXML.Excel;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>
/// One walk through the whole finance module with the client's real kind of data: partners, accounts, payees, a split expense, cheques,
/// capital, a staff member's expenses and petty cash, an Excel import, a correction, a month lock, and every report. After each step the
/// figures are checked against arithmetic done here, apart from the app, and at the end every screen's total must agree with every other's.
/// </summary>
public class FinanceEndToEndScenarioTests(ReceiptsFixture api) : IClassFixture<ReceiptsFixture>
{
    private static readonly byte[] Pdf = "%PDF-1.4\n1 0 obj\n<<>>\nendobj\n"u8.ToArray();
    private static string D(DateOnly date) => date.ToString("yyyy-MM-dd");
    private static DateOnly Today => TestFinance.Today;

    private async Task<(HttpStatusCode Status, JsonElement Body)> SendAsync(HttpMethod method, string url, string token, object? body = null, HttpContent? content = null)
    {
        var request = new HttpRequestMessage(method, url) { Content = content ?? (body is null ? null : JsonContent.Create(body)) };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var response = await api.Client.SendAsync(request);
        var text = await response.Content.ReadAsStringAsync();
        return (response.StatusCode, string.IsNullOrWhiteSpace(text) ? default : JsonDocument.Parse(text).RootElement);
    }

    private static MultipartFormDataContent Expense(int account, decimal amount, DateOnly date, string party, int? category = 1, string? lines = null, int? payee = null, string? reference = null)
    {
        var form = new MultipartFormDataContent
        {
            { new StringContent(D(date)), "entryDate" }, { new StringContent(account.ToString()), "accountId" },
            { new StringContent(amount.ToString(System.Globalization.CultureInfo.InvariantCulture)), "amount" }, { new StringContent(party), "party" },
        };
        if (category is not null) form.Add(new StringContent(category.ToString()!), "categoryId");
        if (lines is not null) form.Add(new StringContent(lines), "linesJson");
        if (payee is not null) form.Add(new StringContent(payee.ToString()!), "payeeId");
        if (reference is not null) form.Add(new StringContent(reference), "reference");
        var file = new ByteArrayContent(Pdf);
        file.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        form.Add(file, "files", "receipt.pdf");
        return form;
    }

    private static decimal Dec(JsonElement e, string name) => e.GetProperty(name).GetDecimal();

    [Fact]
    public async Task TheClientsFirstWeeksOnTheNewApp_EveryFigureAgreesEverywhere()
    {
        var manager = (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;
        var partnerToken = (await TestWorkers.SignInAsync(api, Roles.Viewer)).Token;
        var (jesusName, jesus) = await TestWorkers.SignInAsync(api, Roles.Employee);
        var opened = Today.AddDays(-60);

        // ---- 1. Setup: accounts, partners, payees ---------------------------------------------------------------------
        async Task<int> Account(string name, string kind, decimal opening, object? extra = null) =>
            (await SendAsync(HttpMethod.Post, "/api/finance/accounts", manager, new { name, kind, openingBalance = opening, openingDate = D(opened) })).Body.GetProperty("id").GetInt32();
        var rak = await Account("RAKBANK " + TestFinance.Unique("E2E"), "Bank", 10_162m);
        var main = await Account("Main cash " + TestFinance.Unique("E2E"), "Cash", 0m);

        var staffList = (await SendAsync(HttpMethod.Get, "/api/finance/submitters", manager)).Body;
        var jesusId = staffList.EnumerateArray().Single(u => u.GetProperty("username").GetString() == jesusName).GetProperty("userId").GetInt32();
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(HttpMethod.Put, $"/api/finance/submitters/{jesusId}", manager, new { canSubmit = true })).Status);
        var petty = (await SendAsync(HttpMethod.Post, "/api/finance/accounts", manager, new { name = "Jesus petty cash " + TestFinance.Unique("E2E"), kind = "Custody", openingBalance = 0, openingDate = D(opened), holderUserId = jesusId })).Body.GetProperty("id").GetInt32();

        async Task<int> Partner(string name, decimal opening) =>
            (await SendAsync(HttpMethod.Post, "/api/finance/partners", manager, new { name, openingCapital = opening })).Body.GetProperty("id").GetInt32();
        var ahmed = await Partner("Ahmed Allahham", 10_162m);   // what was in the bank on day one was his
        var partnerB = await Partner("Partner B", 0m);
        var partnerC = await Partner("Partner C", 0m);

        async Task<int> Payee(string name, string kind, int category) =>
            (await SendAsync(HttpMethod.Post, "/api/finance/payees", manager, new { kind, name, defaultCategoryId = category })).Body.GetProperty("id").GetInt32();
        var landlord = await Payee("M S K Luxuries Properties", "Expense", 5);
        var binghatti = await Payee("One by Binghatti", "Income", 10);

        // ---- 2. Partners put capital in -------------------------------------------------------------------------------
        async Task Capital(int partner, decimal amount, int daysAgo)
        {
            var form = new MultipartFormDataContent
            {
                { new StringContent(D(Today.AddDays(-daysAgo))), "entryDate" }, { new StringContent(partner.ToString()), "partnerId" },
                { new StringContent(rak.ToString()), "accountId" }, { new StringContent(amount.ToString(System.Globalization.CultureInfo.InvariantCulture)), "amount" },
            };
            Assert.Equal(HttpStatusCode.Created, (await SendAsync(HttpMethod.Post, "/api/finance/capital/contributions", manager, content: form)).Status);
        }

        await Capital(ahmed, 26_960.11m, 50);
        await Capital(partnerB, 100_000m, 49);
        await Capital(partnerC, 50_000m, 48);

        // ---- 3. Expenses: the split payment, the cheque rent, a bank fee, an insurance premium ---------------------------
        var split = await SendAsync(HttpMethod.Post, "/api/finance/expenses", manager, content: Expense(rak, 5_000m, Today.AddDays(-40), "Housing agent", category: null,
            lines: "[{\"categoryId\":5,\"amount\":2000,\"note\":\"Security deposit\"},{\"categoryId\":9,\"amount\":3000,\"note\":\"Agency commission\"}]"));
        Assert.Equal(HttpStatusCode.Created, split.Status);

        var rent = await SendAsync(HttpMethod.Post, "/api/finance/expenses", manager, content: Expense(rak, 12_000m, Today.AddDays(-35), "ignored", category: 5, payee: landlord, reference: "Cheque 000004"));
        Assert.Equal("M S K Luxuries Properties", rent.Body.GetProperty("party").GetString());
        var rentId = rent.Body.GetProperty("id").GetInt32();

        Assert.Equal(HttpStatusCode.Created, (await SendAsync(HttpMethod.Post, "/api/finance/expenses", manager, content: Expense(rak, 156.45m, Today.AddDays(-30), "RAKBANK", category: 1))).Status);
        Assert.Equal(HttpStatusCode.Created, (await SendAsync(HttpMethod.Post, "/api/finance/expenses", manager, content: Expense(rak, 189m, Today.AddDays(-28), "Dubai Insurance", category: 8))).Status);

        // ---- 4. Cheques: the rent cheque is linked, two post-dated ones are commitments ------------------------------------
        async Task<JsonElement> Cheque(string serial, decimal amount, int dueInDays, int? entry = null) =>
            (await SendAsync(HttpMethod.Post, "/api/finance/cheques", manager, new
            {
                direction = "Issued", serial, amount, partyName = "M S K LUXURIES PROPERTIES L.L.C", issueDate = D(Today.AddDays(-35)), dueDate = D(Today.AddDays(dueInDays)), accountId = rak, entryId = entry,
            })).Body;
        var cheque4 = await Cheque("000004", 12_000m, -35, rentId);
        await Cheque("2", 10_000m, 51);
        await Cheque("3", 10_000m, 171);
        var chequeId = cheque4.GetProperty("id").GetInt32();
        await SendAsync(HttpMethod.Post, $"/api/finance/cheques/{chequeId}/status", manager, new { status = "Delivered", date = D(Today.AddDays(-35)) });
        await SendAsync(HttpMethod.Post, $"/api/finance/cheques/{chequeId}/status", manager, new { status = "Cleared", date = D(Today.AddDays(-33)) });
        var chequeSummary = (await SendAsync(HttpMethod.Get, "/api/finance/cheques/summary", manager)).Body;
        Assert.Equal(0m, Dec(chequeSummary, "dueSoonIssued"));          // nothing falls due in the next 30 days
        Assert.Equal(20_000m, Dec(chequeSummary, "laterIssued"));       // two post-dated cheques are already committed
        Assert.Equal(2, chequeSummary.GetProperty("laterIssuedCount").GetInt32());
        Assert.Equal(0, chequeSummary.GetProperty("overdueCount").GetInt32());

        // ---- 5. Income, and a cheque received -----------------------------------------------------------------------------
        var income = new MultipartFormDataContent
        {
            { new StringContent(D(Today.AddDays(-20))), "entryDate" }, { new StringContent("10"), "categoryId" }, { new StringContent(rak.ToString()), "accountId" },
            { new StringContent("111767.04"), "amount" }, { new StringContent(binghatti.ToString()), "payeeId" }, { new StringContent("Sliding door shutters"), "notes" },
        };
        Assert.Equal(HttpStatusCode.Created, (await SendAsync(HttpMethod.Post, "/api/finance/income", manager, content: income)).Status);
        Assert.Equal(HttpStatusCode.Created, (await SendAsync(HttpMethod.Post, "/api/finance/cheques", manager, new
        {
            direction = "Received", serial = "R-8001", amount = 8_000m, partyName = "One by Binghatti", issueDate = D(Today.AddDays(-15)), dueDate = D(Today.AddDays(10)), accountId = rak,
        })).Status);

        // ---- 6. Petty cash: withdraw cash, give Jesus 1,000, he spends 50 (approved) and submits a personal 75 (rejected) --------
        async Task Transfer(int from, int to, decimal amount, int daysAgo) =>
            Assert.Equal(HttpStatusCode.Created, (await SendAsync(HttpMethod.Post, "/api/finance/transfers", manager, new { transferDate = D(Today.AddDays(-daysAgo)), fromAccountId = from, toAccountId = to, amount })).Status);
        await Transfer(rak, main, 3_000m, 18);
        await Transfer(main, petty, 1_000m, 17);

        var options = (await SendAsync(HttpMethod.Get, "/api/finance/my/options", jesus)).Body;
        Assert.Equal(1_000m, Dec(options.GetProperty("accounts").EnumerateArray().Single(a => a.GetProperty("id").GetInt32() == petty), "balance"));
        Assert.DoesNotContain(options.GetProperty("accounts").EnumerateArray(), a => a.GetProperty("id").GetInt32() == rak);   // staff never see the bank

        var sim = await SendAsync(HttpMethod.Post, "/api/finance/my/expenses", jesus, content: Expense(petty, 50m, Today.AddDays(-5), "du", category: 1));
        var personal = await SendAsync(HttpMethod.Post, "/api/finance/my/expenses", jesus, content: Expense(petty, 75m, Today.AddDays(-4), "Pharmacy", category: 1));
        Assert.Equal("Pending", sim.Body.GetProperty("status").GetString());
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(HttpMethod.Post, $"/api/finance/expenses/{sim.Body.GetProperty("id").GetInt32()}/approve", manager)).Status);
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(HttpMethod.Post, $"/api/finance/expenses/{personal.Body.GetProperty("id").GetInt32()}/reject", manager, new { reason = "Personal purchase" })).Status);
        await Transfer(petty, main, 400m, 3);

        // ---- 7. Excel import of three earlier payments (Daftra-style dd/MM/yyyy dates), then the same file again ----------------
        byte[] book;
        using (var wb = new XLWorkbook())
        {
            var sheet = wb.Worksheets.Add("Expenses");
            string[] headers = ["Date", "Paid to", "Category", "Account", "Amount", "Reference"];
            for (var c = 0; c < headers.Length; c++) sheet.Cell(1, c + 1).Value = headers[c];
            var accountName = (await SendAsync(HttpMethod.Get, "/api/finance/accounts", manager)).Body.EnumerateArray().Single(a => a.GetProperty("id").GetInt32() == rak).GetProperty("name").GetString()!;
            object[][] rows =
            [
                [Today.AddDays(-45).ToString("dd/MM/yyyy"), "Taxi Al-Nahda to Al-Quoz", "Worker Transportation", accountName, 270m, "1545"],
                [Today.AddDays(-44).ToString("dd/MM/yyyy"), "Finger Print Priority", "Government-related procedures for workers", accountName, 1560m, "504622"],
                [Today.AddDays(-43).ToString("dd/MM/yyyy"), "Employment dinner", "Company expenses", accountName, 187m, "17630"],
            ];
            for (var r = 0; r < rows.Length; r++)
                for (var c = 0; c < rows[r].Length; c++) sheet.Cell(r + 2, c + 1).Value = XLCellValue.FromObject(rows[r][c]);
            using var stream = new MemoryStream();
            wb.SaveAs(stream);
            book = stream.ToArray();
        }

        MultipartFormDataContent Upload() { var form = new MultipartFormDataContent(); var part = new ByteArrayContent(book); part.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream"); form.Add(part, "file", "daftra.xlsx"); return form; }
        var preview = await SendAsync(HttpMethod.Post, "/api/finance/import/expenses?commit=false", manager, content: Upload());
        Assert.Equal(3, preview.Body.GetProperty("ready").GetInt32());
        Assert.Equal(2_017m, Dec(preview.Body, "readyTotal"));   // 270 + 1,560 + 187
        var imported = await SendAsync(HttpMethod.Post, "/api/finance/import/expenses?commit=true", manager, content: Upload());
        Assert.Equal(3, imported.Body.GetProperty("imported").GetInt32());
        var again = await SendAsync(HttpMethod.Post, "/api/finance/import/expenses?commit=true", manager, content: Upload());
        Assert.Equal(HttpStatusCode.BadRequest, again.Status);   // the same file adds nothing a second time
        Assert.Equal(3, (await SendAsync(HttpMethod.Post, "/api/finance/import/expenses?commit=false", manager, content: Upload())).Body.GetProperty("duplicates").GetInt32());

        // ---- 8. A correction (the premium was 198, not 189) and a void (the dinner was not a company expense) ---------------
        var insurance = (await SendAsync(HttpMethod.Get, "/api/finance/expenses?q=Dubai Insurance", manager)).Body.GetProperty("items").EnumerateArray().Single(e => e.GetProperty("amount").GetDecimal() == 189m);
        var correction = await SendAsync(HttpMethod.Put, $"/api/finance/expenses/{insurance.GetProperty("id").GetInt32()}", manager, content: Expense(rak, 198m, Today.AddDays(-28), "Dubai Insurance", category: 8));
        Assert.Equal(HttpStatusCode.Created, correction.Status);
        Assert.Equal(insurance.GetProperty("entryNo").GetString(), correction.Body.GetProperty("replacesEntryNo").GetString());
        var dinner = (await SendAsync(HttpMethod.Get, "/api/finance/expenses?q=Employment dinner", manager)).Body.GetProperty("items")[0];
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(HttpMethod.Post, $"/api/finance/expenses/{dinner.GetProperty("id").GetInt32()}/void", manager, new { reason = "Personal dinner" })).Status);

        // ---- 9. The figures, worked out here from the story and compared with what every screen says ------------------------
        const decimal capitalIn = 26_960.11m + 100_000m + 50_000m;
        const decimal openingTotal = 10_162m;
        const decimal incomeTotal = 111_767.04m;
        const decimal expenseTotal = 5_000m + 12_000m + 156.45m + 198m + 270m + 1_560m + 50m;   // the corrected premium, the approved SIM, no dinner, no rejected pharmacy
        const decimal closingTotal = openingTotal + capitalIn + incomeTotal - expenseTotal;       // transfers only move money between accounts
        Assert.Equal(279_654.70m, closingTotal);

        var accounts = (await SendAsync(HttpMethod.Get, "/api/finance/accounts", manager)).Body.EnumerateArray().ToList();
        decimal BalanceOf(int id) => Dec(accounts.Single(a => a.GetProperty("id").GetInt32() == id), "balance");
        Assert.Equal(276_704.70m, BalanceOf(rak));   // 10,162 + 176,960.11 + 111,767.04 - 19,184.45 - 3,000
        Assert.Equal(2_400m, BalanceOf(main));       // 3,000 in, 1,000 given to Jesus, 400 back
        Assert.Equal(550m, BalanceOf(petty));        // 1,000 less the approved 50 less the 400 returned
        var mine = (await SendAsync(HttpMethod.Get, "/api/finance/my/options", jesus)).Body.GetProperty("accounts").EnumerateArray().Single(a => a.GetProperty("id").GetInt32() == petty);
        Assert.Equal(550m, Dec(mine, "balance"));    // Jesus sees the same figure
        Assert.Equal(closingTotal, accounts.Where(a => new[] { rak, main, petty }.Contains(a.GetProperty("id").GetInt32())).Sum(a => Dec(a, "balance")));

        var from = D(opened);
        var to = D(Today);
        var report = (await SendAsync(HttpMethod.Get, $"/api/finance/reports/summary?from={from}&to={to}", partnerToken)).Body;   // the Partner reads it
        Assert.Equal(closingTotal, Dec(report.GetProperty("totals"), "closing"));
        Assert.Equal(openingTotal, Dec(report.GetProperty("totals"), "opening"));
        Assert.Equal(incomeTotal, Dec(report.GetProperty("period"), "income"));
        Assert.Equal(expenseTotal, Dec(report.GetProperty("period"), "expense"));
        Assert.Equal(incomeTotal - expenseTotal, Dec(report.GetProperty("period"), "net"));

        var byCategory = report.GetProperty("expenseCategories").EnumerateArray().ToDictionary(c => c.GetProperty("name").GetString()!, c => Dec(c, "amount"));
        Assert.Equal(14_000m, byCategory["Worker Accommodation Rent"]);                       // 2,000 deposit (split) + 12,000 rent
        Assert.Equal(3_000m, byCategory["Commission for Labor"]);                             // the split's other half
        Assert.Equal(206.45m, byCategory["Company expenses"]);                                // bank fee + SIM; the voided dinner and rejected pharmacy are not here
        Assert.Equal(198m, byCategory["Dubai Insurance"]);
        Assert.Equal(270m, byCategory["Worker Transportation"]);
        Assert.Equal(1_560m, byCategory["Government-related procedures for workers"]);
        Assert.Equal(expenseTotal, byCategory.Values.Sum());
        Assert.Equal(100.0m, report.GetProperty("expenseCategories").EnumerateArray().Sum(c => Dec(c, "share")));

        var payees = report.GetProperty("expensePayees").EnumerateArray().ToList();
        Assert.Equal("M S K Luxuries Properties", payees[0].GetProperty("name").GetString());   // the largest single payee
        Assert.Equal(12_000m, Dec(payees[0], "amount"));
        Assert.Equal(expenseTotal, payees.Sum(p => Dec(p, "amount")));
        Assert.Equal(100.0m, payees.Sum(p => Dec(p, "share")));
        Assert.Equal(1, report.GetProperty("incomePayees").GetArrayLength());

        var flow = report.GetProperty("cashFlow");
        Assert.Equal(incomeTotal - expenseTotal, Dec(flow, "operating"));
        Assert.Equal(capitalIn, Dec(flow, "financing"));
        Assert.Equal(0m, Dec(flow, "other"));
        Assert.Equal(closingTotal - openingTotal, Dec(flow, "netChange"));

        var enteredBy = report.GetProperty("enteredBy").EnumerateArray().ToDictionary(p => p.GetProperty("name").GetString()!);
        Assert.Equal(1, enteredBy[jesusName].GetProperty("entries").GetInt32());              // only the approved SIM
        Assert.Equal(50m, Dec(enteredBy[jesusName], "expense"));

        var partners = report.GetProperty("partners").EnumerateArray().ToDictionary(p => p.GetProperty("name").GetString()!);
        Assert.Equal(37_122.11m, Dec(partners["Ahmed Allahham"], "closing"));                 // 10,162 opening + 26,960.11
        Assert.Equal(19.84m, Dec(partners["Ahmed Allahham"], "share"));
        Assert.Equal(53.44m, Dec(partners["Partner B"], "share"));
        Assert.Equal(26.72m, Dec(partners["Partner C"], "share"));
        Assert.Equal(100.00m, partners.Values.Sum(p => Dec(p, "share")));

        var dashboard = (await SendAsync(HttpMethod.Get, "/api/finance/dashboard?days=365", manager)).Body;
        Assert.Equal(closingTotal, Dec(dashboard, "totalBalance"));
        Assert.Equal(capitalIn + 10_162m, Dec(dashboard.GetProperty("capital"), "total"));
        Assert.Equal(100.0m, dashboard.GetProperty("spending").EnumerateArray().Sum(c => Dec(c, "share")));

        var cheques = (await SendAsync(HttpMethod.Get, "/api/finance/cheques?openOnly=true", manager)).Body;
        Assert.Equal(20_000m, Dec(cheques, "openIssued"));       // the two post-dated cheques; the cleared one is no longer a commitment
        Assert.Equal(8_000m, Dec(cheques, "openReceived"));

        // ---- 10. Lock the month the import fell in: nothing can be added to it or voided from it any more -------------------
        var locked = Today.AddDays(-44).ToString("yyyy-MM");
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(HttpMethod.Post, $"/api/finance/month-locks/{locked}/lock", manager)).Status);
        Assert.Equal(HttpStatusCode.Conflict, (await SendAsync(HttpMethod.Post, "/api/finance/expenses", manager, content: Expense(rak, 10m, Today.AddDays(-44), "Late entry"))).Status);
        var importedRow = (await SendAsync(HttpMethod.Get, "/api/finance/expenses?q=Finger Print", manager)).Body.GetProperty("items")[0];
        Assert.Equal(HttpStatusCode.Conflict, (await SendAsync(HttpMethod.Post, $"/api/finance/expenses/{importedRow.GetProperty("id").GetInt32()}/void", manager, new { reason = "x" })).Status);
        var months = (await SendAsync(HttpMethod.Get, $"/api/finance/reports/summary?from={from}&to={to}", manager)).Body.GetProperty("months").EnumerateArray().ToList();
        Assert.True(months.Single(m => m.GetProperty("month").GetString() == locked).GetProperty("isLocked").GetBoolean());
        Assert.Equal(expenseTotal, months.Sum(m => Dec(m, "expense")));   // the months add up to the whole period

        // ---- 11. Downloads carry the same numbers ---------------------------------------------------------------------------
        async Task<byte[]> Download(string format)
        {
            var request = new HttpRequestMessage(HttpMethod.Get, $"/api/finance/reports/summary?from={from}&to={to}&format={format}");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", manager);
            var response = await api.Client.SendAsync(request);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            return await response.Content.ReadAsByteArrayAsync();
        }

        using (var xlsx = new XLWorkbook(new MemoryStream(await Download("xlsx"))))
        {
            var total = xlsx.Worksheet("Statement").RowsUsed().Single(r => r.Cell(1).GetString() == "Total");
            Assert.Equal(closingTotal, (decimal)total.Cell(8).GetDouble());
            Assert.Equal(expenseTotal, (decimal)xlsx.Worksheet("Expenses").RowsUsed().Single(r => r.Cell(1).GetString() == "Total").Cell(3).GetDouble());
        }

        var csv = System.Text.Encoding.UTF8.GetString(await Download("csv"));
        Assert.Contains("Total,", csv);
        Assert.Contains(closingTotal.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture), csv);
        Assert.Equal(new byte[] { 0x25, 0x50, 0x44, 0x46 }, (await Download("pdf"))[..4]);

        // ---- 11b. The books: the ledger agrees with every screen, and the accounting equation holds --------------------------
        var check = (await SendAsync(HttpMethod.Get, "/api/finance/ledger/check", partnerToken)).Body;
        Assert.True(check.GetProperty("allAgree").GetBoolean(), string.Join("; ", check.GetProperty("checks").EnumerateArray().Where(c => !c.GetProperty("agrees").GetBoolean()).Select(c => c.GetProperty("subject").GetString())));
        Assert.True((await SendAsync(HttpMethod.Get, "/api/finance/ledger/trial-balance", partnerToken)).Body.GetProperty("balanced").GetBoolean());
        var chart = (await SendAsync(HttpMethod.Get, "/api/finance/ledger/accounts", partnerToken)).Body.EnumerateArray().ToList();
        decimal ByType(string type) => chart.Where(a => a.GetProperty("type").GetString() == type).Sum(a => Dec(a, "balance"));
        Assert.Equal(closingTotal, ByType("Asset"));                               // what the company holds
        Assert.Equal(incomeTotal, ByType("Revenue"));
        Assert.Equal(expenseTotal, ByType("Expense"));                             // the voided dinner and rejected pharmacy net to nothing or never posted
        Assert.Equal(capitalIn + openingTotal, ByType("Equity"));                 // the partners: 10,162 opening capital plus 176,960.11 put in; opening balance equity nets to zero
        Assert.Equal(ByType("Asset"), ByType("Liability") + ByType("Equity") + ByType("Revenue") - ByType("Expense"));   // assets = liabilities + equity + profit

        var profit = (await SendAsync(HttpMethod.Get, $"/api/finance/ledger/profit-and-loss?from={from}&to={to}", partnerToken)).Body;
        Assert.Equal(incomeTotal, Dec(profit, "totalRevenue"));
        Assert.Equal(expenseTotal, Dec(profit, "totalExpenses"));
        Assert.Equal(Dec(report.GetProperty("period"), "net"), Dec(profit, "netProfit"));      // the statement signed by the accountant equals the finance report
        var balanceSheet = (await SendAsync(HttpMethod.Get, $"/api/finance/ledger/balance-sheet?asOf={to}", partnerToken)).Body;
        Assert.True(balanceSheet.GetProperty("balanced").GetBoolean());
        Assert.Equal(closingTotal, Dec(balanceSheet, "totalAssets"));                                // equal to the balances on the Accounts page, added up
        Assert.Equal(incomeTotal - expenseTotal, Dec(balanceSheet, "retainedProfit"));

        // ---- 12. Who can do what -------------------------------------------------------------------------------------------
        Assert.Equal(HttpStatusCode.Forbidden, (await SendAsync(HttpMethod.Get, "/api/finance/dashboard", jesus)).Status);
        Assert.Equal(HttpStatusCode.Forbidden, (await SendAsync(HttpMethod.Post, "/api/finance/expenses/1/approve", jesus)).Status);
        Assert.Equal(HttpStatusCode.Forbidden, (await SendAsync(HttpMethod.Post, "/api/finance/cheques", partnerToken, new { direction = "Issued" })).Status);
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(HttpMethod.Get, "/api/finance/cheques", partnerToken)).Status);

        // ---- 13. VAT and a cheque left open, the company being VAT-registered ------------------------------------------------
        var vatDay = Today.AddDays(-1);
        var supplies = await SendAsync(HttpMethod.Post, "/api/finance/expenses", manager, content: Expense(rak, 2_100m, vatDay, "Aluminium supplier", category: 1, reference: "Cheque 000005"));
        var suppliesId = supplies.Body.GetProperty("id").GetInt32();
        var vatForm = Expense(rak, 2_100m, vatDay, "Aluminium supplier 2", category: 1);
        vatForm.Add(new StringContent("1"), "taxTypeId");
        var withVat = await SendAsync(HttpMethod.Post, "/api/finance/expenses", manager, content: vatForm);
        Assert.Equal(100m, withVat.Body.GetProperty("taxAmount").GetDecimal());                 // 2,100 includes 100 of VAT
        var openCheque = await SendAsync(HttpMethod.Post, "/api/finance/cheques", manager, new
        {
            direction = "Issued", serial = "000005", amount = 2_100m, partyName = "Aluminium supplier", issueDate = D(vatDay), dueDate = D(Today.AddDays(20)), accountId = rak, entryId = suppliesId,
        });
        Assert.Equal(HttpStatusCode.Created, openCheque.Status);

        var accountsNow = (await SendAsync(HttpMethod.Get, "/api/finance/accounts", manager)).Body.EnumerateArray().ToList();
        var rakNow = accountsNow.Single(a => a.GetProperty("id").GetInt32() == rak);
        Assert.Equal(276_704.70m - 4_200m, Dec(rakNow, "balance"));                             // both purchases are spent
        Assert.Equal(2_100m, Dec(rakNow, "unclearedCheques"));
        Assert.Equal(Dec(rakNow, "balance") + 2_100m, Dec(rakNow, "bankBalance"));              // the bank has not paid the cheque yet
        var checkAgain = (await SendAsync(HttpMethod.Get, "/api/finance/ledger/check", partnerToken)).Body;
        Assert.True(checkAgain.GetProperty("allAgree").GetBoolean());
        var sheetNow = (await SendAsync(HttpMethod.Get, $"/api/finance/ledger/balance-sheet?asOf={to}", partnerToken)).Body;
        Assert.True(sheetNow.GetProperty("balanced").GetBoolean());
        Assert.Equal(2_100m, Dec(sheetNow, "totalLiabilities"));                                // the open cheque is owed
        var vatReturn = (await SendAsync(HttpMethod.Get, $"/api/finance/reports/vat?from={D(vatDay)}&to={D(vatDay)}", partnerToken)).Body;
        Assert.Equal(100m, Dec(vatReturn, "inputVat"));
        Assert.Equal(-100m, Dec(vatReturn, "netPayable"));                                      // a refund claim: only purchases so far
        Assert.Equal(1, vatReturn.GetProperty("unrecordedPurchases").GetProperty("count").GetInt32());   // the first purchase has no VAT type yet, and the return says so
        _ = partnerB; _ = partnerC;
    }
}
