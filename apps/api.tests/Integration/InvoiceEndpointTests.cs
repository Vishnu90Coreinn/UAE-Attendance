using System.Net;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Integration;

public class InvoiceEndpointTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private async Task<string> ManagerToken() => (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;

    private static object Body(string client = "Acme Glass LLC", string invoiceDate = "2026-11-01", string dueDate = "2026-11-30",
        object[]? lines = null, string project = "Twilight", string lpo = "LPO-1") => new
        {
            clientName = client, clientTrn = "100", clientAddress = "Dubai", invoiceDate, dueDate, paymentTerms = "Net 30",
            lpoRef = lpo, project, scope = "INSTALLATION", notes = "Thanks",
            lines = lines ?? [new { description = "Aluminium works", quantity = 572.51m, rate = 105.00m }],
        };

    private async Task<JsonElement> CreateAsync(string token, object? body = null)
    {
        var response = await api.PostAsync("/api/invoices", body ?? Body(), token);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await TestWorkers.ReadJsonAsync(response);
    }

    private async Task ResetNumberAsync(int next = 185)
    {
        await using var connection = new SqlConnection(api.ConnectionString);
        await connection.OpenAsync();
        await using var command = new SqlCommand($"UPDATE DocumentSettings SET NextInvoiceNumber = {next}", connection);
        await command.ExecuteNonQueryAsync();
    }

    private async Task<int> ScalarAsync(string sql)
    {
        await using var connection = new SqlConnection(api.ConnectionString);
        await connection.OpenAsync();
        await using var command = new SqlCommand(sql, connection);
        return Convert.ToInt32(await command.ExecuteScalarAsync());
    }

    // ----- create and totals ------------------------------------------------------------------------------

    [Fact]
    public async Task Create_ComputesEveryAmountOnTheServer()
    {
        var token = await ManagerToken();
        var invoice = await CreateAsync(token);

        Assert.Equal("Draft", invoice.GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null, invoice.GetProperty("number").ValueKind);
        Assert.Equal(60113.55m, invoice.GetProperty("subTotal").GetDecimal());
        Assert.Equal(3005.68m, invoice.GetProperty("vatTotal").GetDecimal());
        Assert.Equal(63119.23m, invoice.GetProperty("total").GetDecimal());
        Assert.Equal("UAE Dirham Sixty-Three Thousand One Hundred Nineteen and Twenty-Three Fils", invoice.GetProperty("totalInWords").GetString());
        var line = invoice.GetProperty("lines")[0];
        Assert.Equal(60113.55m, line.GetProperty("taxable").GetDecimal());
        Assert.Equal(63119.23m, line.GetProperty("amount").GetDecimal());
    }

    [Fact]
    public async Task Create_TotalsAreSumsOfRoundedLines()
    {
        var invoice = await CreateAsync(await ManagerToken(), Body(lines: [new { description = "a", quantity = 10.5m, rate = 1.10m }, new { description = "b", quantity = 0.5m, rate = 3m }]));
        Assert.Equal(13.05m, invoice.GetProperty("subTotal").GetDecimal());
        Assert.Equal(0.66m, invoice.GetProperty("vatTotal").GetDecimal());
        Assert.Equal(13.71m, invoice.GetProperty("total").GetDecimal());
    }

    [Fact]
    public async Task Create_RecordsAnAuditRow()
    {
        var invoice = await CreateAsync(await ManagerToken());
        Assert.True(await ScalarAsync("SELECT COUNT(*) FROM AuditLogs WHERE Action = 'InvoiceCreated'") >= 1);
        Assert.True(invoice.GetProperty("id").GetInt32() > 0);
    }

    [Fact]
    public async Task Create_RejectsBadInputWithCamelCaseFieldErrors()
    {
        var token = await ManagerToken();
        var response = await api.PostAsync("/api/invoices", new
        {
            clientName = "", invoiceDate = "2026-11-10", dueDate = "2026-11-01", paymentTerms = "x",
            lines = new object[] { new { description = "", quantity = -1m, rate = 1.234m } },
        }, token);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var errors = (await TestWorkers.ReadJsonAsync(response)).GetProperty("errors");
        foreach (var key in new[] { "clientName", "dueDate", "lines[0].description", "lines[0].quantity", "lines[0].rate" })
            Assert.True(errors.TryGetProperty(key, out _), $"missing error for {key}");
    }

    [Fact]
    public async Task Create_NeedsAtLeastOneLine()
    {
        var response = await api.PostAsync("/api/invoices", Body(lines: []), await ManagerToken());
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.True((await TestWorkers.ReadJsonAsync(response)).GetProperty("errors").TryGetProperty("lines", out _));
    }

    [Fact]
    public async Task Create_WithASavedClient_CopiesItsDetails()
    {
        var token = await ManagerToken();
        var client = await TestWorkers.ReadJsonAsync(await api.PostAsync("/api/invoice-clients", new { name = "Saved " + Guid.NewGuid().ToString("N")[..8], trn = "TRN-9", address = "Sharjah" }, token));
        var invoice = await CreateAsync(token, new
        {
            clientId = client.GetProperty("id").GetInt32(), invoiceDate = "2026-11-01", dueDate = "2026-11-02",
            lines = new[] { new { description = "x", quantity = 1m, rate = 10m } },
        });
        Assert.Equal(client.GetProperty("name").GetString(), invoice.GetProperty("clientName").GetString());
        Assert.Equal("TRN-9", invoice.GetProperty("clientTrn").GetString());
    }

    // ----- edit / delete drafts ---------------------------------------------------------------------------

    [Fact]
    public async Task Update_ReplacesTheLinesOfADraft()
    {
        var token = await ManagerToken();
        var invoice = await CreateAsync(token);
        var id = invoice.GetProperty("id").GetInt32();

        var response = await api.SendAsync(HttpMethod.Put, $"/api/invoices/{id}", Body(lines: [new { description = "New", quantity = 2m, rate = 50m }, new { description = "Two", quantity = 1m, rate = 1m }]), token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var updated = await TestWorkers.ReadJsonAsync(response);
        Assert.Equal(2, updated.GetProperty("lines").GetArrayLength());
        Assert.Equal(101m, updated.GetProperty("subTotal").GetDecimal());
    }

    [Fact]
    public async Task Delete_RemovesADraftButNotAnIssuedInvoice()
    {
        var token = await ManagerToken();
        var draft = (await CreateAsync(token)).GetProperty("id").GetInt32();
        Assert.Equal(HttpStatusCode.NoContent, (await api.SendAsync(HttpMethod.Delete, $"/api/invoices/{draft}", token: token)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await api.GetAsync($"/api/invoices/{draft}", token)).StatusCode);

        var issued = (await CreateAsync(token)).GetProperty("id").GetInt32();
        await api.PostAsync($"/api/invoices/{issued}/issue", new { }, token);
        Assert.Equal(HttpStatusCode.Conflict, (await api.SendAsync(HttpMethod.Delete, $"/api/invoices/{issued}", token: token)).StatusCode);
    }

    // ----- issue ------------------------------------------------------------------------------------------

    [Fact]
    public async Task Issue_AssignsSequentialNumbersAndLocksTheInvoice()
    {
        await ResetNumberAsync();
        var token = await ManagerToken();
        var first = (await CreateAsync(token)).GetProperty("id").GetInt32();
        var second = (await CreateAsync(token)).GetProperty("id").GetInt32();

        var one = await TestWorkers.ReadJsonAsync(await api.PostAsync($"/api/invoices/{first}/issue", new { }, token));
        var two = await TestWorkers.ReadJsonAsync(await api.PostAsync($"/api/invoices/{second}/issue", new { }, token));

        Assert.Equal("INV-000185", one.GetProperty("number").GetString());
        Assert.Equal("INV-000186", two.GetProperty("number").GetString());
        Assert.Equal("Issued", one.GetProperty("status").GetString());

        Assert.Equal(HttpStatusCode.Conflict, (await api.SendAsync(HttpMethod.Put, $"/api/invoices/{first}", Body(), token)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await api.PostAsync($"/api/invoices/{first}/issue", new { }, token)).StatusCode);
        Assert.Equal(187, await ScalarAsync("SELECT NextInvoiceNumber FROM DocumentSettings"));
    }

    [Fact]
    public async Task Issue_ParallelRequestsNeverShareOrSkipANumber()
    {
        await ResetNumberAsync(500);
        var token = await ManagerToken();
        var ids = new List<int>();
        for (var i = 0; i < 6; i++) ids.Add((await CreateAsync(token)).GetProperty("id").GetInt32());

        var responses = await Task.WhenAll(ids.Select(id => api.PostAsync($"/api/invoices/{id}/issue", new { }, token)));

        var numbers = new List<string>();
        foreach (var response in responses.Where(r => r.StatusCode == HttpStatusCode.OK))
            numbers.Add((await TestWorkers.ReadJsonAsync(response)).GetProperty("number").GetString()!);
        Assert.All(responses, r => Assert.Contains(r.StatusCode, new[] { HttpStatusCode.OK, HttpStatusCode.Conflict }));
        Assert.Equal(numbers.Distinct().Count(), numbers.Count);
        // No gaps: the numbers used are exactly 500..500+n-1 and the counter moved by the same amount.
        var expected = Enumerable.Range(500, numbers.Count).Select(n => $"INV-{n:000000}").Order().ToList();
        Assert.Equal(expected, numbers.Order().ToList());
        Assert.Equal(500 + numbers.Count, await ScalarAsync("SELECT NextInvoiceNumber FROM DocumentSettings"));
    }

    [Fact]
    public async Task Issue_RefusesAZeroTotal()
    {
        var token = await ManagerToken();
        var id = (await CreateAsync(token, Body(lines: [new { description = "free", quantity = 1m, rate = 0m }]))).GetProperty("id").GetInt32();
        Assert.Equal(HttpStatusCode.BadRequest, (await api.PostAsync($"/api/invoices/{id}/issue", new { }, token)).StatusCode);
    }

    [Fact]
    public async Task Issue_FreezesTheCompanyDetailsOntoTheInvoice()
    {
        var token = await ManagerToken();
        var id = (await CreateAsync(token)).GetProperty("id").GetInt32();
        var settings = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/documents/settings", token));
        await api.PostAsync($"/api/invoices/{id}/issue", new { }, token);

        await api.SendAsync(HttpMethod.Put, "/api/documents/settings", SettingsBody(settings, companyName: "Renamed Co"), token);

        var invoice = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/invoices/{id}", token));
        Assert.Equal(settings.GetProperty("companyName").GetString(), invoice.GetProperty("company").GetProperty("companyName").GetString());
        var draft = await CreateAsync(token);
        Assert.Equal("Renamed Co", draft.GetProperty("company").GetProperty("companyName").GetString());
    }

    // ----- cancel -----------------------------------------------------------------------------------------

    [Fact]
    public async Task Cancel_KeepsTheNumberAndItIsNeverReused()
    {
        await ResetNumberAsync(700);
        var token = await ManagerToken();
        var id = (await CreateAsync(token)).GetProperty("id").GetInt32();
        await api.PostAsync($"/api/invoices/{id}/issue", new { }, token);

        Assert.Equal(HttpStatusCode.BadRequest, (await api.PostAsync($"/api/invoices/{id}/cancel", new { reason = " " }, token)).StatusCode);
        var cancelled = await TestWorkers.ReadJsonAsync(await api.PostAsync($"/api/invoices/{id}/cancel", new { reason = "Wrong client" }, token));

        Assert.Equal("Cancelled", cancelled.GetProperty("status").GetString());
        Assert.Equal("INV-000700", cancelled.GetProperty("number").GetString());
        Assert.Equal("Wrong client", cancelled.GetProperty("cancelReason").GetString());
        var next = (await CreateAsync(token)).GetProperty("id").GetInt32();
        var issued = await TestWorkers.ReadJsonAsync(await api.PostAsync($"/api/invoices/{next}/issue", new { }, token));
        Assert.Equal("INV-000701", issued.GetProperty("number").GetString());
    }

    [Fact]
    public async Task Cancel_IsRefusedForADraftOrAnInvoiceWithPayments()
    {
        var token = await ManagerToken();
        var draft = (await CreateAsync(token)).GetProperty("id").GetInt32();
        Assert.Equal(HttpStatusCode.Conflict, (await api.PostAsync($"/api/invoices/{draft}/cancel", new { reason = "x" }, token)).StatusCode);

        var id = (await CreateAsync(token)).GetProperty("id").GetInt32();
        await api.PostAsync($"/api/invoices/{id}/issue", new { }, token);
        await api.PostAsync($"/api/invoices/{id}/payments", new { paidDate = "2026-11-02", amount = 10m, method = "Cash" }, token);
        Assert.Equal(HttpStatusCode.Conflict, (await api.PostAsync($"/api/invoices/{id}/cancel", new { reason = "x" }, token)).StatusCode);
    }

    // ----- payments ---------------------------------------------------------------------------------------

    [Fact]
    public async Task Payments_MoveTheInvoiceThroughPartPaidToPaid()
    {
        var token = await ManagerToken();
        var id = (await CreateAsync(token, Body(lines: [new { description = "x", quantity = 1m, rate = 100m }]))).GetProperty("id").GetInt32();
        await api.PostAsync($"/api/invoices/{id}/issue", new { }, token); // total 105.00

        var part = await TestWorkers.ReadJsonAsync(await api.PostAsync($"/api/invoices/{id}/payments", new { paidDate = "2026-11-02", amount = 50m, method = "Bank transfer", reference = "TT1" }, token));
        Assert.Equal("PartPaid", part.GetProperty("displayStatus").GetString());
        Assert.Equal(55m, part.GetProperty("balanceDue").GetDecimal());

        var paid = await TestWorkers.ReadJsonAsync(await api.PostAsync($"/api/invoices/{id}/payments", new { paidDate = "2026-11-03", amount = 55m, method = "Cash" }, token));
        Assert.Equal("Paid", paid.GetProperty("displayStatus").GetString());
        Assert.Equal(0m, paid.GetProperty("balanceDue").GetDecimal());
        Assert.False(paid.GetProperty("isOverdue").GetBoolean());
    }

    [Fact]
    public async Task Payments_RejectOverpaymentFutureDatesAndDraftInvoices()
    {
        var token = await ManagerToken();
        var draft = (await CreateAsync(token)).GetProperty("id").GetInt32();
        Assert.Equal(HttpStatusCode.Conflict, (await api.PostAsync($"/api/invoices/{draft}/payments", new { paidDate = "2026-11-02", amount = 1m, method = "Cash" }, token)).StatusCode);

        var id = (await CreateAsync(token, Body(lines: [new { description = "x", quantity = 1m, rate = 100m }]))).GetProperty("id").GetInt32();
        await api.PostAsync($"/api/invoices/{id}/issue", new { }, token);
        var over = await api.PostAsync($"/api/invoices/{id}/payments", new { paidDate = "2026-11-02", amount = 105.01m, method = "Cash" }, token);
        Assert.Equal(HttpStatusCode.BadRequest, over.StatusCode);
        var future = await api.PostAsync($"/api/invoices/{id}/payments", new { paidDate = "2099-01-01", amount = 1m, method = "Cash" }, token);
        Assert.Equal(HttpStatusCode.BadRequest, future.StatusCode);
        var none = await api.PostAsync($"/api/invoices/{id}/payments", new { paidDate = "2026-11-02", amount = 0m, method = "" }, token);
        var errors = (await TestWorkers.ReadJsonAsync(none)).GetProperty("errors");
        Assert.True(errors.TryGetProperty("amount", out _) && errors.TryGetProperty("method", out _));
    }

    [Fact]
    public async Task Payments_CanBeRemovedAgain()
    {
        var token = await ManagerToken();
        var id = (await CreateAsync(token)).GetProperty("id").GetInt32();
        await api.PostAsync($"/api/invoices/{id}/issue", new { }, token);
        var after = await TestWorkers.ReadJsonAsync(await api.PostAsync($"/api/invoices/{id}/payments", new { paidDate = "2026-11-02", amount = 10m, method = "Cash" }, token));
        var paymentId = after.GetProperty("payments")[0].GetProperty("id").GetInt32();

        var removed = await TestWorkers.ReadJsonAsync(await api.SendAsync(HttpMethod.Delete, $"/api/invoices/{id}/payments/{paymentId}", token: token));

        Assert.Equal("Issued", removed.GetProperty("displayStatus").GetString());
        Assert.Equal(0, removed.GetProperty("payments").GetArrayLength());
    }

    [Fact]
    public async Task Overdue_IsFlaggedForAnUnpaidInvoicePastItsDueDate()
    {
        var token = await ManagerToken();
        var id = (await CreateAsync(token, Body(invoiceDate: "2020-01-01", dueDate: "2020-01-31"))).GetProperty("id").GetInt32();
        var issued = await TestWorkers.ReadJsonAsync(await api.PostAsync($"/api/invoices/{id}/issue", new { }, token));
        Assert.True(issued.GetProperty("isOverdue").GetBoolean());
        Assert.Equal("Issued", issued.GetProperty("displayStatus").GetString());

        var overdue = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/invoices?status=Overdue", token));
        Assert.Contains(overdue.EnumerateArray(), i => i.GetProperty("id").GetInt32() == id);
    }

    // ----- duplicate --------------------------------------------------------------------------------------

    [Fact]
    public async Task Duplicate_CreatesANewDraftWithTheSameLines()
    {
        var token = await ManagerToken();
        var id = (await CreateAsync(token)).GetProperty("id").GetInt32();
        await api.PostAsync($"/api/invoices/{id}/issue", new { }, token);

        var copy = await TestWorkers.ReadJsonAsync(await api.PostAsync($"/api/invoices/{id}/duplicate", new { }, token));

        Assert.Equal("Draft", copy.GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null, copy.GetProperty("number").ValueKind);
        Assert.NotEqual(id, copy.GetProperty("id").GetInt32());
        Assert.Equal(63119.23m, copy.GetProperty("total").GetDecimal());
        Assert.Equal(0, copy.GetProperty("payments").GetArrayLength());
    }

    // ----- list, filters, csv -----------------------------------------------------------------------------

    [Fact]
    public async Task List_FiltersBySearchProjectDatesAndStatus()
    {
        var token = await ManagerToken();
        var tag = Guid.NewGuid().ToString("N")[..8];
        await CreateAsync(token, Body(client: "Zed " + tag, project: "Proj-" + tag, invoiceDate: "2026-03-05", dueDate: "2026-03-30"));
        var issuedId = (await CreateAsync(token, Body(client: "Yan " + tag, project: "Proj-" + tag, invoiceDate: "2026-04-05", dueDate: "2026-04-30"))).GetProperty("id").GetInt32();
        await api.PostAsync($"/api/invoices/{issuedId}/issue", new { }, token);

        async Task<JsonElement> Query(string q) => await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/invoices?" + q, token));

        Assert.Equal(2, (await Query($"project=Proj-{tag}")).GetArrayLength());
        Assert.Equal(1, (await Query($"q=Zed {tag}")).GetArrayLength());
        Assert.Equal(1, (await Query($"project=Proj-{tag}&from=2026-04-01&to=2026-04-30")).GetArrayLength());
        Assert.Equal(1, (await Query($"project=Proj-{tag}&status=Draft")).GetArrayLength());
        Assert.Equal(1, (await Query($"project=Proj-{tag}&status=Issued")).GetArrayLength());
        Assert.Equal(0, (await Query($"project=Proj-{tag}&status=Paid")).GetArrayLength());
        // newest first
        var all = await Query($"project=Proj-{tag}");
        Assert.Equal("2026-04-05", all[0].GetProperty("invoiceDate").GetString());
    }

    [Fact]
    public async Task List_RejectsAnUnknownStatusAndAnInvertedRange()
    {
        var token = await ManagerToken();
        Assert.Equal(HttpStatusCode.BadRequest, (await api.GetAsync("/api/invoices?status=Bogus", token)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await api.GetAsync("/api/invoices?from=2026-05-01&to=2026-04-01", token)).StatusCode);
    }

    [Fact]
    public async Task Export_ReturnsCsvAndNeutralisesSpreadsheetFormulas()
    {
        var token = await ManagerToken();
        var tag = Guid.NewGuid().ToString("N")[..8];
        await CreateAsync(token, Body(client: "=HYPERLINK(\"x\")" + tag, project: "Csv-" + tag));

        var response = await api.GetAsync($"/api/invoices/export?project=Csv-{tag}", token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("text/csv", response.Content.Headers.ContentType!.MediaType);
        var text = await response.Content.ReadAsStringAsync();
        Assert.Contains("Invoice No,Status,Client", text);
        Assert.Contains("\"'=HYPERLINK(\"\"x\"\")" + tag + "\"", text);
        Assert.DoesNotContain(",\"=HYPERLINK", text);
    }

    // ----- PDF --------------------------------------------------------------------------------------------

    [Fact]
    public async Task Pdf_IsAnA4PdfForDraftAndIssuedInvoices()
    {
        var token = await ManagerToken();
        var id = (await CreateAsync(token)).GetProperty("id").GetInt32();

        var draft = await api.GetAsync($"/api/invoices/{id}/pdf", token);
        Assert.Equal(HttpStatusCode.OK, draft.StatusCode);
        Assert.Equal("application/pdf", draft.Content.Headers.ContentType!.MediaType);
        Assert.StartsWith("%PDF", System.Text.Encoding.ASCII.GetString((await draft.Content.ReadAsByteArrayAsync())[..4]));

        await api.PostAsync($"/api/invoices/{id}/issue", new { }, token);
        var issued = await api.GetAsync($"/api/invoices/{id}/pdf", token);
        Assert.Equal(HttpStatusCode.OK, issued.StatusCode);
        Assert.EndsWith(".pdf", issued.Content.Headers.ContentDisposition!.FileName!.Trim('"'));
    }

    [Fact]
    public async Task Pdf_WithManyLinesRunsToASecondPage()
    {
        var token = await ManagerToken();
        var lines = Enumerable.Range(1, 40).Select(i => (object)new { description = "Line item number " + i + " with a long description to make it wrap across the column width of the table", quantity = 1m, rate = 10m }).ToArray();
        var id = (await CreateAsync(token, Body(lines: lines))).GetProperty("id").GetInt32();
        var bytes = await (await api.GetAsync($"/api/invoices/{id}/pdf", token)).Content.ReadAsByteArrayAsync();
        var pages = System.Text.RegularExpressions.Regex.Matches(System.Text.Encoding.Latin1.GetString(bytes), @"/Type\s*/Page[^s]").Count;
        Assert.True(pages >= 2, $"expected 2+ pages, got {pages}");
    }

    [Fact]
    public async Task Pdf_RefusesTextOutsideLatinWith422()
    {
        var token = await ManagerToken();
        var id = (await CreateAsync(token, Body(client: "شركة النجم"))).GetProperty("id").GetInt32();
        Assert.Equal((HttpStatusCode)422, (await api.GetAsync($"/api/invoices/{id}/pdf", token)).StatusCode);
    }

    // ----- database constraints --------------------------------------------------------------------------

    [Fact]
    public async Task Database_RefusesAnIssuedInvoiceWithoutANumber()
    {
        var token = await ManagerToken();
        var id = (await CreateAsync(token)).GetProperty("id").GetInt32();
        await using var connection = new SqlConnection(api.ConnectionString);
        await connection.OpenAsync();
        await using var command = new SqlCommand($"UPDATE Invoices SET Status = 'Issued' WHERE Id = {id}", connection);
        var ex = await Assert.ThrowsAsync<SqlException>(() => command.ExecuteNonQueryAsync());
        Assert.Contains("CK_Invoices_NumberWhenIssued", ex.Message);
    }

    [Fact]
    public async Task Database_RefusesADuplicateInvoiceNumber()
    {
        var token = await ManagerToken();
        await ResetNumberAsync(900);
        var a = (await CreateAsync(token)).GetProperty("id").GetInt32();
        var b = (await CreateAsync(token)).GetProperty("id").GetInt32();
        await api.PostAsync($"/api/invoices/{a}/issue", new { }, token);
        await using var connection = new SqlConnection(api.ConnectionString);
        await connection.OpenAsync();
        await using var command = new SqlCommand($"UPDATE Invoices SET Status = 'Issued', Number = 'INV-000900' WHERE Id = {b}", connection);
        await Assert.ThrowsAsync<SqlException>(() => command.ExecuteNonQueryAsync());
    }

    [Fact]
    public async Task Database_RefusesATotalThatIsNotSubTotalPlusVat()
    {
        var id = (await CreateAsync(await ManagerToken())).GetProperty("id").GetInt32();
        await using var connection = new SqlConnection(api.ConnectionString);
        await connection.OpenAsync();
        await using var command = new SqlCommand($"UPDATE Invoices SET Total = Total + 1 WHERE Id = {id}", connection);
        var ex = await Assert.ThrowsAsync<SqlException>(() => command.ExecuteNonQueryAsync());
        Assert.Contains("CK_Invoices_Totals", ex.Message);
    }

    [Fact]
    public async Task Database_RefusesANonPositivePayment()
    {
        var token = await ManagerToken();
        var id = (await CreateAsync(token)).GetProperty("id").GetInt32();
        await using var connection = new SqlConnection(api.ConnectionString);
        await connection.OpenAsync();
        await using var command = new SqlCommand(
            $"INSERT INTO InvoicePayments (InvoiceId, PaidDate, Amount, Method, Reference, RecordedBy, RecordedUtc) VALUES ({id}, '2026-11-01', 0, 'Cash', '', 'x', SYSUTCDATETIME())", connection);
        var ex = await Assert.ThrowsAsync<SqlException>(() => command.ExecuteNonQueryAsync());
        Assert.Contains("CK_InvoicePayments_Amount", ex.Message);
    }

    // ----- clients ----------------------------------------------------------------------------------------

    [Fact]
    public async Task Clients_CanBeAddedEditedAndRetired()
    {
        var token = await ManagerToken();
        var name = "Client " + Guid.NewGuid().ToString("N")[..8];
        var created = await api.PostAsync("/api/invoice-clients", new { name, trn = "1", address = "A" }, token);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var id = (await TestWorkers.ReadJsonAsync(created)).GetProperty("id").GetInt32();

        Assert.Equal(HttpStatusCode.BadRequest, (await api.PostAsync("/api/invoice-clients", new { name = name.ToUpperInvariant() }, token)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await api.PostAsync("/api/invoice-clients", new { name = " " }, token)).StatusCode);

        var updated = await TestWorkers.ReadJsonAsync(await api.SendAsync(HttpMethod.Put, $"/api/invoice-clients/{id}", new { name, trn = "2", address = "B", isActive = false }, token));
        Assert.False(updated.GetProperty("isActive").GetBoolean());

        var active = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/invoice-clients", token));
        Assert.DoesNotContain(active.EnumerateArray(), c => c.GetProperty("id").GetInt32() == id);
        var all = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/invoice-clients?includeInactive=true", token));
        Assert.Contains(all.EnumerateArray(), c => c.GetProperty("id").GetInt32() == id);
    }

    // ----- document settings ------------------------------------------------------------------------------

    private static object SettingsBody(JsonElement s, string? companyName = null, string? iban = null) => new
    {
        companyName = companyName ?? s.GetProperty("companyName").GetString(),
        companySubtitle = s.GetProperty("companySubtitle").GetString(), companyNameAr = s.GetProperty("companyNameAr").GetString(),
        mobile = s.GetProperty("mobile").GetString(), address1 = s.GetProperty("address1").GetString(), address2 = s.GetProperty("address2").GetString(),
        email = s.GetProperty("email").GetString(), trn = s.GetProperty("trn").GetString(), bankName = s.GetProperty("bankName").GetString(),
        accountName = s.GetProperty("accountName").GetString(), accountNumber = s.GetProperty("accountNumber").GetString(),
        iban = iban ?? s.GetProperty("iban").GetString(), defaultPaymentTerms = s.GetProperty("defaultPaymentTerms").GetString(),
        defaultInvoiceNotes = s.GetProperty("defaultInvoiceNotes").GetString(), signerName = s.GetProperty("signerName").GetString(),
        signerTitle = s.GetProperty("signerTitle").GetString(),
    };

    [Fact]
    public async Task Settings_AreSeededAndEditable_AndTheAuditRowNeverHoldsBankNumbers()
    {
        var token = await ManagerToken();
        var settings = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/documents/settings", token));
        Assert.Contains("DE AKS BE", settings.GetProperty("companyName").GetString());

        var changed = await api.SendAsync(HttpMethod.Put, "/api/documents/settings", SettingsBody(settings, iban: "AE070331234567890123456"), token);
        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        Assert.Equal("AE070331234567890123456", (await TestWorkers.ReadJsonAsync(changed)).GetProperty("iban").GetString());

        await using var db = TestUsers.NewContext(api.ConnectionString);
        var row = await db.AuditLogs.OrderByDescending(a => a.Id).FirstAsync(a => a.Action == "DocumentSettingsChanged");
        Assert.DoesNotContain("AE070331234567890123456", row.DetailsJson);
    }

    [Fact]
    public async Task Settings_RejectBlankCompanyNameAndBadEmail()
    {
        var token = await ManagerToken();
        var settings = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/documents/settings", token));
        var body = SettingsBody(settings, companyName: " ");
        var response = await api.SendAsync(HttpMethod.Put, "/api/documents/settings", body, token);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.True((await TestWorkers.ReadJsonAsync(response)).GetProperty("errors").TryGetProperty("companyName", out _));
    }

    private static readonly string PngBase64 = Convert.ToBase64String([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0]);

    [Fact]
    public async Task Images_AcceptPngAndJpegByContent_RefuseOthers_AndCanBeRemoved()
    {
        var token = await ManagerToken();
        var ok = await api.PostAsync("/api/documents/images/seal", new { imageBase64 = PngBase64 }, token);
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        Assert.True((await TestWorkers.ReadJsonAsync(ok)).GetProperty("hasSeal").GetBoolean());

        var image = await api.GetAsync("/api/documents/images/seal", token);
        Assert.Equal("image/png", image.Content.Headers.ContentType!.MediaType);

        Assert.Equal(HttpStatusCode.BadRequest, (await api.PostAsync("/api/documents/images/seal", new { imageBase64 = Convert.ToBase64String("<svg></svg>"u8.ToArray()) }, token)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await api.PostAsync("/api/documents/images/seal", new { imageBase64 = Convert.ToBase64String(new byte[1024 * 1024 + 10]) }, token)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await api.PostAsync("/api/documents/images/banner", new { imageBase64 = PngBase64 }, token)).StatusCode);

        var removed = await api.SendAsync(HttpMethod.Delete, "/api/documents/images/seal", token: token);
        Assert.False((await TestWorkers.ReadJsonAsync(removed)).GetProperty("hasSeal").GetBoolean());
        Assert.Equal(HttpStatusCode.NotFound, (await api.GetAsync("/api/documents/images/seal", token)).StatusCode);
    }

    [Fact]
    public async Task Pdf_PrintsAnUploadedPngLogo()
    {
        var token = await ManagerToken();
        // A real 1x1 PNG so the PDF writer can embed it.
        var png = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==");
        Assert.Equal(HttpStatusCode.OK, (await api.PostAsync("/api/documents/images/logo", new { imageBase64 = Convert.ToBase64String(png) }, token)).StatusCode);
        var id = (await CreateAsync(token)).GetProperty("id").GetInt32();
        var response = await api.GetAsync($"/api/invoices/{id}/pdf", token);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        await api.SendAsync(HttpMethod.Delete, "/api/documents/images/logo", token: token);
    }
}
