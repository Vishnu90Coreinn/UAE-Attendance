using System.Net;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Integration;

public class PayrollFinalisationTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    [Theory]
    [InlineData(null, 401)] [InlineData(Roles.Supervisor, 403)]
    public async Task Mutations_RequireManagerOrAdministrator(string? role, int expected)
    {
        var token = role is null ? null : (await TestWorkers.SignInAsync(api, role)).Token;
        foreach (var method in new[] { HttpMethod.Post, HttpMethod.Delete })
        {
            var response = await api.SendAsync(method, "/api/payroll/2020-01/finalise", new { revision = "x", reason = "correction" }, token);
            Assert.Equal((HttpStatusCode)expected, response.StatusCode);
        }
    }

    [Fact]
    public async Task Manager_CanFinaliseAndReopen()
    {
        var manager = await TestWorkers.SignInAsync(api, Roles.Manager);
        var draft = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/payroll?month=2019-06", manager.Token));
        var finalise = await api.PostAsync("/api/payroll/2019-06/finalise", new { revision = draft.GetProperty("revision").GetString() }, manager.Token);
        Assert.Equal(HttpStatusCode.OK, finalise.StatusCode);
        var reopen = await api.SendAsync(HttpMethod.Delete, "/api/payroll/2019-06/finalise", new { reason = "manager correction" }, manager.Token);
        Assert.Equal(HttpStatusCode.OK, reopen.StatusCode);
    }

    [Fact]
    public async Task Finalise_FreezesReportAndPdf_ReopenRefreshesAndAudits()
    {
        var admin = await TestWorkers.SignInAsync(api, Roles.Administrator);
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, fullName: "Frozen Employee", hourlyRate: 10m);
        var overridden = await TestWorkers.CreateAsync(api.ConnectionString, fullName: "Override Employee", hourlyRate: 12m, overtimeRate: 7.25m);
        await using (var seed = TestUsers.NewContext(api.ConnectionString))
        {
            seed.Attendance.Add(new() { WorkerId = worker.Id, WorkDate = new(2020, 2, 1), Status = "Present", BasicHours = 8, OvertimeHours = 1, UpdatedUtc = DateTime.UtcNow, UpdatedBy = "test" });
            seed.Attendance.Add(new() { WorkerId = overridden.Id, WorkDate = new(2020, 2, 1), Status = "Present", BasicHours = 8, OvertimeHours = 2, UpdatedUtc = DateTime.UtcNow, UpdatedBy = "test" });
            await seed.SaveChangesAsync();
        }
        var draft = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/payroll?month=2020-02", admin.Token));
        var response = await api.PostAsync("/api/payroll/2020-02/finalise", new { revision = draft.GetProperty("revision").GetString() }, admin.Token);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var frozen = await TestWorkers.ReadJsonAsync(response);
        foreach (var field in new[] { "lines", "totals", "company" })
            Assert.Equal(draft.GetProperty(field).ToString(), frozen.GetProperty(field).ToString());
        var overrideLine = frozen.GetProperty("lines").EnumerateArray().Single(l => l.GetProperty("workerId").GetInt32() == overridden.Id);
        Assert.Equal(7.25m, overrideLine.GetProperty("overtimeRate").GetDecimal());
        Assert.Equal(14.50m, overrideLine.GetProperty("overtimePay").GetDecimal());
        Assert.Equal("Finalised", frozen.GetProperty("status").GetString());
        Assert.Equal(admin.Username, frozen.GetProperty("finalisedBy").GetString());
        Assert.EndsWith("Z", frozen.GetProperty("finalisedUtc").GetString());
        Assert.NotEqual(draft.GetProperty("revision").GetString(), frozen.GetProperty("revision").GetString());
        var originalPdf = await (await api.GetAsync("/api/payroll/pdf?month=2020-02", admin.Token)).Content.ReadAsByteArrayAsync();
        using (var pdf = UglyToad.PdfPig.PdfDocument.Open(originalPdf))
        {
            var text = string.Join(" ", pdf.GetPages().Select(p => p.Text));
            Assert.Contains("Finalised", text);
            Assert.Contains(admin.Username, text);
            Assert.DoesNotContain("Draft", text);
        }
        await using (var mutate = TestUsers.NewContext(api.ConnectionString))
        {
            await mutate.Workers.Where(w => w.Id == worker.Id).ExecuteUpdateAsync(s => s.SetProperty(w => w.FullName, "Changed").SetProperty(w => w.Designation, "Changed Role").SetProperty(w => w.HourlyRate, 100m).SetProperty(w => w.OvertimeRate, 50m).SetProperty(w => w.IsActive, false));
            await mutate.PayrollSettings.ExecuteUpdateAsync(s => s.SetProperty(p => p.CompanyName, "New Company").SetProperty(p => p.OvertimeRatePerHour, 99m).SetProperty(p => p.Tagline, "New tagline").SetProperty(p => p.ContactEmail, "new@example.com").SetProperty(p => p.PreparedByLabel, "New prepared").SetProperty(p => p.ApprovedByLabel, "New approved"));
        }
        await TestWorkers.CreateAsync(api.ConnectionString, fullName: "New Employee");
        var reread = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/payroll?month=2020-02", admin.Token));
        Assert.Equal(frozen.ToString(), reread.ToString());
        var rereadPdf = await (await api.GetAsync("/api/payroll/pdf?month=2020-02", admin.Token)).Content.ReadAsByteArrayAsync();
        using (var pdf = UglyToad.PdfPig.PdfDocument.Open(rereadPdf))
        {
            var text = string.Join(" ", pdf.GetPages().Select(p => p.Text));
            Assert.Contains("Frozen Employee", text);
            Assert.DoesNotContain("New Company", text);
            Assert.DoesNotContain("Changed Role", text);
        }
        Assert.Equal(HttpStatusCode.Conflict, (await api.PostAsync("/api/payroll/2020-02/finalise", new { revision = reread.GetProperty("revision").GetString() }, admin.Token)).StatusCode);
        var reopenedResponse = await api.SendAsync(HttpMethod.Delete, "/api/payroll/2020-02/finalise", new { reason = "  Rate correction  " }, admin.Token);
        Assert.Equal(HttpStatusCode.OK, reopenedResponse.StatusCode);
        var reopened = await TestWorkers.ReadJsonAsync(reopenedResponse);
        Assert.Equal("Draft", reopened.GetProperty("status").GetString());
        Assert.Equal(System.Text.Json.JsonValueKind.Null, reopened.GetProperty("finalisedBy").ValueKind);
        Assert.Equal("New Company", reopened.GetProperty("company").GetProperty("companyName").GetString());
        Assert.NotEqual(frozen.GetProperty("totals").ToString(), reopened.GetProperty("totals").ToString());
        await using var verify = TestUsers.NewContext(api.ConnectionString);
        var audits = await verify.AuditLogs.Where(a => a.EntityId == "2020-02").OrderBy(a => a.Id).ToListAsync();
        Assert.Equal(new[] { "PayrollFinalised", "PayrollReopened" }, audits.Select(a => a.Action));
        Assert.All(audits, a => Assert.Equal(admin.Username, a.ActorUsername));
        using var details = System.Text.Json.JsonDocument.Parse(audits[1].DetailsJson!);
        Assert.Equal("Rate correction", details.RootElement.GetProperty("reason").GetString());
        Assert.Equal(admin.Username, details.RootElement.GetProperty("previous").GetProperty("finalisedBy").GetString());
        Assert.Equal(HttpStatusCode.Conflict, (await api.SendAsync(HttpMethod.Delete, "/api/payroll/2020-02/finalise", new { reason = "again" }, admin.Token)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await api.PostAsync("/api/payroll/2020-02/finalise", new { revision = reopened.GetProperty("revision").GetString() }, admin.Token)).StatusCode);
    }

    [Theory]
    [InlineData("2020-1", "{\"revision\":\"x\"}")]
    [InlineData("9999-12", "{\"revision\":\"x\"}")]
    [InlineData("2020-03", "{}")]
    [InlineData("2020-03", "{\"revision\":\" \"}")]
    public async Task Finalise_ValidatesMonthAndRevision(string month, string body)
    {
        var admin = await TestWorkers.SignInAsync(api, Roles.Administrator);
        Assert.Equal(HttpStatusCode.BadRequest, (await api.SendJsonAsync(HttpMethod.Post, $"/api/payroll/{month}/finalise", body, admin.Token)).StatusCode);
    }

    [Fact]
    public async Task Finalise_RejectsStaleRevision_AndReopenRequiresTrimmedReason()
    {
        var admin = await TestWorkers.SignInAsync(api, Roles.Administrator);
        Assert.Equal(HttpStatusCode.Conflict, (await api.PostAsync("/api/payroll/2020-03/finalise", new { revision = "stale" }, admin.Token)).StatusCode);
        foreach (var body in new[] { "{}", "{\"reason\":null}", "{\"reason\":\" \"}", System.Text.Json.JsonSerializer.Serialize(new { reason = new string('a', 501) }) })
            Assert.Equal(HttpStatusCode.BadRequest, (await api.SendJsonAsync(HttpMethod.Delete, "/api/payroll/2020-03/finalise", body, admin.Token)).StatusCode);
    }
    [Fact]
    public async Task BusyMonth_ReturnsControlled409ForReportPdfAndMutations()
    {
        var admin = await TestWorkers.SignInAsync(api, Roles.Administrator);
        await using var connection = new Microsoft.Data.SqlClient.SqlConnection(api.ConnectionString);
        await connection.OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await using var command = connection.CreateCommand();
        command.Transaction = (Microsoft.Data.SqlClient.SqlTransaction)transaction;
        command.CommandText = "EXEC sys.sp_getapplock @Resource = 'PayrollPeriod:2020-04', @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 0;";
        await command.ExecuteNonQueryAsync();
        var responses = new[]
        {
            await api.GetAsync("/api/payroll?month=2020-04", admin.Token),
            await api.GetAsync("/api/payroll/pdf?month=2020-04", admin.Token),
            await api.PostAsync("/api/payroll/2020-04/finalise", new { revision = "x" }, admin.Token),
            await api.SendAsync(HttpMethod.Delete, "/api/payroll/2020-04/finalise", new { reason = "correction" }, admin.Token)
        };
        foreach (var response in responses)
        {
            Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
            var text = await response.Content.ReadAsStringAsync();
            Assert.DoesNotContain("SqlException", text);
            Assert.Contains("Reload and try again", text);
        }
        await transaction.RollbackAsync();
    }}
