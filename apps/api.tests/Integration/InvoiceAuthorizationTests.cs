using System.Net;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>Role matrix for every invoicing route: anonymous 401, supervisor 403, HR read-only, Manager and Administrator full.</summary>
public class InvoiceAuthorizationTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private const string Missing = "999999";

    public static IEnumerable<object[]> Reads() =>
    [
        ["GET", "/api/invoices"],
        ["GET", "/api/invoices/export"],
        ["GET", $"/api/invoices/{Missing}"],
        ["GET", $"/api/invoices/{Missing}/pdf"],
        ["GET", "/api/invoice-clients"],
        ["GET", "/api/documents/settings"],
        ["GET", "/api/documents/images/logo"],
    ];

    public static IEnumerable<object[]> Writes() =>
    [
        ["POST", "/api/invoices"],
        ["PUT", $"/api/invoices/{Missing}"],
        ["DELETE", $"/api/invoices/{Missing}"],
        ["POST", $"/api/invoices/{Missing}/duplicate"],
        ["POST", $"/api/invoices/{Missing}/issue"],
        ["POST", $"/api/invoices/{Missing}/cancel"],
        ["POST", $"/api/invoices/{Missing}/payments"],
        ["DELETE", $"/api/invoices/{Missing}/payments/1"],
        ["POST", "/api/invoice-clients"],
        ["PUT", "/api/invoice-clients/1"],
        ["PUT", "/api/documents/settings"],
        ["POST", "/api/documents/images/logo"],
        ["DELETE", "/api/documents/images/logo"],
    ];

    private Task<HttpResponseMessage> Send(string verb, string url, string? token) =>
        api.SendAsync(new HttpMethod(verb), url, verb is "GET" or "DELETE" ? null : new { }, token);

    [Theory]
    [MemberData(nameof(Reads))]
    [MemberData(nameof(Writes))]
    public async Task Anonymous_IsUnauthorized(string verb, string url) =>
        Assert.Equal(HttpStatusCode.Unauthorized, (await Send(verb, url, null)).StatusCode);

    [Theory]
    [MemberData(nameof(Reads))]
    [MemberData(nameof(Writes))]
    public async Task Supervisor_IsForbiddenEverywhere(string verb, string url)
    {
        var token = (await TestWorkers.SignInAsync(api, Roles.Supervisor)).Token;
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(verb, url, token)).StatusCode);
    }

    [Theory]
    [MemberData(nameof(Reads))]
    public async Task Hr_CanRead(string verb, string url)
    {
        var token = (await TestWorkers.SignInAsync(api, Roles.HR)).Token;
        var status = (await Send(verb, url, token)).StatusCode;
        Assert.DoesNotContain(status, new[] { HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden });
    }

    [Theory]
    [MemberData(nameof(Writes))]
    public async Task Hr_CannotWrite(string verb, string url)
    {
        var token = (await TestWorkers.SignInAsync(api, Roles.HR)).Token;
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(verb, url, token)).StatusCode);
    }

    [Theory]
    [InlineData(Roles.Manager)]
    [InlineData(Roles.Administrator)]
    public async Task ManagerAndAdministrator_ReachEveryRoute(string role)
    {
        var token = (await TestWorkers.SignInAsync(api, role)).Token;
        foreach (var route in Reads().Concat(Writes()))
        {
            var status = (await Send((string)route[0], (string)route[1], token)).StatusCode;
            Assert.True(status is not (HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden), $"{route[0]} {route[1]} returned {(int)status}");
        }
    }
}
