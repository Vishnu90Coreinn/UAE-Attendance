using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>A host whose receipts folder is a throw-away temp directory.</summary>
public sealed class ReceiptsFixture : ApiFixture
{
    public string Folder { get; } = Path.Combine(Path.GetTempPath(), "hr-receipts-" + Guid.NewGuid().ToString("N"));
    protected override IReadOnlyDictionary<string, string?> ExtraConfig => new Dictionary<string, string?> { ["Finance:ReceiptsPath"] = Folder };
    public new Task DisposeAsync() { try { Directory.Delete(Folder, true); } catch (IOException) { } return base.DisposeAsync(); }
}

/// <summary>Recording an expense with its receipt, listing and filtering expenses, and opening a receipt.</summary>
public class FinanceExpenseTests(ReceiptsFixture api) : IClassFixture<ReceiptsFixture>
{
    private static readonly byte[] Pdf = "%PDF-1.4\n1 0 obj\n<<>>\nendobj\n"u8.ToArray();
    private static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, 0x4A, 0x46, 0x49, 0x46, 0, 1];
    private static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0];

    private static string D(DateOnly date) => date.ToString("yyyy-MM-dd");
    private async Task<string> ManagerAsync() => (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;

    private static MultipartFormDataContent Form(int accountId, int categoryId = 1, decimal amount = 120.50m, string? party = "Royal Palm Business Center",
        DateOnly? date = null, string? reference = "INV-77", string? notes = "Trade licence renewal", params (string Name, byte[] Bytes)[] files)
    {
        var form = new MultipartFormDataContent
        {
            { new StringContent(D(date ?? TestFinance.Today)), "entryDate" },
            { new StringContent(categoryId.ToString()), "categoryId" },
            { new StringContent(accountId.ToString()), "accountId" },
            { new StringContent(amount.ToString(System.Globalization.CultureInfo.InvariantCulture)), "amount" },
        };
        if (party is not null) form.Add(new StringContent(party), "party");
        if (reference is not null) form.Add(new StringContent(reference), "reference");
        if (notes is not null) form.Add(new StringContent(notes), "notes");
        foreach (var (name, bytes) in files)
        {
            var part = new ByteArrayContent(bytes);
            part.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
            form.Add(part, "files", name);
        }

        return form;
    }

    private Task<HttpResponseMessage> PostAsync(MultipartFormDataContent form, string? token)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/finance/expenses") { Content = form };
        if (token is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return api.Client.SendAsync(request);
    }

    private async Task<JsonElement> ErrorsOf(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        return (await TestWorkers.ReadJsonAsync(response)).GetProperty("errors");
    }

    private async Task<int> AccountIdAsync(decimal opening = 1000m, DateOnly? openingDate = null, bool active = true) =>
        (await TestFinance.AddAccountAsync(api.ConnectionString, opening: opening, openingDate: openingDate, isActive: active)).Id;

    // --- create ---------------------------------------------------------------------------------------------

    [Fact]
    public async Task Create_SavesTheExpenseAndItsReceipt_NumbersItAndAuditsIt()
    {
        var token = await ManagerAsync();
        var account = await AccountIdAsync();

        var response = await PostAsync(Form(account, files: [("licence.pdf", Pdf), ("photo.jpg", Jpeg)]), token);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await TestWorkers.ReadJsonAsync(response);
        Assert.Matches(@"^EXP-\d{6}$", body.GetProperty("entryNo").GetString());
        Assert.Equal("Expense", body.GetProperty("kind").GetString());
        Assert.Equal(120.50m, body.GetProperty("amount").GetDecimal());
        Assert.Equal("Royal Palm Business Center", body.GetProperty("party").GetString());
        Assert.Equal("Company expenses", body.GetProperty("categoryName").GetString());
        var files = body.GetProperty("attachments").EnumerateArray().ToList();
        Assert.Equal(["application/pdf", "image/jpeg"], files.Select(f => f.GetProperty("contentType").GetString()));
        Assert.Single(await TestFinance.AuditAsync(api.ConnectionString, "FinExpenseCreated", body.GetProperty("id").GetInt32().ToString()));
        Assert.True(Directory.GetFiles(api.Folder).Length >= 2);
    }

    [Fact]
    public async Task Create_LowersTheAccountBalance()
    {
        var token = await ManagerAsync();
        var account = await AccountIdAsync(opening: 500m);
        await PostAsync(Form(account, amount: 125.25m, files: [("r.png", Png)]), token);

        var accounts = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/finance/accounts", token));

        Assert.Equal(374.75m, accounts.EnumerateArray().Single(a => a.GetProperty("id").GetInt32() == account).GetProperty("balance").GetDecimal());
    }

    [Fact]
    public async Task Create_NumbersAreSequentialAndUnique()
    {
        var token = await ManagerAsync();
        var account = await AccountIdAsync();
        var one = await TestWorkers.ReadJsonAsync(await PostAsync(Form(account, files: [("a.pdf", Pdf)]), token));
        var two = await TestWorkers.ReadJsonAsync(await PostAsync(Form(account, files: [("b.pdf", Pdf)]), token));

        var n1 = int.Parse(one.GetProperty("entryNo").GetString()![4..]);
        var n2 = int.Parse(two.GetProperty("entryNo").GetString()![4..]);
        Assert.Equal(n1 + 1, n2);
    }

    [Fact]
    public async Task Create_RefusesAnExpenseWithoutAReceipt()
    {
        var response = await PostAsync(Form(await AccountIdAsync()), await ManagerAsync());
        Assert.True((await ErrorsOf(response)).TryGetProperty("files", out _));
    }

    [Theory]
    [InlineData("notes.txt", "just text")]
    [InlineData("script.pdf", "<html>not a pdf</html>")]
    public async Task Create_JudgesTheFileByItsContent_NotItsName(string name, string content)
    {
        var response = await PostAsync(Form(await AccountIdAsync(), files: [(name, System.Text.Encoding.UTF8.GetBytes(content))]), await ManagerAsync());
        var errors = await ErrorsOf(response);
        Assert.Contains("PDF, JPEG or PNG", errors.GetProperty("files")[0].GetString());
    }

    [Fact]
    public async Task Create_AcceptsAJpegEvenWhenItIsNamedLikeAPdf_AndStoresTheRealType()
    {
        var response = await PostAsync(Form(await AccountIdAsync(), files: [("receipt.pdf", Jpeg)]), await ManagerAsync());
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal("image/jpeg", (await TestWorkers.ReadJsonAsync(response)).GetProperty("attachments")[0].GetProperty("contentType").GetString());
    }

    [Fact]
    public async Task Create_RefusesAFileOverFiveMegabytes_AndMoreThanFiveFiles()
    {
        var token = await ManagerAsync();
        var account = await AccountIdAsync();
        var big = new byte[5 * 1024 * 1024 + 1];
        Array.Copy(Pdf, big, Pdf.Length);
        Assert.True((await ErrorsOf(await PostAsync(Form(account, files: [("big.pdf", big)]), token))).TryGetProperty("files", out _));

        var six = Enumerable.Range(0, 6).Select(i => ($"f{i}.pdf", Pdf)).ToArray();
        Assert.True((await ErrorsOf(await PostAsync(Form(account, files: six), token))).TryGetProperty("files", out _));
    }

    [Fact]
    public async Task Create_RejectsBadFields_WithFieldErrors_AndSavesNoFile()
    {
        var token = await ManagerAsync();
        var before = Directory.Exists(api.Folder) ? Directory.GetFiles(api.Folder).Length : 0;

        var response = await PostAsync(Form(0, categoryId: 999, amount: 0m, party: " ", date: TestFinance.Today.AddDays(1), files: [("r.pdf", Pdf)]), token);

        var errors = await ErrorsOf(response);
        foreach (var field in new[] { "accountId", "categoryId", "amount", "party", "entryDate" }) Assert.True(errors.TryGetProperty(field, out _), field);
        Assert.Equal(before, Directory.Exists(api.Folder) ? Directory.GetFiles(api.Folder).Length : 0);
    }

    [Fact]
    public async Task Create_RefusesAnIncomeCategory_ASwitchedOffAccount_AndADateBeforeTheAccountOpened()
    {
        var token = await ManagerAsync();
        var open = await AccountIdAsync(openingDate: TestFinance.Today.AddDays(-10));
        var off = await AccountIdAsync(active: false);

        Assert.True((await ErrorsOf(await PostAsync(Form(open, categoryId: 10, files: [("r.pdf", Pdf)]), token))).TryGetProperty("categoryId", out _));
        Assert.True((await ErrorsOf(await PostAsync(Form(off, files: [("r.pdf", Pdf)]), token))).TryGetProperty("accountId", out _));
        Assert.True((await ErrorsOf(await PostAsync(Form(open, date: TestFinance.Today.AddDays(-20), files: [("r.pdf", Pdf)]), token))).TryGetProperty("entryDate", out _));
    }

    // --- list and filters -----------------------------------------------------------------------------------

    private async Task<(int Account, JsonElement Json)> SeedAsync()
    {
        var account = (await TestFinance.AddAccountAsync(api.ConnectionString, opening: 0m)).Id;
        await TestFinance.AddEntryAsync(api.ConnectionString, account, FinEntryKinds.Expense, 100m, date: TestFinance.Today.AddDays(-30), categoryId: 1);
        await TestFinance.AddEntryAsync(api.ConnectionString, account, FinEntryKinds.Expense, 250.50m, date: TestFinance.Today.AddDays(-10), categoryId: 2);
        await TestFinance.AddEntryAsync(api.ConnectionString, account, FinEntryKinds.Expense, 40m, date: TestFinance.Today.AddDays(-2), categoryId: 1);
        await TestFinance.AddEntryAsync(api.ConnectionString, account, FinEntryKinds.Expense, 999m, date: TestFinance.Today.AddDays(-2), status: FinStatuses.Voided);
        await TestFinance.AddEntryAsync(api.ConnectionString, account, FinEntryKinds.Income, 5000m, date: TestFinance.Today.AddDays(-2));
        return (account, default);
    }

    private async Task<JsonElement> ListAsync(string query, string? token = null) =>
        await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/finance/expenses" + query, token ?? await ManagerAsync()));

    [Fact]
    public async Task List_ShowsOnlyActiveExpenses_NewestFirst_WithTheirTotal()
    {
        var (account, _) = await SeedAsync();

        var list = await ListAsync($"?accountId={account}");

        Assert.Equal(390.50m, list.GetProperty("total").GetDecimal());
        Assert.Equal(3, list.GetProperty("count").GetInt32());
        var dates = list.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("entryDate").GetString()).ToList();
        Assert.Equal(dates.OrderByDescending(x => x).ToList(), dates);
        Assert.All(list.GetProperty("items").EnumerateArray(), i => Assert.Equal("Expense", i.GetProperty("kind").GetString()));
    }

    [Fact]
    public async Task List_CanIncludeVoidedRows_ButNeverCountsThem()
    {
        var (account, _) = await SeedAsync();

        var list = await ListAsync($"?accountId={account}&includeVoided=true");

        Assert.Equal(4, list.GetProperty("items").GetArrayLength());
        Assert.Equal(390.50m, list.GetProperty("total").GetDecimal());
    }

    [Fact]
    public async Task List_Filters_ByDateCategoryAmount_AndSearch()
    {
        var (account, _) = await SeedAsync();

        var byDate = await ListAsync($"?accountId={account}&from={D(TestFinance.Today.AddDays(-15))}&to={D(TestFinance.Today)}");
        var byCategory = await ListAsync($"?accountId={account}&categoryId=2");
        var byAmount = await ListAsync($"?accountId={account}&min=50&max=200");
        var bySearch = await ListAsync($"?accountId={account}&q=Test%20party");
        var none = await ListAsync($"?accountId={account}&q=zzz-nothing");

        Assert.Equal(290.50m, byDate.GetProperty("total").GetDecimal());
        Assert.Equal(250.50m, byCategory.GetProperty("total").GetDecimal());
        Assert.Equal(100m, byAmount.GetProperty("total").GetDecimal());
        Assert.Equal(3, bySearch.GetProperty("count").GetInt32());
        Assert.Equal(0, none.GetProperty("count").GetInt32());
        Assert.Equal(0m, none.GetProperty("total").GetDecimal());
    }

    [Fact]
    public async Task Get_ReturnsOneExpense_AndNotFoundForAnIncomeOrUnknownId()
    {
        var token = await ManagerAsync();
        var account = await AccountIdAsync();
        var created = await TestWorkers.ReadJsonAsync(await PostAsync(Form(account, files: [("r.pdf", Pdf)]), token));
        var income = await TestFinance.AddEntryAsync(api.ConnectionString, account, FinEntryKinds.Income, 10m);

        Assert.Equal(HttpStatusCode.OK, (await api.GetAsync($"/api/finance/expenses/{created.GetProperty("id").GetInt32()}", token)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await api.GetAsync($"/api/finance/expenses/{income.Id}", token)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await api.GetAsync("/api/finance/expenses/999999", token)).StatusCode);
    }

    [Fact]
    public async Task Parties_ListsNamesAlreadyUsed_NewestFirst()
    {
        var token = await ManagerAsync();
        var account = await AccountIdAsync();
        var name = "Party " + Guid.NewGuid().ToString("N")[..8];
        await PostAsync(Form(account, party: name, files: [("r.pdf", Pdf)]), token);

        var parties = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/finance/expenses/parties", token));

        Assert.Equal(name, parties[0].GetString());
    }

    // --- receipts -------------------------------------------------------------------------------------------

    [Fact]
    public async Task Receipt_CanBeOpened_WithItsRealTypeAndNoSniffing()
    {
        var token = await ManagerAsync();
        var created = await TestWorkers.ReadJsonAsync(await PostAsync(Form(await AccountIdAsync(), files: [("r.pdf", Pdf)]), token));
        var id = created.GetProperty("attachments")[0].GetProperty("id").GetInt32();

        var response = await api.GetAsync($"/api/finance/attachments/{id}", token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/pdf", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Equal(Pdf, await response.Content.ReadAsByteArrayAsync());
    }

    [Fact]
    public async Task Receipt_PartnerCanOpenIt_AndAnUnknownIdIsNotFound()
    {
        var token = await ManagerAsync();
        var created = await TestWorkers.ReadJsonAsync(await PostAsync(Form(await AccountIdAsync(), files: [("r.png", Png)]), token));
        var id = created.GetProperty("attachments")[0].GetProperty("id").GetInt32();
        var partner = (await TestWorkers.SignInAsync(api, Roles.Viewer)).Token;

        Assert.Equal(HttpStatusCode.OK, (await api.GetAsync($"/api/finance/attachments/{id}", partner)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await api.GetAsync("/api/finance/attachments/999999", token)).StatusCode);
    }

    [Fact]
    public async Task Receipt_FileNameNeverReachesTheDiskPath()
    {
        var token = await ManagerAsync();
        var created = await TestWorkers.ReadJsonAsync(await PostAsync(Form(await AccountIdAsync(), files: [("..\\..\\evil<name>.pdf", Pdf)]), token));

        var name = created.GetProperty("attachments")[0].GetProperty("fileName").GetString()!;

        Assert.DoesNotContain("..", name);
        Assert.DoesNotContain("<", name);
        Assert.All(Directory.GetFiles(api.Folder), f => Assert.Matches("^[0-9a-f]{32}\\.(pdf|jpg|png)$", Path.GetFileName(f)));
    }

    [Fact]
    public async Task Database_RefusesAnAttachmentWithoutAnEntry()
    {
        await using var db = TestUsers.NewContext(api.ConnectionString);
        db.FinAttachments.Add(new FinAttachment { EntryId = 999999, FileName = "x.pdf", ContentType = "application/pdf", StoredName = Guid.NewGuid().ToString("N") + ".pdf", Sha256 = "x", UploadedBy = "t", UploadedUtc = DateTime.UtcNow });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }
}
