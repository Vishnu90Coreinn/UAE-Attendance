using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>A category can say "never carries VAT" (salaries) or "ask me" (the default), and the app's own categories are kept off the entry forms.</summary>
public class FinanceCategoryDefaultsTests(ReceiptsFixture api) : IClassFixture<ReceiptsFixture>
{
    private static readonly byte[] Pdf = "%PDF-1.4\n1 0 obj\n<<>>\nendobj\n"u8.ToArray();
    private static string D(DateOnly d) => d.ToString("yyyy-MM-dd");

    private async Task<(HttpStatusCode Status, JsonElement Body)> SendAsync(HttpMethod method, string url, string token, object? body = null, HttpContent? content = null)
    {
        var request = new HttpRequestMessage(method, url) { Content = content ?? (body is null ? null : JsonContent.Create(body)) };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var response = await api.Client.SendAsync(request);
        var text = await response.Content.ReadAsStringAsync();
        return (response.StatusCode, string.IsNullOrWhiteSpace(text) ? default : JsonDocument.Parse(text).RootElement);
    }

    private static MultipartFormDataContent Form(int account, int category, decimal amount = 105m)
    {
        var form = new MultipartFormDataContent
        {
            { new StringContent(D(new DateOnly(2008, 3, 10))), "entryDate" }, { new StringContent(account.ToString()), "accountId" }, { new StringContent("Someone"), "party" },
            { new StringContent(amount.ToString(System.Globalization.CultureInfo.InvariantCulture)), "amount" }, { new StringContent(category.ToString()), "categoryId" },
        };
        var file = new ByteArrayContent(Pdf);
        file.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        form.Add(file, "files", "receipt.pdf");
        return form;
    }

    [Fact]
    public async Task ASalaryCategory_NeverCarriesVat_EvenWhenNoVatTypeIsSent_AndTheDefaultCanBeChanged()
    {
        var token = (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;
        var account = (await TestFinance.AddAccountAsync(api.ConnectionString, opening: 10_000m, openingDate: new DateOnly(2007, 1, 1))).Id;

        var salary = await SendAsync(HttpMethod.Post, "/api/finance/expenses", token, content: Form(account, 4));      // Monthly Salary
        Assert.Equal(HttpStatusCode.Created, salary.Status);
        Assert.Equal(0m, salary.Body.GetProperty("taxAmount").GetDecimal());
        var categories = (await SendAsync(HttpMethod.Get, "/api/finance/categories?kind=Expense", token)).Body.EnumerateArray().ToList();
        Assert.True(categories.Single(c => c.GetProperty("id").GetInt32() == 4).GetProperty("noVat").GetBoolean());
        Assert.False(categories.Single(c => c.GetProperty("id").GetInt32() == 1).GetProperty("noVat").GetBoolean());   // company expenses: ask each time

        // The accountant can make a category ask each time, say "never", or offer a VAT type first.
        var rent = await SendAsync(HttpMethod.Put, "/api/finance/categories/7/tax-default", token, new { taxTypeId = 1 });
        Assert.Equal(1, rent.Body.GetProperty("defaultTaxTypeId").GetInt32());
        Assert.False(rent.Body.GetProperty("noVat").GetBoolean());
        var never = await SendAsync(HttpMethod.Put, "/api/finance/categories/7/tax-default", token, new { taxTypeId = 0 });
        Assert.True(never.Body.GetProperty("noVat").GetBoolean());
        Assert.Equal(JsonValueKind.Null, never.Body.GetProperty("defaultTaxTypeId").ValueKind);
        var ask = await SendAsync(HttpMethod.Put, "/api/finance/categories/7/tax-default", token, new { taxTypeId = (int?)null });
        Assert.False(ask.Body.GetProperty("noVat").GetBoolean());
    }

    [Fact]
    public async Task ACategoryTheAppMadeForItself_IsFlagged_AndRefusedOnAnEntry()
    {
        var token = (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;
        var account = (await TestFinance.AddAccountAsync(api.ConnectionString, opening: 1_000m, openingDate: new DateOnly(2007, 1, 1))).Id;
        int systemId;
        await using (var db = TestUsers.NewContext(api.ConnectionString))
        {
            var made = new FinCategory { Kind = FinEntryKinds.Expense, Name = "Supplier bill payments (test)", IsSystem = true, NoVat = true };
            db.FinCategories.Add(made);
            await db.SaveChangesAsync();
            systemId = made.Id;
        }

        var refused = await SendAsync(HttpMethod.Post, "/api/finance/expenses", token, content: Form(account, systemId, 50m));
        Assert.Equal(HttpStatusCode.BadRequest, refused.Status);
        var listed = (await SendAsync(HttpMethod.Get, "/api/finance/categories?kind=Expense", token)).Body.EnumerateArray().Single(c => c.GetProperty("id").GetInt32() == systemId);
        Assert.True(listed.GetProperty("isSystem").GetBoolean());                  // still listed, but flagged, so the screens can keep it off the forms
        Assert.Equal(HttpStatusCode.Conflict, (await SendAsync(HttpMethod.Put, $"/api/finance/categories/{systemId}/tax-default", token, new { taxTypeId = 1 })).Status);
    }
}
