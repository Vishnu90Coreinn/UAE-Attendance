using System.Net;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>The certificate flow: supervisor raises, HR prepares and sends, a manager approves or sends back; HR downloads.</summary>
public class CertificateRequestTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private async Task<string> TokenAsync(string role) => (await TestWorkers.SignInAsync(api, role)).Token;

    private async Task<int> WorkerAsync()
    {
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, fullName: "Flow Worker", designation: "Glazier", hourlyRate: 6.67m);
        await using var db = TestUsers.NewContext(api.ConnectionString);
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE Workers SET MonthlySalary = 1600, HousingAllowance = 800, JoinDate = '2022-03-15' WHERE Id = {worker.Id}");
        return worker.Id;
    }

    private static object Details(string addressedTo = "The Branch Manager") =>
        new { addressedTo, salutation = "Mr.", signerName = "Eng. Test Signer", signerTitle = "General Manager", issueDate = "2020-02-02" };

    private async Task<int> RaiseAsync(int workerId, string supervisorToken, string type = "Salary")
    {
        var response = await api.PostAsync("/api/certificate-requests", new { workerId, letterType = type, reason = "For a bank loan" }, supervisorToken);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await TestWorkers.ReadJsonAsync(response)).GetProperty("id").GetInt32();
    }

    private async Task<JsonElement> GetAsync(int id, string token) =>
        (await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/certificate-requests/{id}", token))).GetProperty("request");

    // --- who may do what ------------------------------------------------------------------------------------

    [Theory]
    [InlineData(Roles.Supervisor, HttpStatusCode.Created)]
    [InlineData(Roles.Manager, HttpStatusCode.Created)]
    [InlineData(Roles.Administrator, HttpStatusCode.Created)]
    [InlineData(Roles.HR, HttpStatusCode.Forbidden)]
    public async Task OnlySupervisorsAndAboveCanRaiseARequest(string role, HttpStatusCode expected)
    {
        var workerId = await WorkerAsync();
        var response = await api.PostAsync("/api/certificate-requests", new { workerId, letterType = "Salary" }, await TokenAsync(role));
        Assert.Equal(expected, response.StatusCode);
    }

    [Fact]
    public async Task AManagerCanPrepareARequestTheyRaisedThemselves()
    {
        var workerId = await WorkerAsync();
        var manager = await TokenAsync(Roles.Manager);
        var own = await RaiseAsync(workerId, manager);
        var bySupervisor = await RaiseAsync(workerId, await TokenAsync(Roles.Supervisor));

        Assert.Equal(HttpStatusCode.OK, (await api.SendAsync(HttpMethod.Put, $"/api/certificate-requests/{own}/details", Details(), manager)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await api.PostAsync($"/api/certificate-requests/{own}/submit", new { }, manager)).StatusCode);

        // A request raised by someone else stays with HR.
        Assert.Equal(HttpStatusCode.Forbidden, (await api.SendAsync(HttpMethod.Put, $"/api/certificate-requests/{bySupervisor}/details", Details(), manager)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await api.PostAsync($"/api/certificate-requests/{bySupervisor}/submit", new { }, manager)).StatusCode);
    }

    [Fact]
    public async Task RolesCanOnlyDoTheirOwnStep()
    {
        var workerId = await WorkerAsync();
        var supervisor = await TokenAsync(Roles.Supervisor);
        var hr = await TokenAsync(Roles.HR);
        var manager = await TokenAsync(Roles.Manager);
        var id = await RaiseAsync(workerId, supervisor);

        // Preparing details is HR's (or the Administrator's) job.
        Assert.Equal(HttpStatusCode.Forbidden, (await api.SendAsync(HttpMethod.Put, $"/api/certificate-requests/{id}/details", Details(), supervisor)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await api.SendAsync(HttpMethod.Put, $"/api/certificate-requests/{id}/details", Details(), manager)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await api.SendAsync(HttpMethod.Put, $"/api/certificate-requests/{id}/details", Details(), hr)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await api.PostAsync($"/api/certificate-requests/{id}/submit", new { }, manager)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await api.PostAsync($"/api/certificate-requests/{id}/submit", new { }, hr)).StatusCode);

        // Approving is the manager's (or the Administrator's) job, never HR's or the supervisor's.
        Assert.Equal(HttpStatusCode.Forbidden, (await api.PostAsync($"/api/certificate-requests/{id}/approve", new { }, hr)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await api.PostAsync($"/api/certificate-requests/{id}/approve", new { }, supervisor)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await api.PostAsync($"/api/certificate-requests/{id}/reject", new { reason = "no" }, hr)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await api.PostAsync($"/api/certificate-requests/{id}/approve", new { }, manager)).StatusCode);
    }

    [Fact]
    public async Task ASupervisorSeesOnlyTheirOwnRequests_AndNeverTheLetterContent()
    {
        var workerId = await WorkerAsync();
        var supervisor = await TokenAsync(Roles.Supervisor);
        var other = (await TestWorkers.SignInAsync(api, Roles.Supervisor)).Token;
        var mine = await RaiseAsync(workerId, supervisor);
        var theirs = await RaiseAsync(workerId, other);

        var list = JsonDocument.Parse(await (await api.GetAsync("/api/certificate-requests", supervisor)).Content.ReadAsStringAsync()).RootElement;
        var ids = list.EnumerateArray().Select(r => r.GetProperty("id").GetInt32()).ToList();
        Assert.Contains(mine, ids);
        Assert.DoesNotContain(theirs, ids);

        Assert.Equal(HttpStatusCode.Forbidden, (await api.GetAsync($"/api/certificate-requests/{mine}", supervisor)).StatusCode);
        var hr = await TokenAsync(Roles.HR);
        var all = JsonDocument.Parse(await (await api.GetAsync("/api/certificate-requests", hr)).Content.ReadAsStringAsync()).RootElement;
        Assert.Contains(theirs, all.EnumerateArray().Select(r => r.GetProperty("id").GetInt32()));
    }

    // --- the flow -------------------------------------------------------------------------------------------

    [Fact]
    public async Task Raise_RequiresAWorkerAndAType()
    {
        var supervisor = await TokenAsync(Roles.Supervisor);

        var response = await api.PostAsync("/api/certificate-requests", new { letterType = "Nonsense" }, supervisor);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var errors = (await TestWorkers.ReadJsonAsync(response)).GetProperty("errors");
        Assert.True(errors.TryGetProperty("workerId", out _));
        Assert.True(errors.TryGetProperty("letterType", out _));
    }

    [Fact]
    public async Task ANewRequest_IsRequested_WithNoLetterAndNoNumber()
    {
        var supervisor = await TokenAsync(Roles.Supervisor);
        var id = await RaiseAsync(await WorkerAsync(), supervisor);

        var request = await GetAsync(id, await TokenAsync(Roles.HR));

        Assert.Equal("Requested", request.GetProperty("status").GetString());
        Assert.False(request.GetProperty("hasDetails").GetBoolean());
        Assert.Equal(JsonValueKind.Null, request.GetProperty("refNo").ValueKind);
    }

    [Fact]
    public async Task Submit_NeedsSavedDetailsFirst()
    {
        var id = await RaiseAsync(await WorkerAsync(), await TokenAsync(Roles.Supervisor));

        var response = await api.PostAsync($"/api/certificate-requests/{id}/submit", new { }, await TokenAsync(Roles.HR));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Details_AreValidatedWhenSaved_AndTheWorkerAndTypeStayAsRequested()
    {
        var workerId = await WorkerAsync();
        var hr = await TokenAsync(Roles.HR);
        var id = await RaiseAsync(workerId, await TokenAsync(Roles.Supervisor), "Service");

        var future = await api.SendAsync(HttpMethod.Put, $"/api/certificate-requests/{id}/details",
            new { addressedTo = "X", signerName = "A", signerTitle = "B", issueDate = DateTime.UtcNow.AddDays(5).ToString("yyyy-MM-dd") }, hr);
        Assert.Equal(HttpStatusCode.BadRequest, future.StatusCode);

        // Whatever worker or type HR sends, the request decides them.
        var other = await WorkerAsync();
        var saved = await api.SendAsync(HttpMethod.Put, $"/api/certificate-requests/{id}/details",
            new { workerId = other, letterType = "Noc", addressedTo = "The Bank", signerName = "A", signerTitle = "B", issueDate = "2020-02-02" }, hr);
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var detail = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/certificate-requests/{id}", hr));
        Assert.Equal("Service", detail.GetProperty("document").GetProperty("content").GetProperty("letterType").GetString());
        Assert.Equal(workerId, detail.GetProperty("request").GetProperty("workerId").GetInt32());
    }

    [Fact]
    public async Task Approval_IssuesTheNumberedLetter_AndOnlyThen()
    {
        var workerId = await WorkerAsync();
        var supervisor = await TokenAsync(Roles.Supervisor);
        var hr = await TokenAsync(Roles.HR);
        var manager = await TokenAsync(Roles.Manager);
        var id = await RaiseAsync(workerId, supervisor);
        await api.SendAsync(HttpMethod.Put, $"/api/certificate-requests/{id}/details", Details(), hr);
        await api.PostAsync($"/api/certificate-requests/{id}/submit", new { }, hr);

        // Waiting for approval: no letter and no number yet.
        var waiting = await GetAsync(id, manager);
        Assert.Equal("PendingApproval", waiting.GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null, waiting.GetProperty("letterId").ValueKind);
        await using (var db = TestUsers.NewContext(api.ConnectionString))
            Assert.False(await db.IssuedLetters.AnyAsync(l => l.WorkerId == workerId));

        var approved = await TestWorkers.ReadJsonAsync(await api.PostAsync($"/api/certificate-requests/{id}/approve", new { }, manager));

        Assert.Equal("Approved", approved.GetProperty("status").GetString());
        Assert.StartsWith("DEAKS/HR/2020/", approved.GetProperty("refNo").GetString());
        Assert.NotNull(approved.GetProperty("reviewedBy").GetString());
        // HR (and the approving manager) can then open and download the certificate.
        var letterId = approved.GetProperty("letterId").GetInt32();
        Assert.Equal(HttpStatusCode.OK, (await api.GetAsync($"/api/letters/{letterId}", hr)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await api.GetAsync($"/api/letters/{letterId}/pdf", hr)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await api.GetAsync($"/api/letters/{letterId}/pdf", manager)).StatusCode);
        // The supervisor who asked cannot download it.
        Assert.Equal(HttpStatusCode.Forbidden, (await api.GetAsync($"/api/letters/{letterId}/pdf", supervisor)).StatusCode);
    }

    [Fact]
    public async Task ARequestCannotBeApprovedTwice_NorChangedAfterApproval()
    {
        var workerId = await WorkerAsync();
        var hr = await TokenAsync(Roles.HR);
        var manager = await TokenAsync(Roles.Manager);
        var id = await RaiseAsync(workerId, await TokenAsync(Roles.Supervisor));
        await api.SendAsync(HttpMethod.Put, $"/api/certificate-requests/{id}/details", Details(), hr);
        await api.PostAsync($"/api/certificate-requests/{id}/submit", new { }, hr);

        var both = await Task.WhenAll(
            api.PostAsync($"/api/certificate-requests/{id}/approve", new { }, manager),
            api.PostAsync($"/api/certificate-requests/{id}/approve", new { }, manager));

        Assert.Equal(1, both.Count(r => r.StatusCode == HttpStatusCode.OK));
        Assert.Equal(1, both.Count(r => r.StatusCode == HttpStatusCode.Conflict));
        await using var db = TestUsers.NewContext(api.ConnectionString);
        Assert.Equal(1, await db.IssuedLetters.CountAsync(l => l.WorkerId == workerId));
        Assert.Equal(HttpStatusCode.Conflict, (await api.SendAsync(HttpMethod.Put, $"/api/certificate-requests/{id}/details", Details(), hr)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await api.PostAsync($"/api/certificate-requests/{id}/submit", new { }, hr)).StatusCode);
    }

    [Fact]
    public async Task ApprovingBeforeHrHasSent_IsRefused()
    {
        var id = await RaiseAsync(await WorkerAsync(), await TokenAsync(Roles.Supervisor));

        var response = await api.PostAsync($"/api/certificate-requests/{id}/approve", new { }, await TokenAsync(Roles.Manager));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task SendingBack_NeedsAReason_ReturnsToHr_AndHrCanFixAndResubmit()
    {
        var workerId = await WorkerAsync();
        var hr = await TokenAsync(Roles.HR);
        var manager = await TokenAsync(Roles.Manager);
        var id = await RaiseAsync(workerId, await TokenAsync(Roles.Supervisor));
        await api.SendAsync(HttpMethod.Put, $"/api/certificate-requests/{id}/details", Details("Wrong Bank"), hr);
        await api.PostAsync($"/api/certificate-requests/{id}/submit", new { }, hr);

        Assert.Equal(HttpStatusCode.BadRequest, (await api.PostAsync($"/api/certificate-requests/{id}/reject", new { reason = "  " }, manager)).StatusCode);
        var returned = await TestWorkers.ReadJsonAsync(await api.PostAsync($"/api/certificate-requests/{id}/reject", new { reason = "Addressee is wrong" }, manager));
        Assert.Equal("Returned", returned.GetProperty("status").GetString());
        Assert.Equal("Addressee is wrong", returned.GetProperty("reviewNote").GetString());

        // Nothing was issued, a returned request cannot be approved, and HR can update and send it again.
        Assert.Equal(HttpStatusCode.Conflict, (await api.PostAsync($"/api/certificate-requests/{id}/approve", new { }, manager)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await api.SendAsync(HttpMethod.Put, $"/api/certificate-requests/{id}/details", Details("Right Bank"), hr)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await api.PostAsync($"/api/certificate-requests/{id}/submit", new { }, hr)).StatusCode);
        var approved = await TestWorkers.ReadJsonAsync(await api.PostAsync($"/api/certificate-requests/{id}/approve", new { }, manager));
        var letter = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/letters/{approved.GetProperty("letterId").GetInt32()}", hr));
        Assert.Equal("Right Bank", letter.GetProperty("document").GetProperty("content").GetProperty("addressedTo").GetString());
        Assert.Equal("", approved.GetProperty("reviewNote").GetString());
    }

    [Fact]
    public async Task EveryStepIsAudited()
    {
        var workerId = await WorkerAsync();
        var hr = await TokenAsync(Roles.HR);
        var manager = await TokenAsync(Roles.Manager);
        var id = await RaiseAsync(workerId, await TokenAsync(Roles.Supervisor));
        await api.SendAsync(HttpMethod.Put, $"/api/certificate-requests/{id}/details", Details(), hr);
        await api.PostAsync($"/api/certificate-requests/{id}/submit", new { }, hr);
        await api.PostAsync($"/api/certificate-requests/{id}/approve", new { }, manager);

        await using var db = TestUsers.NewContext(api.ConnectionString);
        var actions = await db.AuditLogs.Where(a => a.EntityType == "CertificateRequest" && (a.EntityId == id.ToString() || a.EntityId == "new"))
            .Select(a => a.Action).ToListAsync();
        Assert.Contains("CertificateRequested", actions);
        Assert.Contains("CertificateDetailsSaved", actions);
        Assert.Contains("CertificateSubmitted", actions);
        Assert.Contains("CertificateApproved", actions);
    }
}
