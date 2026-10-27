using System.Net;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

public sealed class LeaveExportTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private static List<List<string>> Table(byte[] bytes)
    {
        using var book = new ClosedXML.Excel.XLWorkbook(new MemoryStream(bytes));
        var sheet = book.Worksheet(1);
        return sheet.RowsUsed().Where(r => r.RowNumber() >= 7).Select(r => r.Cells(1, 10).Select(c => c.GetString()).ToList()).ToList();
    }

    [Fact]
    public async Task Excel_lists_the_requests_that_touch_the_month_and_counts_only_days_inside_it()
    {
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Manager);
        // 30 Jan to 2 Feb spans two months; 10 Feb is February only.
        foreach (var (type, start, end) in new[] { ("Sick Leave", "2032-01-30", "2032-02-02"), ("Emergency Leave", "2032-02-10", "2032-02-10") })
        {
            var r = await api.PostAsync("/api/leave", new { workerId = worker.Id, leaveType = type, startDate = start, endDate = end }, token);
            Assert.Equal(HttpStatusCode.Created, r.StatusCode);
        }

        var january = await api.GetAsync($"/api/leave/export/excel?month=2032-01&workerId={worker.Id}", token);
        Assert.Equal(HttpStatusCode.OK, january.StatusCode);
        Assert.EndsWith($"Leave_2032-01_{worker.WorkerCode}.xlsx", january.Content.Headers.ContentDisposition?.FileName?.Trim('"'));
        var rows = Table(await january.Content.ReadAsByteArrayAsync());
        var jan = Assert.Single(rows, r => r[1] == worker.WorkerCode);
        Assert.Equal("Sick Leave", jan[3]);
        Assert.Equal("4", jan[6]);   // whole request
        Assert.Equal("2", jan[7]);   // 30 and 31 January

        var february = Table(await (await api.GetAsync($"/api/leave/export/excel?month=2032-02&workerId={worker.Id}", token)).Content.ReadAsByteArrayAsync());
        var feb = february.Where(r => r[1] == worker.WorkerCode).ToList();
        Assert.Equal(2, feb.Count);
        Assert.Equal(["2", "1"], feb.Select(r => r[7]));   // 1-2 February, then 10 February
    }

    [Fact]
    public async Task Pdf_is_returned_and_bad_input_is_rejected()
    {
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Supervisor);
        var pdf = await api.GetAsync("/api/leave/export/pdf?month=2032-03", token);
        Assert.Equal(HttpStatusCode.OK, pdf.StatusCode);
        Assert.Equal("application/pdf", pdf.Content.Headers.ContentType?.MediaType);
        Assert.Equal("%PDF", System.Text.Encoding.ASCII.GetString((await pdf.Content.ReadAsByteArrayAsync()).Take(4).ToArray()));

        Assert.Equal(HttpStatusCode.BadRequest, (await api.GetAsync("/api/leave/export/pdf?month=2032-13", token)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await api.GetAsync("/api/leave/export/excel", token)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await api.GetAsync("/api/leave/export/excel?month=2032-03&workerId=999999", token)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await api.GetAsync("/api/leave/export/pdf?month=2032-03", null)).StatusCode);
    }
}
