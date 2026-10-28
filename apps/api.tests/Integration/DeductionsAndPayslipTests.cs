using System.Net;
using System.Text;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>Deductions per worker per month, net pay, and payslips. Each test uses its own month so tests do not interfere.</summary>
public class DeductionsAndPayslipTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private async Task<(int Id, string Code)> WorkerAsync(decimal rate = 10m, string name = "Pay Test", string? code = null)
    {
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, workerCode: code, fullName: name, hourlyRate: rate);
        return (worker.Id, worker.WorkerCode);
    }

    private async Task PresentAsync(string date, int workerId, decimal basic, string token) =>
        Assert.Equal(HttpStatusCode.OK, (await api.SendAsync(HttpMethod.Put, $"/api/attendance/{date}",
            new[] { new { workerId, status = "Present", basicHours = basic, overtimeHours = 0m } }, token)).StatusCode);

    private async Task<HttpResponseMessage> SaveDeductionsAsync(string month, object body, string token) =>
        await api.SendAsync(HttpMethod.Put, $"/api/deductions/{month}", body, token);

    private async Task<HttpResponseMessage> FinaliseAsync(string month, string token)
    {
        var report = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/payroll?month={month}", token));
        return await api.PostAsync($"/api/payroll/{month}/finalise", new { revision = report.GetProperty("revision").GetString() }, token);
    }

    private static object Deduction(int typeId, decimal amount, string note = "Advance agreed with supervisor") =>
        new { deductionTypeId = typeId, amount, note };

    [Fact]
    public async Task DeductionTypes_AreManagerOnly_AndNamesAreUniqueAndRequired()
    {
        var (_, supervisor) = await TestWorkers.SignInAsync(api, Roles.Supervisor);
        var (_, manager) = await TestWorkers.SignInAsync(api, Roles.Manager);

        Assert.Equal(HttpStatusCode.Forbidden, (await api.GetAsync("/api/deduction-types", supervisor)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await api.GetAsync("/api/deduction-types", manager)).StatusCode);

        var name = "Medical " + Guid.NewGuid().ToString("N")[..6];
        var created = await api.PostAsync("/api/deduction-types", new { name }, manager);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var id = (await TestWorkers.ReadJsonAsync(created)).GetProperty("id").GetInt32();

        Assert.Equal(HttpStatusCode.BadRequest, (await api.PostAsync("/api/deduction-types", new { name = name.ToUpperInvariant() }, manager)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await api.PostAsync("/api/deduction-types", new { name = "  " }, manager)).StatusCode);

        var retired = await api.SendAsync(HttpMethod.Put, $"/api/deduction-types/{id}", new { name, isActive = false }, manager);
        Assert.Equal(HttpStatusCode.OK, retired.StatusCode);
        Assert.False((await TestWorkers.ReadJsonAsync(retired)).GetProperty("isActive").GetBoolean());
    }

    [Fact]
    public async Task Deductions_ManagerRecordsThem_SupervisorCannotSeeOrChangeThem()
    {
        var (_, supervisor) = await TestWorkers.SignInAsync(api, Roles.Supervisor);
        var (_, manager) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var worker = await WorkerAsync();

        Assert.Equal(HttpStatusCode.Forbidden, (await api.GetAsync("/api/deductions?month=2024-01", supervisor)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await SaveDeductionsAsync("2024-01",
            new { workers = new[] { new { workerId = worker.Id, entries = new[] { Deduction(1, 50m) } } } }, supervisor)).StatusCode);

        var saved = await SaveDeductionsAsync("2024-01",
            new { workers = new[] { new { workerId = worker.Id, entries = new[] { Deduction(1, 50m) } } } }, manager);
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var row = (await TestWorkers.ReadJsonAsync(saved)).GetProperty("workers").EnumerateArray()
            .Single(w => w.GetProperty("workerId").GetInt32() == worker.Id);
        var entry = row.GetProperty("entries").EnumerateArray().Single();
        Assert.Equal(50m, entry.GetProperty("amount").GetDecimal());
    }

    [Theory]
    [InlineData("amount-zero")]
    [InlineData("note-missing")]
    [InlineData("unknown-type")]
    [InlineData("future-month")]
    public async Task Deductions_ValidationRefusesBadEntries(string case_)
    {
        var (_, manager) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var worker = await WorkerAsync();
        var month = case_ == "future-month" ? DateTime.UtcNow.AddMonths(3).ToString("yyyy-MM") : "2024-02";
        var entry = case_ switch
        {
            "amount-zero" => Deduction(1, 0m),
            "note-missing" => Deduction(1, 10m, " "),
            "unknown-type" => Deduction(9999, 10m),
            _ => Deduction(1, 10m),
        };
        var response = await SaveDeductionsAsync(month, new { workers = new[] { new { workerId = worker.Id, entries = new[] { entry } } } }, manager);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task NetPay_SubtractsDeductions_AndFinaliseRefusesNegativeNet()
    {
        var (_, manager) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var worker = await WorkerAsync(rate: 10m);
        const string month = "2024-03";
        await PresentAsync("2024-03-04", worker.Id, 8m, manager); // salary 2400, 25 other weekdays unpaid: 2400 - 25 x 80 = 400 gross

        await SaveDeductionsAsync(month, new { workers = new[] { new { workerId = worker.Id, entries = new[] { Deduction(1, 25m) } } } }, manager);
        var report = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/payroll?month={month}", manager));
        var line = report.GetProperty("lines").EnumerateArray().Single(l => l.GetProperty("workerId").GetInt32() == worker.Id);
        Assert.Equal(400m, line.GetProperty("totalPay").GetDecimal());
        Assert.Equal(25m, line.GetProperty("totalDeductions").GetDecimal());
        Assert.Equal(375m, line.GetProperty("netPay").GetDecimal());
        Assert.Equal("Advance / Loan", line.GetProperty("deductions").EnumerateArray().Single().GetProperty("name").GetString());

        await SaveDeductionsAsync(month, new { workers = new[] { new { workerId = worker.Id, entries = new[] { Deduction(1, 500m) } } } }, manager);
        var refused = await FinaliseAsync(month, manager);
        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        Assert.Contains("more than the amount earned", await refused.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Payslips_AreAvailableBeforeFinalising_AndAreManagerOnly()
    {
        var (_, supervisor) = await TestWorkers.SignInAsync(api, Roles.Supervisor);
        var (_, manager) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var worker = await WorkerAsync(rate: 12m, name: "Payslip Person");
        const string month = "2024-04";
        await PresentAsync("2024-04-10", worker.Id, 8m, manager);

        var draftPayslip = await api.GetAsync($"/api/payroll/{month}/payslips/{worker.Id}/pdf", manager);
        Assert.Equal(HttpStatusCode.OK, draftPayslip.StatusCode);
        Assert.Equal("%PDF", Encoding.ASCII.GetString(await draftPayslip.Content.ReadAsByteArrayAsync(), 0, 4));
        Assert.Equal(HttpStatusCode.Forbidden, (await api.GetAsync($"/api/payroll/{month}/payslips/{worker.Id}/pdf", supervisor)).StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await FinaliseAsync(month, manager)).StatusCode);

        var payslip = await api.GetAsync($"/api/payroll/{month}/payslips/{worker.Id}/pdf", manager);
        Assert.Equal(HttpStatusCode.OK, payslip.StatusCode);
        Assert.Equal("application/pdf", payslip.Content.Headers.ContentType!.MediaType);
        var bytes = await payslip.Content.ReadAsByteArrayAsync();
        Assert.Equal("%PDF", Encoding.ASCII.GetString(bytes, 0, 4));
        Assert.Contains($"Payslip_{month}_", payslip.Content.Headers.ContentDisposition!.FileNameStar ?? payslip.Content.Headers.ContentDisposition.FileName ?? "");

        Assert.Equal(HttpStatusCode.NotFound, (await api.GetAsync($"/api/payroll/{month}/payslips/999999/pdf", manager)).StatusCode);
    }

    [Fact]
    public async Task Payslips_RefuseNamesThatTheFontCannotPrint()
    {
        var (_, manager) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var worker = await WorkerAsync(rate: 12m, name: "Иванов");
        const string month = "2024-05";
        await PresentAsync("2024-05-06", worker.Id, 8m, manager);
        Assert.Equal(HttpStatusCode.OK, (await FinaliseAsync(month, manager)).StatusCode);

        var response = await api.GetAsync($"/api/payroll/{month}/payslips/{worker.Id}/pdf", manager);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    [Fact]
    public async Task Payslip_ShowsTheFinalisedDeductionsInTheFrozenNetPay()
    {
        var (_, manager) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var worker = await WorkerAsync(rate: 10m, name: "Frozen Net");
        const string month = "2024-06";
        await PresentAsync("2024-06-03", worker.Id, 8m, manager);
        await SaveDeductionsAsync(month, new { workers = new[] { new { workerId = worker.Id, entries = new[] { Deduction(2, 15m, "Fuel advance") } } } }, manager);
        Assert.Equal(HttpStatusCode.OK, (await FinaliseAsync(month, manager)).StatusCode);

        // Once finalised, deductions can no longer be changed.
        var late = await SaveDeductionsAsync(month, new { workers = new[] { new { workerId = worker.Id, entries = new[] { Deduction(2, 99m) } } } }, manager);
        Assert.Equal(HttpStatusCode.Conflict, late.StatusCode);

        var report = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/payroll?month={month}", manager));
        Assert.Equal("Finalised", report.GetProperty("status").GetString());
        var line = report.GetProperty("lines").EnumerateArray().Single(l => l.GetProperty("workerId").GetInt32() == worker.Id);
        // June 2024: salary 2400 less 24 unpaid weekdays (1920) = 480, less the 15 advance.
        Assert.Equal(465m, line.GetProperty("netPay").GetDecimal());
        Assert.Equal("Fuel advance", line.GetProperty("deductions").EnumerateArray().Single().GetProperty("note").GetString());
    }
}
