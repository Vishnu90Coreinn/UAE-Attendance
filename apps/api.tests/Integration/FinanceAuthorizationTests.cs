using System.Net;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>
/// Role matrix for every finance route: anonymous 401; HR, Supervisor and Employee 403 even to read; the Partner
/// (Viewer) reads but never writes; Manager and Administrator do both.
/// </summary>
public class FinanceAuthorizationTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private const string Missing = "999999";

    public static IEnumerable<object[]> Reads() =>
    [
        ["GET", "/api/finance/accounts"],
        ["GET", "/api/finance/categories"],
        ["GET", "/api/finance/transfers"],
        ["GET", "/api/finance/expenses"],
        ["GET", $"/api/finance/expenses/{Missing}"],
        ["GET", "/api/finance/expenses/parties"],
        ["GET", "/api/finance/income"],
        ["GET", $"/api/finance/income/{Missing}"],
        ["GET", "/api/finance/income/parties"],
        ["GET", "/api/finance/month-locks"],
        ["GET", "/api/finance/dashboard"],
        ["GET", "/api/finance/reports/summary"],
        ["GET", "/api/finance/partners"],
        ["GET", "/api/finance/capital"],
        ["GET", $"/api/finance/capital/{Missing}"],
        ["GET", $"/api/finance/attachments/{Missing}"],
    ];

    public static IEnumerable<object[]> Writes() =>
    [
        ["POST", "/api/finance/accounts"],
        ["PUT", $"/api/finance/accounts/{Missing}"],
        ["POST", $"/api/finance/accounts/{Missing}/deactivate"],
        ["POST", $"/api/finance/accounts/{Missing}/activate"],
        ["POST", "/api/finance/categories"],
        ["PUT", $"/api/finance/categories/{Missing}"],
        ["POST", "/api/finance/transfers"],
        ["POST", "/api/finance/expenses"],
        ["POST", "/api/finance/income"],
        ["PUT", $"/api/finance/expenses/{Missing}"],
        ["PUT", $"/api/finance/income/{Missing}"],
        ["POST", $"/api/finance/expenses/{Missing}/void"],
        ["POST", $"/api/finance/income/{Missing}/void"],
        ["PUT", $"/api/finance/transfers/{Missing}"],
        ["POST", $"/api/finance/transfers/{Missing}/void"],
        ["POST", "/api/finance/partners"],
        ["PUT", $"/api/finance/partners/{Missing}"],
        ["POST", "/api/finance/capital/contributions"],
        ["POST", "/api/finance/capital/returns"],
        ["PUT", $"/api/finance/capital/{Missing}"],
        ["POST", $"/api/finance/capital/{Missing}/void"],
        ["POST", "/api/finance/month-locks/2026-01/lock"],
        ["POST", "/api/finance/month-locks/2026-01/unlock"],
    ];

    private Task<HttpResponseMessage> Send(string verb, string url, string? token) =>
        api.SendAsync(new HttpMethod(verb), url, verb is "GET" or "DELETE" ? null : new { }, token);

    private static bool Denied(HttpStatusCode status) => status is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden;

    [Theory]
    [MemberData(nameof(Reads))]
    [MemberData(nameof(Writes))]
    public async Task Anonymous_IsUnauthorized(string verb, string url) =>
        Assert.Equal(HttpStatusCode.Unauthorized, (await Send(verb, url, null)).StatusCode);

    [Theory]
    [InlineData(Roles.HR)]
    [InlineData(Roles.Supervisor)]
    [InlineData(Roles.Employee)]
    public async Task OtherRoles_AreForbiddenEverywhere(string role)
    {
        var token = (await TestWorkers.SignInAsync(api, role)).Token;
        foreach (var route in Reads().Concat(Writes()))
            Assert.Equal(HttpStatusCode.Forbidden, (await Send((string)route[0], (string)route[1], token)).StatusCode);
    }

    [Theory]
    [MemberData(nameof(Reads))]
    public async Task Partner_CanRead(string verb, string url)
    {
        var token = (await TestWorkers.SignInAsync(api, Roles.Viewer)).Token;
        Assert.False(Denied((await Send(verb, url, token)).StatusCode));
    }

    [Theory]
    [MemberData(nameof(Writes))]
    public async Task Partner_CannotWrite(string verb, string url)
    {
        var token = (await TestWorkers.SignInAsync(api, Roles.Viewer)).Token;
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(verb, url, token)).StatusCode);
    }

    [Theory]
    [InlineData(Roles.Manager)]
    [InlineData(Roles.Administrator)]
    public async Task ManagerAndAdministrator_ReachEveryRoute(string role)
    {
        var token = (await TestWorkers.SignInAsync(api, role)).Token;
        foreach (var route in Reads().Concat(Writes()))
            Assert.False(Denied((await Send((string)route[0], (string)route[1], token)).StatusCode), $"{route[0]} {route[1]}");
    }
}
