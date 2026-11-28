using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>Invoices and finance income pick their customers from one list.</summary>
public class SharedClientListTests(ReceiptsFixture api) : IClassFixture<ReceiptsFixture>
{
    private static readonly byte[] Pdf = "%PDF-1.4\n1 0 obj\n<<>>\nendobj\n"u8.ToArray();
    private static string D(DateOnly date) => date.ToString("yyyy-MM-dd");
    private async Task<string> ManagerAsync() => (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;

    private async Task<(HttpStatusCode Status, JsonElement Body)> SendAsync(HttpMethod method, string url, string token, object? body = null, HttpContent? content = null)
    {
        var request = new HttpRequestMessage(method, url) { Content = content ?? (body is null ? null : JsonContent.Create(body)) };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var response = await api.Client.SendAsync(request);
        var text = await response.Content.ReadAsStringAsync();
        return (response.StatusCode, string.IsNullOrWhiteSpace(text) ? default : JsonDocument.Parse(text).RootElement);
    }

    private async Task<int> AccountAsync() => (await TestFinance.AddAccountAsync(api.ConnectionString, opening: 50_000m)).Id;

    private async Task<(HttpStatusCode Status, JsonElement Body)> IncomeAsync(string token, int account, string party, int? clientId = null, decimal amount = 100m)
    {
        var form = new MultipartFormDataContent
        {
            { new StringContent(D(TestFinance.Today)), "entryDate" }, { new StringContent(account.ToString()), "accountId" }, { new StringContent(party), "party" },
            { new StringContent(amount.ToString(System.Globalization.CultureInfo.InvariantCulture)), "amount" }, { new StringContent("10"), "categoryId" },
        };
        if (clientId is not null) form.Add(new StringContent(clientId.ToString()!), "clientId");
        var file = new ByteArrayContent(Pdf);
        file.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        form.Add(file, "files", "receipt.pdf");
        return await SendAsync(HttpMethod.Post, "/api/finance/income", token, content: form);
    }

    private async Task<int> ClientAsync(string token, string name)
    {
        var made = await SendAsync(HttpMethod.Post, "/api/invoice-clients", token, new { name, trn = "100", address = "Dubai" });
        Assert.Equal(HttpStatusCode.Created, made.Status);
        return made.Body.GetProperty("id").GetInt32();
    }

    private async Task<JsonElement> InvoiceAsync(string token, string clientName, string? trn = null, int? clientId = null)
    {
        var made = await SendAsync(HttpMethod.Post, "/api/invoices", token, new
        {
            clientId, clientName, clientTrn = trn, clientAddress = "Deira", invoiceDate = D(TestFinance.Today), dueDate = D(TestFinance.Today),
            lines = new[] { new { description = "Works", quantity = 1m, rate = 100m } },
        });
        Assert.Equal(HttpStatusCode.Created, made.Status);
        return made.Body;
    }

    private async Task<List<JsonElement>> ClientsNamedAsync(string token, string name) =>
        (await SendAsync(HttpMethod.Get, "/api/invoice-clients?includeInactive=true", token)).Body.EnumerateArray()
            .Where(c => string.Equals(c.GetProperty("name").GetString(), name, StringComparison.OrdinalIgnoreCase)).ToList();

    private static int? ClientOf(JsonElement body) => body.GetProperty("clientId") is { ValueKind: JsonValueKind.Number } id ? id.GetInt32() : null;

    [Fact]
    public async Task AClientTypedOnAnInvoice_IsAddedToTheList_Once()
    {
        var token = await ManagerAsync();
        var name = TestFinance.Unique("Typed client");

        var first = await InvoiceAsync(token, name, "555");
        var again = await InvoiceAsync(token, name.ToUpperInvariant());

        var listed = Assert.Single(await ClientsNamedAsync(token, name));
        Assert.Equal("555", listed.GetProperty("trn").GetString());
        Assert.Equal("Deira", listed.GetProperty("address").GetString());
        Assert.Equal(listed.GetProperty("id").GetInt32(), ClientOf(first));
        Assert.Equal(ClientOf(first), ClientOf(again));
        Assert.Equal("555", again.GetProperty("clientTrn").GetString());   // a blank is filled from the saved client
    }

    [Fact]
    public async Task Income_TakesTheClientPickedOrNamed_AndNothingElse()
    {
        var token = await ManagerAsync();
        var account = await AccountAsync();
        var name = TestFinance.Unique("Shared client");
        var client = await ClientAsync(token, name);

        var picked = await IncomeAsync(token, account, "ignored", client);
        var named = await IncomeAsync(token, account, name.ToLowerInvariant());
        var other = await IncomeAsync(token, account, TestFinance.Unique("Bank interest"));

        Assert.Equal(HttpStatusCode.Created, picked.Status);
        Assert.Equal(name, picked.Body.GetProperty("party").GetString());
        Assert.Equal(client, ClientOf(picked.Body));
        Assert.Equal(client, ClientOf(named.Body));
        Assert.Equal(name, named.Body.GetProperty("party").GetString());   // spelt the way the list spells it
        Assert.Null(ClientOf(other.Body));
        Assert.Empty(await ClientsNamedAsync(token, other.Body.GetProperty("party").GetString()!));   // income never adds clients
    }

    [Fact]
    public async Task Income_RefusesAClientThatIsSwitchedOffOrMissing()
    {
        var token = await ManagerAsync();
        var account = await AccountAsync();
        var name = TestFinance.Unique("Old client");
        var client = await ClientAsync(token, name);
        await SendAsync(HttpMethod.Put, $"/api/invoice-clients/{client}", token, new { name, trn = "", address = "", isActive = false });

        foreach (var id in new[] { client, 999_999 })
        {
            var refused = await IncomeAsync(token, account, "x", id);
            Assert.Equal(HttpStatusCode.BadRequest, refused.Status);
            Assert.True(refused.Body.GetProperty("errors").TryGetProperty("clientId", out _));
        }
    }

    [Fact]
    public async Task InvoicePaymentsAndIncome_AddUpUnderOneClient()
    {
        var token = await ManagerAsync();
        var account = await AccountAsync();
        var name = TestFinance.Unique("Paying client");
        var invoice = await InvoiceAsync(token, name);
        var client = ClientOf(invoice)!.Value;
        var id = invoice.GetProperty("id").GetInt32();
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(HttpMethod.Post, $"/api/invoices/{id}/issue", token, new { })).Status);
        var paid = await SendAsync(HttpMethod.Post, $"/api/invoices/{id}/payments", token, new { paidDate = D(TestFinance.Today), amount = 105m, method = "Bank", accountId = account });
        Assert.Equal(HttpStatusCode.OK, paid.Status);
        await IncomeAsync(token, account, name, amount: 45m);

        var row = (await SendAsync(HttpMethod.Get, "/api/finance/clients", token)).Body.EnumerateArray().Single(c => c.GetProperty("id").GetInt32() == client);

        Assert.Equal(2, row.GetProperty("entryCount").GetInt32());
        Assert.Equal(150m, row.GetProperty("total").GetDecimal());
    }

    [Fact]
    public async Task AClientsUnpaidInvoices_AreReported_UntilTheyArePaid()
    {
        var token = await ManagerAsync();
        var account = await AccountAsync();
        var name = TestFinance.Unique("Owing client");
        var first = await InvoiceAsync(token, name);
        var client = ClientOf(first)!.Value;
        var id = first.GetProperty("id").GetInt32();
        await InvoiceAsync(token, name);   // a draft is not owed yet

        async Task<(decimal Unpaid, string[] Numbers)> OwedAsync()
        {
            var row = (await SendAsync(HttpMethod.Get, "/api/finance/clients", token)).Body.EnumerateArray().Single(c => c.GetProperty("id").GetInt32() == client);
            return (row.GetProperty("unpaid").GetDecimal(), row.GetProperty("unpaidInvoices").EnumerateArray().Select(n => n.GetString()!).ToArray());
        }

        Task<(HttpStatusCode Status, JsonElement Body)> PayAsync(decimal amount) =>
            SendAsync(HttpMethod.Post, $"/api/invoices/{id}/payments", token, new { paidDate = D(TestFinance.Today), amount, method = "Bank", accountId = account });

        Assert.Equal((0m, 0), ((await OwedAsync()).Unpaid, (await OwedAsync()).Numbers.Length));
        var number = (await SendAsync(HttpMethod.Post, $"/api/invoices/{id}/issue", token, new { })).Body.GetProperty("number").GetString()!;

        var owed = await OwedAsync();
        Assert.Equal(105m, owed.Unpaid);
        Assert.Equal([number], owed.Numbers);

        Assert.Equal(HttpStatusCode.OK, (await PayAsync(45m)).Status);
        Assert.Equal(60m, (await OwedAsync()).Unpaid);

        Assert.Equal(HttpStatusCode.OK, (await PayAsync(60m)).Status);
        var paid = await OwedAsync();
        Assert.Equal(0m, paid.Unpaid);
        Assert.Empty(paid.Numbers);
    }

    [Fact]
    public async Task PayeesAreOnlyForPeopleTheCompanyPays()
    {
        var token = await ManagerAsync();

        var refused = await SendAsync(HttpMethod.Post, "/api/finance/payees", token, new { kind = "Income", name = TestFinance.Unique("Source") });

        Assert.Equal(HttpStatusCode.BadRequest, refused.Status);
        Assert.Contains("client list", refused.Body.GetProperty("errors").GetProperty("kind")[0].GetString());
    }
}
