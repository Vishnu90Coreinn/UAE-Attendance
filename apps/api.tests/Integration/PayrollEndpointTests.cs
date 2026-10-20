using System.Net;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

public class PayrollEndpointTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    public static TheoryData<string, string?, HttpStatusCode> Matrix => new()
    {
        { "", null, HttpStatusCode.Unauthorized }, { "/pdf", null, HttpStatusCode.Unauthorized },
        { "", Roles.Viewer, HttpStatusCode.OK }, { "/pdf", Roles.Viewer, HttpStatusCode.OK },
        { "", Roles.HrStaff, HttpStatusCode.OK }, { "/pdf", Roles.HrStaff, HttpStatusCode.OK },
        { "", Roles.Administrator, HttpStatusCode.OK }, { "/pdf", Roles.Administrator, HttpStatusCode.OK },
    };

    [Theory, MemberData(nameof(Matrix))]
    public async Task Routes_EnforceRoles(string suffix, string? role, HttpStatusCode expected)
    {
        var token = role is null ? null : (await TestWorkers.SignInAsync(api, role)).Token;
        var response = await api.GetAsync($"/api/payroll{suffix}?month=2026-01", token);
        Assert.Equal(expected, response.StatusCode);
        if (expected == HttpStatusCode.OK)
        {
            Assert.True(response.Headers.CacheControl?.NoStore);
            if (suffix == "/pdf")
            {
                Assert.Equal("application/pdf", response.Content.Headers.ContentType?.MediaType);
                Assert.Equal("Payroll_2026-01.pdf", response.Content.Headers.ContentDisposition?.FileNameStar);
                Assert.StartsWith("%PDF-", System.Text.Encoding.ASCII.GetString(await response.Content.ReadAsByteArrayAsync()));
            }
        }
    }

    [Theory]
    [InlineData(null)] [InlineData("")] [InlineData("2026-1")] [InlineData("0000-01")]
    [InlineData("10000-01")] [InlineData("2026-13")] [InlineData(" 2026-01")]
    public async Task InvalidMonth_ReturnsValidationProblem(string? month)
    {
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Viewer);
        foreach (var suffix in new[] { "", "/pdf" })
        {
            var response = await api.GetAsync($"/api/payroll{suffix}?month={Uri.EscapeDataString(month ?? "")}", token);
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.True((await TestWorkers.ReadJsonAsync(response)).GetProperty("errors").TryGetProperty("month", out _));
        }
    }
    [Fact]
    public async Task Export_RejectsStaleRevisionAndUsesCurrentContent()
    {
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Viewer);
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        var report = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/payroll?month=2026-01", token));
        var revision = report.GetProperty("revision").GetString();
        var pdf = await api.GetAsync($"/api/payroll/pdf?month=2026-01&revision={revision}", token);
        Assert.Equal(HttpStatusCode.OK, pdf.StatusCode);
        await TestWorkers.SetOvertimeRateAsync(api.ConnectionString, worker.Id, 99m);
        var stale = await api.GetAsync($"/api/payroll/pdf?month=2026-01&revision={revision}", token);
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        Assert.True(stale.Headers.CacheControl?.NoStore);
        Assert.Equal("Payroll changed. Reload the report before exporting.",
            (await TestWorkers.ReadJsonAsync(stale)).GetProperty("title").GetString());
    }

    [Fact]
    public async Task UnsupportedPdfText_Returns422_WithoutRestrictingWorkerOrJsonReport()
    {
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Viewer);
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, fullName: "محمد علي", designation: "عامل");
        try
        {
            var response = await api.GetAsync("/api/payroll/pdf?month=2026-01", token);
            Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
            Assert.True(response.Headers.CacheControl?.NoStore);
            Assert.Equal("This PDF supports English text. Update unsupported characters or use Print for this report.",
                (await TestWorkers.ReadJsonAsync(response)).GetProperty("title").GetString());
            var json = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/payroll?month=2026-01", token));
            Assert.Equal("محمد علي", json.GetProperty("lines").EnumerateArray().Single(l => l.GetProperty("workerId").GetInt32() == worker.Id).GetProperty("workerName").GetString());
        }
        finally
        {
            await using var db = TestUsers.NewContext(api.ConnectionString);
            await Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions.ExecuteDeleteAsync(db.Workers.Where(w => w.Id == worker.Id));
        }
    }
}
