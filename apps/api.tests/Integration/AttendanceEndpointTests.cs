using System.Net;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

public class AttendanceEndpointTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private const string Date = "2026-01-15";
    public static TheoryData<string, string?, HttpStatusCode> RolesMatrix => new()
    {
        {"GET", null, HttpStatusCode.Unauthorized}, {"PUT", null, HttpStatusCode.Unauthorized}, {"DELETE", null, HttpStatusCode.Unauthorized},
        {"GET", Roles.Supervisor, HttpStatusCode.OK}, {"PUT", Roles.Supervisor, HttpStatusCode.OK}, {"DELETE", Roles.Supervisor, HttpStatusCode.NoContent},
        {"GET", Roles.Manager, HttpStatusCode.OK}, {"PUT", Roles.Manager, HttpStatusCode.OK}, {"DELETE", Roles.Manager, HttpStatusCode.NoContent},
        {"GET", Roles.Administrator, HttpStatusCode.OK}, {"PUT", Roles.Administrator, HttpStatusCode.OK}, {"DELETE", Roles.Administrator, HttpStatusCode.NoContent},
    };

    [Theory, MemberData(nameof(RolesMatrix))]
    public async Task EveryRoute_EnforcesRoles(string method, string? role, HttpStatusCode expected)
    {
        var token = role is null ? null : (await TestWorkers.SignInAsync(api, role)).Token;
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        var path = method == "GET" ? $"/api/attendance?date={Date}" : $"/api/attendance/{Date}";
        if (method == "DELETE") path += $"/{worker.Id}";
        var response = await api.SendAsync(new HttpMethod(method), path,
            method == "PUT" ? new[] { new { workerId = worker.Id, status = "Present", basicHours = 8m, overtimeHours = 2m } } : null, token);
        Assert.Equal(expected, response.StatusCode);
    }

    [Fact]
    public async Task Save_ReturnsComputedPay_AndDeleteRestoresNotRecorded()
    {
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, overtimeRate: 3m);
        var response = await api.SendAsync(HttpMethod.Put, $"/api/attendance/{Date}",
            new[] { new { workerId = worker.Id, status = "Present", basicHours = 8m, overtimeHours = 2m } }, token);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var json = await TestWorkers.ReadJsonAsync(response);
        var row = json.GetProperty("rows").EnumerateArray().Single(r => r.GetProperty("worker").GetProperty("id").GetInt32() == worker.Id);
        Assert.Equal(106m, row.GetProperty("dailyPay").GetProperty("totalPay").GetDecimal());
        Assert.Equal(HttpStatusCode.NoContent, (await api.SendAsync(HttpMethod.Delete, $"/api/attendance/{Date}/{worker.Id}", token: token)).StatusCode);
        var day = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/attendance?date={Date}", token));
        Assert.Equal(System.Text.Json.JsonValueKind.Null, day.GetProperty("rows").EnumerateArray().Single(r => r.GetProperty("worker").GetProperty("id").GetInt32() == worker.Id).GetProperty("record").ValueKind);
    }

    private async Task<HttpResponseMessage> SeedAndExportAsync(string role, string format)
    {
        var (_, manager) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, overtimeRate: 3m);
        await api.SendAsync(HttpMethod.Put, $"/api/attendance/{Date}",
            new[] { new { workerId = worker.Id, status = "Present", basicHours = 8m, overtimeHours = 2m } }, manager);
        var (_, token) = await TestWorkers.SignInAsync(api, role);
        return await api.GetAsync($"/api/attendance/{Date}/export/{format}", token);
    }

    [Fact]
    public async Task ExportPdf_ReturnsAPdfNamedForTheDate()
    {
        var response = await SeedAndExportAsync(Roles.Manager, "pdf");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/pdf", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal($"Attendance_{Date}.pdf", response.Content.Headers.ContentDisposition?.FileName?.Trim('"'));
        var bytes = await response.Content.ReadAsByteArrayAsync();
        Assert.Equal("%PDF", System.Text.Encoding.ASCII.GetString(bytes, 0, 4));
    }

    [Fact]
    public async Task ExportExcel_IncludesPayForManagers_AndOmitsItForSupervisors()
    {
        static List<string> Headers(byte[] bytes)
        {
            using var book = new ClosedXML.Excel.XLWorkbook(new MemoryStream(bytes));
            return book.Worksheet(1).Row(6).CellsUsed().Select(c => c.GetString()).ToList();
        }

        var manager = await SeedAndExportAsync(Roles.Manager, "excel");
        Assert.Equal(HttpStatusCode.OK, manager.StatusCode);
        Assert.Equal($"Attendance_{Date}.xlsx", manager.Content.Headers.ContentDisposition?.FileName?.Trim('"'));
        Assert.Contains("Daily pay (AED)", Headers(await manager.Content.ReadAsByteArrayAsync()));

        var supervisor = await SeedAndExportAsync(Roles.Supervisor, "excel");
        Assert.Equal(HttpStatusCode.OK, supervisor.StatusCode);
        var headers = Headers(await supervisor.Content.ReadAsByteArrayAsync());
        Assert.Contains("Overtime hours", headers);
        Assert.DoesNotContain("Daily pay (AED)", headers);
    }

    [Theory]
    [InlineData("pdf")]
    [InlineData("excel")]
    public async Task Export_IsAvailableToHr(string format)
    {
        var response = await SeedAndExportAsync(Roles.HR, format);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Theory]
    [InlineData("pdf")]
    [InlineData("excel")]
    public async Task Export_RejectsAnInvalidDate_AndRequiresSignIn(string format)
    {
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Manager);
        Assert.Equal(HttpStatusCode.BadRequest, (await api.GetAsync($"/api/attendance/not-a-date/export/{format}", token)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await api.GetAsync($"/api/attendance/{Date}/export/{format}", null)).StatusCode);
    }
}
