using System.Net;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Integration;

public class LettersTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private static object Body(int workerId, string type = "Salary", string? date = null, object? extra = null)
    {
        var body = new Dictionary<string, object?>
        {
            ["workerId"] = workerId, ["letterType"] = type, ["signerName"] = "Eng. Test Signer", ["signerTitle"] = "General Manager",
        };
        if (date is not null) body["issueDate"] = date;
        if (extra is not null)
            foreach (var property in extra.GetType().GetProperties()) body[char.ToLowerInvariant(property.Name[0]) + property.Name[1..]] = property.GetValue(extra);
        return body;
    }

    private async Task<int> WorkerAsync(string name = "Sajid Mahmood")
    {
        await using var db = TestUsers.NewContext(api.ConnectionString);
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, fullName: name, designation: "Installation Supervisor", hourlyRate: 6.67m);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE Workers SET MonthlySalary = 1600, HousingAllowance = 800, TransportAllowance = 400, OtherAllowance = 200,
                Nationality = 'Pakistani', PassportNumber = 'N8392019', EmiratesId = '784-1988-3920192-1', JoinDate = '2022-03-15',
                BankName = 'Emirates NBD Bank', BankAccountNumber = '012984719201', Iban = 'AE03033000012984719201'
            WHERE Id = {worker.Id}
            """);
        return worker.Id;
    }

    private async Task<string> TokenAsync(string role) => (await TestWorkers.SignInAsync(api, role)).Token;

    /// <summary>A request that a supervisor raised, HR prepared and sent, waiting for a manager. Returns the request id.</summary>
    private async Task<int> PendingAsync(int workerId, string type = "Salary", string? date = null, object? extra = null)
    {
        var supervisor = await TokenAsync(Roles.Supervisor);
        var hr = await TokenAsync(Roles.HR);
        var raised = await api.PostAsync("/api/certificate-requests", new { workerId, letterType = type, reason = "Needed for a visa" }, supervisor);
        Assert.Equal(HttpStatusCode.Created, raised.StatusCode);
        var id = (await TestWorkers.ReadJsonAsync(raised)).GetProperty("id").GetInt32();
        Assert.Equal(HttpStatusCode.OK, (await api.SendAsync(HttpMethod.Put, $"/api/certificate-requests/{id}/details", Body(workerId, type, date, extra), hr)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await api.PostAsync($"/api/certificate-requests/{id}/submit", new { }, hr)).StatusCode);
        return id;
    }

    /// <summary>Raises, prepares, sends and has a manager approve a certificate; returns the issued letter as the letters API shows it.</summary>
    private async Task<JsonElement> IssueAsync(string token, int workerId, string type = "Salary", string? date = null, object? extra = null)
    {
        var id = await PendingAsync(workerId, type, date, extra);
        var manager = await TokenAsync(Roles.Manager);
        var approved = await api.PostAsync($"/api/certificate-requests/{id}/approve", new { }, manager);
        Assert.Equal(HttpStatusCode.OK, approved.StatusCode);
        var letterId = (await TestWorkers.ReadJsonAsync(approved)).GetProperty("letterId").GetInt32();
        var letter = await api.GetAsync($"/api/letters/{letterId}", token);
        Assert.Equal(HttpStatusCode.OK, letter.StatusCode);
        return await TestWorkers.ReadJsonAsync(letter);
    }

    // --- access ---------------------------------------------------------------------------------------------

    [Theory]
    [InlineData(Roles.Administrator, HttpStatusCode.OK)]
    [InlineData(Roles.Manager, HttpStatusCode.OK)]
    [InlineData(Roles.HR, HttpStatusCode.OK)]
    [InlineData(Roles.Supervisor, HttpStatusCode.Forbidden)]
    public async Task RoleMatrix_ForReads(string role, HttpStatusCode expected)
    {
        var token = await TokenAsync(role);
        Assert.Equal(expected, (await api.GetAsync("/api/letters", token)).StatusCode);
    }

    [Theory]
    [InlineData(Roles.Administrator, HttpStatusCode.OK)]
    [InlineData(Roles.Manager, HttpStatusCode.OK)]
    [InlineData(Roles.HR, HttpStatusCode.OK)]
    [InlineData(Roles.Supervisor, HttpStatusCode.Forbidden)]
    public async Task RoleMatrix_ForPreview(string role, HttpStatusCode expected)
    {
        var workerId = await WorkerAsync();
        var token = await TokenAsync(role);
        Assert.Equal(expected, (await api.SendAsync(HttpMethod.Post, "/api/letters/preview", Body(workerId), token)).StatusCode);
    }

    [Fact]
    public async Task ALetterCannotBeIssuedDirectly_OnlyByApprovingARequest()
    {
        var workerId = await WorkerAsync();
        foreach (var role in new[] { Roles.Administrator, Roles.Manager, Roles.HR, Roles.Supervisor })
        {
            var response = await api.SendAsync(HttpMethod.Post, "/api/letters", Body(workerId, date: "2011-01-05"), await TokenAsync(role));
            Assert.NotEqual(HttpStatusCode.Created, response.StatusCode);
            Assert.NotEqual(HttpStatusCode.OK, response.StatusCode);
        }
    }

    [Fact]
    public async Task Supervisor_IsForbiddenOnEveryRoute_AndAnonymousIsUnauthorized()
    {
        var workerId = await WorkerAsync();
        var manager = await TokenAsync(Roles.Manager);
        var id = (await IssueAsync(manager, workerId, date: "2012-01-05")).GetProperty("id").GetInt32();
        var supervisor = await TokenAsync(Roles.Supervisor);

        foreach (var path in new[] { $"/api/letters/{id}", $"/api/letters/{id}/pdf", "/api/letters/images/seal" })
        {
            Assert.Equal(HttpStatusCode.Forbidden, (await api.GetAsync(path, supervisor)).StatusCode);
            Assert.Equal(HttpStatusCode.Unauthorized, (await api.GetAsync(path)).StatusCode);
        }
        Assert.Equal(HttpStatusCode.Unauthorized, (await api.SendAsync(HttpMethod.Post, "/api/certificate-requests", new { workerId, letterType = "Salary" })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await api.GetAsync("/api/letters")).StatusCode);
    }

    [Fact]
    public async Task IssuedLetters_CannotBeChangedOrDeleted()
    {
        var workerId = await WorkerAsync();
        var manager = await TokenAsync(Roles.Administrator);
        var id = (await IssueAsync(manager, workerId, date: "2013-01-05")).GetProperty("id").GetInt32();

        Assert.NotEqual(HttpStatusCode.OK, (await api.SendAsync(HttpMethod.Put, $"/api/letters/{id}", Body(workerId), manager)).StatusCode);
        Assert.NotEqual(HttpStatusCode.NoContent, (await api.SendAsync(HttpMethod.Delete, $"/api/letters/{id}", null, manager)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await api.GetAsync($"/api/letters/{id}", manager)).StatusCode);
    }

    // --- wording --------------------------------------------------------------------------------------------

    private static string Flat(JsonElement document) =>
        string.Join("\n", document.GetProperty("content").GetProperty("paragraphs").EnumerateArray()
            .Select(p => string.Concat(p.EnumerateArray().Select(r => r.GetProperty("text").GetString()))));

    [Fact]
    public async Task Preview_SalaryLetter_UsesThePrototypeWording_AndTheSalaryTable_AndSavesNothing()
    {
        var workerId = await WorkerAsync();
        var token = await TokenAsync(Roles.Manager);
        var before = await ListCountAsync(token);

        var response = await api.SendAsync(HttpMethod.Post, "/api/letters/preview", Body(workerId, "Salary", extra: new { Salutation = "Mr." }), token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var json = await TestWorkers.ReadJsonAsync(response);
        var content = json.GetProperty("content");
        Assert.Equal("SALARY CERTIFICATE", content.GetProperty("title").GetString());
        Assert.Equal(string.Empty, content.GetProperty("refNo").GetString());
        var text = Flat(json);
        Assert.Contains("This is to certify that Mr. Sajid Mahmood, holding Pakistani Passport No. N8392019 and Emirates ID No. 784-1988-3920192-1 (Employee ID: ", text);
        Assert.Contains("is actively employed with DE AKS BE GLASS & ALUMINIUM INSTALLATION & MAINTENANCE CO. L.L.C S.O.C as a Installation Supervisor since 15 Mar 2022.", text);
        Assert.Contains("Mr. Sajid Mahmood's current monthly gross remuneration breakdown is structured as follows:", text);
        var salary = content.GetProperty("salary");
        Assert.Equal(1600m, salary.GetProperty("basic").GetDecimal());
        Assert.Equal(800m, salary.GetProperty("housing").GetDecimal());
        Assert.Equal(3000m, salary.GetProperty("total").GetDecimal());
        Assert.Equal(before, await ListCountAsync(token));
    }

    [Theory]
    [InlineData("Service", "EMPLOYMENT & SERVICE CERTIFICATE", "is currently employed with", false)]
    [InlineData("BankTransfer", "BANK SALARY TRANSFER REQUEST", "monthly salary payments amounting to 3,000.00 AED will be transferred directly", true)]
    [InlineData("Noc", "WHOM IT MAY CONCERN / NOC LETTER", "has No Objection (NOC) whatsoever regarding Mr. Sajid Mahmood", false)]
    public async Task Preview_OtherTypes_HaveTheirTitleAndWording(string type, string title, string phrase, bool hasTable)
    {
        var workerId = await WorkerAsync();
        var token = await TokenAsync(Roles.HR);

        var json = await TestWorkers.ReadJsonAsync(await api.SendAsync(HttpMethod.Post, "/api/letters/preview", Body(workerId, type), token));

        Assert.Equal(title, json.GetProperty("content").GetProperty("title").GetString());
        Assert.Contains(phrase, Flat(json));
        Assert.Equal(hasTable ? JsonValueKind.Object : JsonValueKind.Null, json.GetProperty("content").GetProperty("salary").ValueKind);
    }

    [Fact]
    public async Task Preview_UsesDefaults_ForBlankAddresseeAndPurposeNote()
    {
        var workerId = await WorkerAsync();
        var token = await TokenAsync(Roles.Manager);

        var content = (await TestWorkers.ReadJsonAsync(await api.SendAsync(HttpMethod.Post, "/api/letters/preview", Body(workerId), token))).GetProperty("content");

        Assert.Equal("To Whom It May Concern", content.GetProperty("addressedTo").GetString());
        Assert.StartsWith("This certificate is issued upon the request of the employee without any financial or legal liability on DE AKS BE", content.GetProperty("purposeNote").GetString());
        Assert.True(content.GetProperty("showSeal").GetBoolean());
    }

    // --- validation -----------------------------------------------------------------------------------------

    private async Task<JsonElement> ErrorsAsync(string token, object body, string path = "/api/letters/preview")
    {
        var response = await api.SendAsync(HttpMethod.Post, path, body, token);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        return (await TestWorkers.ReadJsonAsync(response)).GetProperty("errors");
    }

    [Fact]
    public async Task Issue_RejectsMissingWorker_UnknownType_AndFutureDate()
    {
        var token = await TokenAsync(Roles.Manager);
        var workerId = await WorkerAsync();

        var none = await ErrorsAsync(token, new { letterType = "Salary", signerName = "A", signerTitle = "B" });
        Assert.True(none.TryGetProperty("workerId", out _));

        var type = await ErrorsAsync(token, Body(workerId, "Nonsense"));
        Assert.True(type.TryGetProperty("letterType", out _));

        var future = await ErrorsAsync(token, Body(workerId, date: DateTime.UtcNow.AddDays(3).ToString("yyyy-MM-dd")));
        Assert.Equal("The issue date cannot be in the future.", future.GetProperty("issueDate")[0].GetString());
    }

    [Fact]
    public async Task Issue_RequiresASignatory_WhenNeitherTheRequestNorTheSettingsHaveOne()
    {
        var workerId = await WorkerAsync();
        var token = await TokenAsync(Roles.Manager);

        var errors = await ErrorsAsync(token, new { workerId, letterType = "Noc" });

        Assert.Equal("Enter the signatory name.", errors.GetProperty("signerName")[0].GetString());
    }

    [Fact]
    public async Task Issue_RejectsTooLongText()
    {
        var workerId = await WorkerAsync();
        var token = await TokenAsync(Roles.Manager);

        var errors = await ErrorsAsync(token, Body(workerId, extra: new { AddressedTo = new string('a', 201), PurposeNote = new string('p', 501), Salutation = "Dr." }));

        foreach (var field in new[] { "addressedTo", "purposeNote", "salutation" }) Assert.True(errors.TryGetProperty(field, out _), field);
    }

    [Fact]
    public async Task BankLetter_NeedsBankDetails_FromTheWorkerOrTheRequest()
    {
        var token = await TokenAsync(Roles.Manager);
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, fullName: "No Bank");

        var errors = await ErrorsAsync(token, Body(worker.Id, "BankTransfer"));
        foreach (var field in new[] { "bankName", "bankAccountNumber", "iban" }) Assert.True(errors.TryGetProperty(field, out _), field);

        var json = await TestWorkers.ReadJsonAsync(await api.SendAsync(HttpMethod.Post, "/api/letters/preview",
            Body(worker.Id, "BankTransfer", extra: new { BankName = "Mashreq", BankAccountNumber = "1122", Iban = "ae12 3456" }), token));
        var text = Flat(json);
        Assert.Contains("bank account maintained at Mashreq under Account No: 1122 (IBAN: AE123456)", text);
    }

    [Fact]
    public async Task WorkersOwnBankDetails_WinOverTypedOnes()
    {
        var workerId = await WorkerAsync();
        var token = await TokenAsync(Roles.Manager);

        var json = await TestWorkers.ReadJsonAsync(await api.SendAsync(HttpMethod.Post, "/api/letters/preview",
            Body(workerId, "BankTransfer", extra: new { BankName = "Other Bank" }), token));

        Assert.Contains("Emirates NBD Bank", Flat(json));
        Assert.DoesNotContain("Other Bank", Flat(json));
    }

    // --- issuing --------------------------------------------------------------------------------------------

    [Fact]
    public async Task Issue_AssignsAGapFreeReferencePerYear_AndWritesAnAuditRow()
    {
        var workerId = await WorkerAsync();
        var token = await TokenAsync(Roles.Manager);

        var first = await IssueAsync(token, workerId, date: "2014-02-01");
        var second = await IssueAsync(token, workerId, "Service", "2014-03-01");
        var otherYear = await IssueAsync(token, workerId, date: "2015-03-01");

        Assert.Equal("DEAKS/HR/2014/0001", first.GetProperty("refNo").GetString());
        Assert.Equal("DEAKS/HR/2014/0002", second.GetProperty("refNo").GetString());
        Assert.Equal("DEAKS/HR/2015/0001", otherYear.GetProperty("refNo").GetString());
        Assert.Equal("DEAKS/HR/2014/0001", first.GetProperty("document").GetProperty("content").GetProperty("refNo").GetString());

        await using var db = TestUsers.NewContext(api.ConnectionString);
        var audit = await db.AuditLogs.Where(a => a.Action == "LetterIssued" && a.EntityId == "DEAKS/HR/2014/0002").SingleAsync();
        Assert.Contains("Service", audit.DetailsJson);
        Assert.Contains(workerId.ToString(), audit.DetailsJson);
        Assert.NotNull(audit.ActorUsername);
    }

    [Fact]
    public async Task ConcurrentIssues_GetDistinctNumbers()
    {
        var workerId = await WorkerAsync();
        var token = await TokenAsync(Roles.Manager);

        var pending = new List<int>();
        for (var i = 0; i < 6; i++) pending.Add(await PendingAsync(workerId, date: "2016-05-05"));

        var responses = await Task.WhenAll(pending.Select(id => api.PostAsync($"/api/certificate-requests/{id}/approve", new { }, token)));

        Assert.All(responses, r => Assert.Equal(HttpStatusCode.OK, r.StatusCode));
        var refs = new List<string>();
        foreach (var r in responses) refs.Add((await TestWorkers.ReadJsonAsync(r)).GetProperty("refNo").GetString()!);
        Assert.Equal(6, refs.Distinct().Count());
        Assert.Equal(Enumerable.Range(1, 6).Select(i => $"DEAKS/HR/2016/{i:0000}"), refs.Order());
    }

    [Fact]
    public async Task ReopenedLetter_IsExactlyAsIssued_EvenAfterTheWorkerChanges()
    {
        var workerId = await WorkerAsync();
        var token = await TokenAsync(Roles.Manager);
        var issued = await IssueAsync(token, workerId, date: "2017-06-01", extra: new { AddressedTo = "The Manager, Test Bank", PurposeNote = "For a loan." });
        var id = issued.GetProperty("id").GetInt32();
        var original = Flat(issued.GetProperty("document"));

        // The worker and the company change afterwards.
        var update = await api.SendAsync(HttpMethod.Put, $"/api/workers/{workerId}", new
        {
            workerCode = TestWorkers.UniqueCode(), fullName = "Renamed Person", designation = "Director", monthlySalary = 9999m,
            housingAllowance = 1m, nationality = "Other",
        }, token);
        Assert.Equal(HttpStatusCode.OK, update.StatusCode);
        await using (var db = TestUsers.NewContext(api.ConnectionString))
            await db.Database.ExecuteSqlRawAsync("UPDATE DocumentSettings SET CompanyName = 'CHANGED CO'");

        var reopened = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/letters/{id}", token));
        var content = reopened.GetProperty("document").GetProperty("content");

        Assert.Equal(original, Flat(reopened.GetProperty("document")));
        Assert.Equal("Sajid Mahmood", content.GetProperty("workerName").GetString());
        Assert.Equal(1600m, content.GetProperty("salary").GetProperty("basic").GetDecimal());
        Assert.Equal("The Manager, Test Bank", content.GetProperty("addressedTo").GetString());
        Assert.DoesNotContain("CHANGED CO", content.GetRawText());
        Assert.Equal("DEAKS/HR/2017/0001", content.GetProperty("refNo").GetString());

        await using var verify = TestUsers.NewContext(api.ConnectionString);
        await verify.Database.ExecuteSqlRawAsync("UPDATE DocumentSettings SET CompanyName = 'DE AKS BE GLASS & ALUMINIUM'");
    }

    // --- log ------------------------------------------------------------------------------------------------

    private async Task<int> ListCountAsync(string token) =>
        JsonDocument.Parse(await (await api.GetAsync("/api/letters", token)).Content.ReadAsStringAsync()).RootElement.GetArrayLength();

    [Fact]
    public async Task List_SearchesByWorkerRefAndType_AndFiltersByDate()
    {
        var token = await TokenAsync(Roles.HR);
        var unique = "Zxq" + Guid.NewGuid().ToString("N")[..6];
        var workerId = await WorkerAsync(unique + " Person");
        await IssueAsync(token, workerId, "Salary", "2018-01-10");
        await IssueAsync(token, workerId, "Noc", "2018-06-10");

        async Task<JsonElement> Q(string query) => JsonDocument.Parse(await (await api.GetAsync("/api/letters?" + query, token)).Content.ReadAsStringAsync()).RootElement;

        Assert.Equal(2, (await Q("search=" + unique)).GetArrayLength());
        Assert.Equal(1, (await Q($"search={unique}&type=Noc")).GetArrayLength());
        Assert.Equal(1, (await Q($"search={unique}&from=2018-03-01&to=2018-12-31")).GetArrayLength());
        Assert.True((await Q("search=DEAKS/HR/2018/0001")).GetArrayLength() >= 1);
        var row = (await Q("search=" + unique))[0];
        Assert.Equal(unique + " Person", row.GetProperty("workerName").GetString());
        Assert.Equal(HttpStatusCode.BadRequest, (await api.GetAsync("/api/letters?from=nope", token)).StatusCode);
    }

    [Fact]
    public async Task Get_UnknownLetter_Is404()
    {
        var token = await TokenAsync(Roles.Manager);
        Assert.Equal(HttpStatusCode.NotFound, (await api.GetAsync("/api/letters/987654", token)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await api.GetAsync("/api/letters/987654/pdf", token)).StatusCode);
    }

    // --- pdf and images -------------------------------------------------------------------------------------

    [Theory]
    [InlineData("Salary")]
    [InlineData("Service")]
    [InlineData("BankTransfer")]
    [InlineData("Noc")]
    public async Task Pdf_IsAnA4PdfForEveryType(string type)
    {
        var workerId = await WorkerAsync();
        var token = await TokenAsync(Roles.Manager);
        var id = (await IssueAsync(token, workerId, type, "2019-01-05")).GetProperty("id").GetInt32();

        var response = await api.GetAsync($"/api/letters/{id}/pdf", token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/pdf", response.Content.Headers.ContentType!.MediaType);
        var bytes = await response.Content.ReadAsByteArrayAsync();
        Assert.Equal("%PDF", System.Text.Encoding.ASCII.GetString(bytes, 0, 4));
        using var pdf = UglyToad.PdfPig.PdfDocument.Open(bytes);
        Assert.Equal(1, pdf.NumberOfPages);
        var text = string.Join(" ", pdf.GetPage(1).GetWords().Select(w => w.Text));
        Assert.Contains("DEAKS/HR/2019/", text);
        Assert.Contains("Sajid", text);
    }

    [Fact]
    public async Task Pdf_KeepsASpaceAroundBoldValues_AndPrintsNoStamp()
    {
        var workerId = await WorkerAsync();
        var token = await TokenAsync(Roles.Manager);
        var id = (await IssueAsync(token, workerId, "Salary", "2019-01-05")).GetProperty("id").GetInt32();

        var bytes = await (await api.GetAsync($"/api/letters/{id}/pdf", token)).Content.ReadAsByteArrayAsync();

        using var pdf = UglyToad.PdfPig.PdfDocument.Open(bytes);
        var text = string.Join(" ", pdf.GetPage(1).GetWords().Select(w => w.Text));
        // Each word is drawn on its own, so a missing space shows as the next value starting right after the previous word.
        Assert.Matches(@"certify that Mr\. ", text);
        Assert.Matches(@"employed with ", text);
        Assert.DoesNotContain("OFFICIAL SEAL", text, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Stamp", text, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Pdf_PutsTheCompanyNameOnOneLine_InsideTheA4Margins()
    {
        var workerId = await WorkerAsync();
        var token = await TokenAsync(Roles.Manager);
        var id = (await IssueAsync(token, workerId, "Salary", "2019-01-05")).GetProperty("id").GetInt32();

        var bytes = await (await api.GetAsync($"/api/letters/{id}/pdf", token)).Content.ReadAsByteArrayAsync();

        using var pdf = UglyToad.PdfPig.PdfDocument.Open(bytes);
        var page = pdf.GetPage(1);
        Assert.InRange(page.Width, 594, 596);
        Assert.InRange(page.Height, 841, 843);
        var words = page.GetWords().ToList();
        // The letterhead name is the first run of capitals at the top: every word sharing the first word's baseline.
        var top = words.OrderByDescending(w => w.BoundingBox.Bottom).First(w => w.Text == "DE");
        var nameLine = words.Where(w => Math.Abs(w.BoundingBox.Bottom - top.BoundingBox.Bottom) < 1).ToList();
        Assert.Contains(nameLine, w => w.Text.StartsWith("AKS"));
        Assert.Contains(nameLine, w => w.Text.StartsWith("S.O.C"));
        Assert.All(words, w => Assert.InRange(w.BoundingBox.Left, 50, 545));
        Assert.All(words, w => Assert.InRange(w.BoundingBox.Right, 50, 545));
    }

    [Fact]
    public async Task Pdf_OfALetterWithNonLatinText_Is422()
    {
        var workerId = await WorkerAsync("محمد");
        var token = await TokenAsync(Roles.Manager);
        var id = (await IssueAsync(token, workerId, "Noc", "2020-01-05")).GetProperty("id").GetInt32();

        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await api.GetAsync($"/api/letters/{id}/pdf", token)).StatusCode);
    }

    [Fact]
    public async Task Images_Are404UntilUploaded_ThenServed()
    {
        var token = await TokenAsync(Roles.HR);
        await using var db = TestUsers.NewContext(api.ConnectionString);
        await db.Database.ExecuteSqlRawAsync("UPDATE DocumentSettings SET Seal = NULL, SealContentType = NULL");
        Assert.Equal(HttpStatusCode.NotFound, (await api.GetAsync("/api/letters/images/seal", token)).StatusCode);

        var png = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==");
        await db.Database.ExecuteSqlRawAsync("UPDATE DocumentSettings SET Seal = {0}, SealContentType = 'image/png'", png);
        var response = await api.GetAsync("/api/letters/images/seal", token);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("image/png", response.Content.Headers.ContentType!.MediaType);
        Assert.Equal(HttpStatusCode.NotFound, (await api.GetAsync("/api/letters/images/other", token)).StatusCode);

        // The seal image is used in the PDF without error.
        var workerId = await WorkerAsync();
        var manager = await TokenAsync(Roles.Manager);
        var id = (await IssueAsync(manager, workerId, "Salary", "2021-01-05")).GetProperty("id").GetInt32();
        Assert.Equal(HttpStatusCode.OK, (await api.GetAsync($"/api/letters/{id}/pdf", manager)).StatusCode);
        await db.Database.ExecuteSqlRawAsync("UPDATE DocumentSettings SET Seal = NULL, SealContentType = NULL");
    }

    // --- constraints ----------------------------------------------------------------------------------------

    [Fact]
    public async Task Table_RejectsADuplicateReference_ABadType_AndADeletedWorkerKeepsItsLetters()
    {
        var workerId = await WorkerAsync();
        var token = await TokenAsync(Roles.Manager);
        await IssueAsync(token, workerId, date: "2022-01-05");

        await using var connection = new SqlConnection(api.ConnectionString);
        await connection.OpenAsync();
        async Task<int?> TryAsync(string sql)
        {
            try { await using var c = connection.CreateCommand(); c.CommandText = sql; await c.ExecuteNonQueryAsync(); return null; }
            catch (SqlException ex) { return ex.Number; }
        }

        var duplicate = await TryAsync($"INSERT INTO IssuedLetters (RefNo, [Year], [Sequence], LetterType, WorkerId, IssueDate, AddressedTo, ContentJson, IssuedBy, IssuedUtc) VALUES ('DEAKS/HR/2022/0001', 2022, 5, 'Noc', {workerId}, '2022-01-05', 'x', '{{}}', 'u', GETUTCDATE())");
        Assert.Contains(duplicate, new int?[] { 2601, 2627 });
        var badType = await TryAsync($"INSERT INTO IssuedLetters (RefNo, [Year], [Sequence], LetterType, WorkerId, IssueDate, AddressedTo, ContentJson, IssuedBy, IssuedUtc) VALUES ('X/1', 2022, 9, 'Bad', {workerId}, '2022-01-05', 'x', '{{}}', 'u', GETUTCDATE())");
        Assert.Equal(547, badType);

        var delete = await api.SendAsync(HttpMethod.Delete, $"/api/workers/{workerId}", null, token);
        Assert.Equal(HttpStatusCode.Conflict, delete.StatusCode);
    }
}
