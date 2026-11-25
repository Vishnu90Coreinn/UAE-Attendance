using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ClosedXML.Excel;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>Expenses and income from an Excel file: checked row by row, saved all at once or not at all, and never twice.</summary>
public class FinanceImportTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private async Task<string> ManagerAsync() => (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;

    private static byte[] Book(string[] headers, params object?[][] rows)
    {
        using var book = new XLWorkbook();
        var sheet = book.Worksheets.Add("Expenses");
        for (var c = 0; c < headers.Length; c++) sheet.Cell(1, c + 1).Value = headers[c];
        for (var r = 0; r < rows.Length; r++)
            for (var c = 0; c < rows[r].Length; c++)
                if (rows[r][c] is { } v) sheet.Cell(r + 2, c + 1).Value = XLCellValue.FromObject(v);
        using var stream = new MemoryStream();
        book.SaveAs(stream);
        return stream.ToArray();
    }

    private static readonly string[] Expense = ["Date", "Paid to", "Category", "Account", "Amount", "Reference", "Notes"];

    private async Task<(HttpResponseMessage Response, JsonElement Body)> UploadAsync(string token, string kind, byte[] file, bool commit)
    {
        var form = new MultipartFormDataContent();
        var content = new ByteArrayContent(file);
        content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        form.Add(content, "file", "import.xlsx");
        var request = new HttpRequestMessage(HttpMethod.Post, $"/api/finance/import/{kind}?commit={commit.ToString().ToLowerInvariant()}") { Content = form };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var response = await api.Client.SendAsync(request);
        var text = await response.Content.ReadAsStringAsync();
        return (response, string.IsNullOrWhiteSpace(text) ? default : JsonDocument.Parse(text).RootElement);
    }

    private async Task<string> AccountNameAsync(decimal opening = 50_000m) => (await TestFinance.AddAccountAsync(api.ConnectionString, opening: opening)).Name;

    private static string D(DateOnly d) => d.ToString("yyyy-MM-dd");

    [Fact]
    public async Task Preview_ChecksEachRow_AndSavesNothing()
    {
        var token = await ManagerAsync();
        var account = await AccountNameAsync();
        var day = TestFinance.Today.AddDays(-3);
        var file = Book(Expense,
            [D(day), "Landlord A", "Office Rent", account, 12000m, "Cheque 1", "Rent"],
            [D(day), "Insurer B", "Dubai Insurance", account, 189.5m, null, null],
            [D(day), "Someone", "No Such Category", account, 10m],
            [D(day), "Someone", "Office Rent", "No Such Account", 10m],
            ["not a date", "Someone", "Office Rent", account, 10m]);

        var (response, body) = await UploadAsync(token, "expenses", file, commit: false);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(2, body.GetProperty("ready").GetInt32());
        Assert.Equal(3, body.GetProperty("errors").GetInt32());
        Assert.Equal(12189.5m, body.GetProperty("readyTotal").GetDecimal());
        Assert.Equal(0, body.GetProperty("imported").GetInt32());
        var rows = body.GetProperty("rows").EnumerateArray().ToList();
        Assert.Contains("No Such Category", rows[2].GetProperty("problems")[0].GetString());
        Assert.Contains("No Such Account", rows[3].GetProperty("problems")[0].GetString());
        Assert.Equal("Error", rows[4].GetProperty("status").GetString());
        var accounts = await (await Get(token, "/api/finance/accounts")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(50_000m, accounts.EnumerateArray().Single(a => a.GetProperty("name").GetString() == account).GetProperty("balance").GetDecimal());
    }

    private Task<HttpResponseMessage> Get(string token, string url)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return api.Client.SendAsync(request);
    }

    [Fact]
    public async Task Commit_SavesEveryGoodRow_NumbersThem_LowersTheBalance_AndAudits()
    {
        var token = await ManagerAsync();
        var account = await AccountNameAsync();
        var day = TestFinance.Today.AddDays(-4);
        var file = Book(Expense, [D(day), "Landlord A", "Office Rent", account, 12000m, "Cheque 1", "Rent"], [D(day), "Insurer B", "Dubai Insurance", account, 500m]);

        var (response, body) = await UploadAsync(token, "expenses", file, commit: true);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(2, body.GetProperty("imported").GetInt32());
        var list = await (await Get(token, $"/api/finance/expenses?q=Landlord A")).Content.ReadFromJsonAsync<JsonElement>();
        var entry = list.GetProperty("items").EnumerateArray().Single(e => e.GetProperty("accountName").GetString() == account);
        Assert.Matches(@"^EXP-\d{6}$", entry.GetProperty("entryNo").GetString());
        Assert.Equal("Office Rent", entry.GetProperty("categoryName").GetString());
        Assert.Empty(entry.GetProperty("attachments").EnumerateArray());   // imported rows have no receipt
        Assert.Single(entry.GetProperty("lines").EnumerateArray());
        var accounts = await (await Get(token, "/api/finance/accounts")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(37_500m, accounts.EnumerateArray().Single(a => a.GetProperty("name").GetString() == account).GetProperty("balance").GetDecimal());
        Assert.NotEmpty(await TestFinance.AuditAsync(api.ConnectionString, "FinImportCompleted"));
    }

    [Fact]
    public async Task Commit_WithAnyBadRow_ImportsNothing()
    {
        var token = await ManagerAsync();
        var account = await AccountNameAsync();
        var day = TestFinance.Today.AddDays(-2);
        var file = Book(Expense, [D(day), "Good Co", "Office Rent", account, 100m], [D(day), "Bad Co", "Office Rent", account, -5m]);

        var (response, body) = await UploadAsync(token, "expenses", file, commit: true);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("Nothing was imported", body.GetProperty("errors").GetProperty("file")[0].GetString());
        var list = await (await Get(token, "/api/finance/expenses?q=Good Co")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Empty(list.GetProperty("items").EnumerateArray());
    }

    [Fact]
    public async Task RunningTheSameFileTwice_AddsNothingTheSecondTime_AndRepeatedRowsInOneFileCountOnce()
    {
        var token = await ManagerAsync();
        var account = await AccountNameAsync();
        var day = TestFinance.Today.AddDays(-6);
        var file = Book(Expense, [D(day), "Repeat Co", "Office Rent", account, 300m], [D(day), "repeat co", "Office Rent", account, 300m]);

        var first = await UploadAsync(token, "expenses", file, commit: true);
        Assert.Equal(1, first.Body.GetProperty("imported").GetInt32());
        Assert.Equal(1, first.Body.GetProperty("duplicates").GetInt32());

        var again = await UploadAsync(token, "expenses", file, commit: true);
        Assert.Equal(HttpStatusCode.BadRequest, again.Response.StatusCode);   // nothing new
        var preview = await UploadAsync(token, "expenses", file, commit: false);
        Assert.Equal(2, preview.Body.GetProperty("duplicates").GetInt32());
        var list = await (await Get(token, "/api/finance/expenses?q=Repeat Co")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Single(list.GetProperty("items").EnumerateArray());
    }

    [Fact]
    public async Task Dates_AcceptDaftraStyleText_AndRealExcelDates()
    {
        var token = await ManagerAsync();
        var account = await AccountNameAsync();
        var day = TestFinance.Today.AddDays(-8);
        var file = Book(Expense, [day.ToString("dd/MM/yyyy"), "Text Date Co", "Office Rent", account, 10m], [day.ToDateTime(TimeOnly.MinValue).AddDays(1), "Real Date Co", "Office Rent", account, 20m]);

        var (_, body) = await UploadAsync(token, "expenses", file, commit: false);

        Assert.Equal(2, body.GetProperty("ready").GetInt32());
        Assert.Equal(D(day), body.GetProperty("rows")[0].GetProperty("date").GetString());
        Assert.Equal(D(day.AddDays(1)), body.GetProperty("rows")[1].GetProperty("date").GetString());
    }

    [Fact]
    public async Task Rows_AreRefused_ForAFutureDate_ADateBeforeTheAccountOpened_AndALockedMonth()
    {
        var token = await ManagerAsync();
        var account = await TestFinance.AddAccountAsync(api.ConnectionString, opening: 100m, openingDate: new DateOnly(2013, 6, 1));
        var locked = (await TestFinance.AddAccountAsync(api.ConnectionString, opening: 100m, openingDate: new DateOnly(2013, 1, 1))).Name;
        var lockRequest = new HttpRequestMessage(HttpMethod.Post, "/api/finance/month-locks/2013-02/lock");
        lockRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        Assert.Equal(HttpStatusCode.OK, (await api.Client.SendAsync(lockRequest)).StatusCode);
        var file = Book(Expense,
            [D(TestFinance.Today.AddDays(5)), "Future", "Office Rent", account.Name, 5m],
            ["2013-05-01", "Early", "Office Rent", account.Name, 5m],
            ["2013-02-10", "Locked", "Office Rent", locked, 5m]);

        var (_, body) = await UploadAsync(token, "expenses", file, commit: false);

        Assert.Equal(3, body.GetProperty("errors").GetInt32());
        var problems = body.GetProperty("rows").EnumerateArray().Select(r => r.GetProperty("problems")[0].GetString()).ToList();
        Assert.Contains("future", problems[0]);
        Assert.Contains("opens on", problems[1]);
        Assert.Contains("locked", problems[2], StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Income_Import_UsesIncomeCategories_AndReceivedFromHeading()
    {
        var token = await ManagerAsync();
        var account = await AccountNameAsync(0m);
        var day = TestFinance.Today.AddDays(-2);
        var file = Book(["Date", "Received from", "Category", "Account", "Amount"], [D(day), "One by Binghatti", "Other income", account, 111767.04m]);
        var (response, body) = await UploadAsync(token, "income", file, commit: true);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(1, body.GetProperty("imported").GetInt32());
        var list = await (await Get(token, "/api/finance/income?q=Binghatti")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains(list.GetProperty("items").EnumerateArray(), e => e.GetProperty("entryNo").GetString()!.StartsWith("INC-") && e.GetProperty("amount").GetDecimal() == 111767.04m);

        var wrongHeading = Book(Expense, [D(day), "X", "Other income", account, 1m]);
        Assert.Equal(HttpStatusCode.BadRequest, (await UploadAsync(token, "income", wrongHeading, commit: false)).Response.StatusCode);   // "Paid to" is not an income heading
    }

    [Fact]
    public async Task BadFiles_AreRefusedWithAMessage_AndTheTemplateOpens()
    {
        var token = await ManagerAsync();
        var notExcel = await UploadAsync(token, "expenses", "plain text"u8.ToArray(), commit: false);
        Assert.Equal(HttpStatusCode.BadRequest, notExcel.Response.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await UploadAsync(token, "expenses", Book(["Date", "Amount"], ["2026-01-01", 5m]), commit: false)).Response.StatusCode);   // headings missing
        Assert.Equal(HttpStatusCode.BadRequest, (await UploadAsync(token, "expenses", Book(Expense), commit: false)).Response.StatusCode);   // no rows
        Assert.Equal(HttpStatusCode.NotFound, (await UploadAsync(token, "transfers", Book(Expense), commit: false)).Response.StatusCode);

        var template = await Get(token, "/api/finance/import/expenses/template");
        template.EnsureSuccessStatusCode();
        using var book = new XLWorkbook(new MemoryStream(await template.Content.ReadAsByteArrayAsync()));
        Assert.Equal("Paid to", book.Worksheet(1).Cell(1, 2).GetString());
    }

    [Fact]
    public async Task OnlyManagersImport_APartnerCannot()
    {
        var partner = (await TestWorkers.SignInAsync(api, Roles.Viewer)).Token;
        Assert.Equal(HttpStatusCode.Forbidden, (await UploadAsync(partner, "expenses", Book(Expense, ["2026-01-01", "x", "Office Rent", "x", 1m]), commit: true)).Response.StatusCode);
    }
}
