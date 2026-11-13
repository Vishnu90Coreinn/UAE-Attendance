using System.Net;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>The Viewer role (shown as "Partner") sees the pay pages, pay included, and can change nothing. It has no User Manager.</summary>
public class ViewerRoleTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private async Task<string> TokenAsync(string role) => (await TestWorkers.SignInAsync(api, role)).Token;

    public static TheoryData<string> Reads => new()
    {
        "/api/workers", "/api/payroll?month=2026-10", "/api/deductions?month=2026-10", "/api/deduction-types", "/api/attendance?date=2026-10-05",
        "/api/leave/export/pdf?month=2026-10", "/api/invoices", "/api/invoice-clients", "/api/documents/settings", "/api/letters",
        "/api/certificate-requests", "/api/site-projects", "/api/settings/payroll",
    };

    [Theory]
    [MemberData(nameof(Reads))]
    public async Task AViewerCanReadEveryPage(string path)
    {
        var response = await api.GetAsync(path, await TokenAsync(Roles.Viewer));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    public static TheoryData<string, string> Writes => new()
    {
        { "POST", "/api/workers" }, { "PUT", "/api/workers/1" }, { "POST", "/api/workers/1/deactivate" },
        { "PUT", "/api/attendance/2026-10-05" }, { "POST", "/api/attendance/2026-10-05/approve" },
        { "POST", "/api/leave" }, { "PUT", "/api/payroll/2026-10" }, { "POST", "/api/payroll/2026-10/finalise" },
        { "PUT", "/api/deductions/2026-10" }, { "POST", "/api/deduction-types" },
        { "POST", "/api/invoices" }, { "POST", "/api/invoices/1/issue" }, { "POST", "/api/invoices/1/payments" }, { "DELETE", "/api/invoices/1" },
        { "POST", "/api/invoice-clients" }, { "PUT", "/api/documents/settings" }, { "POST", "/api/documents/images/logo" },
        { "POST", "/api/letters/preview" }, { "POST", "/api/certificate-requests" }, { "PUT", "/api/certificate-requests/1/details" },
        { "POST", "/api/certificate-requests/1/submit" }, { "POST", "/api/certificate-requests/1/approve" }, { "POST", "/api/certificate-requests/1/reject" },
        { "POST", "/api/site-projects" }, { "PUT", "/api/site-progress/1" }, { "PUT", "/api/site-progress/1/2026-10-05" },
        { "PUT", "/api/settings/payroll" }, { "POST", "/api/users" }, { "PUT", "/api/users/1" }, { "DELETE", "/api/users/1" },
    };

    [Theory]
    [MemberData(nameof(Writes))]
    public async Task AViewerCanNeverWrite(string method, string path)
    {
        var token = await TokenAsync(Roles.Viewer);

        var response = await api.SendAsync(new HttpMethod(method), path, method == "DELETE" ? null : new { }, token);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task AViewerSeesPay_ButASupervisorStillDoesNot()
    {
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, hourlyRate: 6.67m);

        var viewer = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/workers/{worker.Id}", await TokenAsync(Roles.Viewer)));
        var supervisor = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/workers/{worker.Id}", await TokenAsync(Roles.Supervisor)));

        Assert.Equal(6.67m, viewer.GetProperty("hourlyRate").GetDecimal());
        Assert.Equal(JsonValueKind.Null, supervisor.GetProperty("hourlyRate").ValueKind);
    }

    [Fact]
    public async Task AViewerCannotOpenUserManager()
    {
        var response = await api.GetAsync("/api/users", await TokenAsync(Roles.Viewer));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task AManagerSeesPartnerAccounts_ButNotOtherManagers()
    {
        var partner = await TestUsers.CreateAsync(api.ConnectionString, role: Roles.Viewer);
        var otherManager = await TestUsers.CreateAsync(api.ConnectionString, role: Roles.Manager);

        var users = JsonDocument.Parse(await (await api.GetAsync("/api/users", await TokenAsync(Roles.Manager))).Content.ReadAsStringAsync()).RootElement;

        Assert.Contains(users.EnumerateArray(), u => u.GetProperty("username").GetString() == partner.Username);
        Assert.DoesNotContain(users.EnumerateArray(), u => u.GetProperty("username").GetString() == otherManager.Username);
    }
    [Fact]
    public async Task AViewerCanStillSignInAndChangeTheirOwnPassword()
    {
        var user = await TestUsers.CreateAsync(api.ConnectionString, role: Roles.Viewer);
        var token = await TestUsers.LoginAsync(api.Client, user.Username);

        var change = await api.PostAsync("/api/auth/change-password", new { currentPassword = TestUsers.DefaultPassword, newPassword = "Another-valid-pass-77" }, token);

        Assert.NotEqual(HttpStatusCode.Forbidden, change.StatusCode);
    }

    [Fact]
    public async Task AManagerCanCreateAPartner_ButNotAnotherManager()
    {
        var admin = await TokenAsync(Roles.Administrator);
        var manager = await TokenAsync(Roles.Manager);
        var body = new { username = TestUsers.UniqueName(), password = TestUsers.DefaultPassword, role = "Viewer" };

        Assert.Equal(HttpStatusCode.Created, (await api.PostAsync("/api/users", body, manager)).StatusCode);
        var managerBody = new { username = TestUsers.UniqueName(), password = TestUsers.DefaultPassword, role = "Manager" };
        Assert.Equal(HttpStatusCode.Forbidden, (await api.PostAsync("/api/users", managerBody, manager)).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await api.PostAsync("/api/users", managerBody, admin)).StatusCode);
    }

    [Fact]
    public async Task OtherRolesAreUnchanged()
    {
        Assert.Equal(HttpStatusCode.Forbidden, (await api.PostAsync("/api/invoices", new { }, await TokenAsync(Roles.HR))).StatusCode);
        Assert.NotEqual(HttpStatusCode.Forbidden, (await api.PostAsync("/api/invoices", new { }, await TokenAsync(Roles.Manager))).StatusCode);
    }
}
