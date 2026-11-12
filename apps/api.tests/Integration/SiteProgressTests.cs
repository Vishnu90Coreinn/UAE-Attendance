using System.Net;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using HrPayroll.Api.Services;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Integration;

public class SiteProgressTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private static object Floor(string name, int frames, int glass, string completion, string wir, string remarks = "", int shutters = 0, string alignment = "NotComplete") =>
        new { floor = name, frames, glass, shutters, alignment, completion, wirStatus = wir, remarks };

    /// <summary>The prototype's sample data: 76 frames, 58 glass, 2 completed floors, 1 untouched floor, 3 floors awaiting WIR approval.</summary>
    private static object[] PrototypeFloors() =>
    [
        Floor("Ground Floor (L00)", 24, 24, "Completed", "Approved", "100% installed and consultant approved."),
        Floor("1st Floor (L01)", 18, 18, "Completed", "Approved"),
        Floor("2nd Floor (L02)", 16, 12, "InProgress", "Submitted", "4 panels pending on East elevation."),
        Floor("3rd Floor (L03)", 10, 4, "InProgress", "ApprovedWithComments"),
        Floor("4th Floor (L04)", 8, 0, "InProgress", "Rejected"),
        Floor("5th Floor (L05)", 0, 0, "NotStarted", "Pending"),
    ];

    private async Task<(int Id, string Manager, string Supervisor)> ProjectAsync()
    {
        var (_, manager) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var (_, supervisor) = await TestWorkers.SignInAsync(api, Roles.Supervisor);
        var created = await api.PostAsync("/api/site-projects", new { name = "Tower " + Guid.NewGuid().ToString("N")[..8] }, manager);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        return ((await TestWorkers.ReadJsonAsync(created)).GetProperty("id").GetInt32(), manager, supervisor);
    }

    private Task<HttpResponseMessage> SaveAsync(int project, string date, object[] floors, string token) =>
        api.SendAsync(HttpMethod.Put, $"/api/site-progress/{project}/{date}", new { floors }, token);

    // --- KPIs ---------------------------------------------------------------------------------------------------

    [Fact]
    public async Task Save_ThenGet_ReturnsFloorsInOrder_WithThePrototypeKpis()
    {
        var (project, _, supervisor) = await ProjectAsync();

        var saved = await SaveAsync(project, "2026-10-01", PrototypeFloors(), supervisor);
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);

        var report = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/site-progress/{project}?date=2026-10-01", supervisor));
        Assert.True(report.GetProperty("exists").GetBoolean());
        Assert.Equal("Ground Floor (L00)", report.GetProperty("floors")[0].GetProperty("floor").GetString());
        Assert.Equal(6, report.GetProperty("floors").GetArrayLength());
        var kpis = report.GetProperty("kpis");
        Assert.Equal(76, kpis.GetProperty("totalFrames").GetInt32());
        Assert.Equal(58, kpis.GetProperty("totalGlass").GetInt32());
        Assert.Equal(2, kpis.GetProperty("completedFloors").GetInt32());
        Assert.Equal(1, kpis.GetProperty("noProgressFloors").GetInt32());
        Assert.Equal(2, kpis.GetProperty("pendingWir").GetInt32());
        Assert.Equal(3, kpis.GetProperty("approvedWir").GetInt32());
        Assert.Equal(1, kpis.GetProperty("rejectedWir").GetInt32());
        Assert.Equal(33, kpis.GetProperty("handoverReadyPercent").GetInt32());
    }

    // --- the live report (no date) ------------------------------------------------------------------------------

    private Task<HttpResponseMessage> SaveLiveAsync(int project, object[] floors, string token) =>
        api.SendAsync(HttpMethod.Put, $"/api/site-progress/{project}", new { floors }, token);

    [Fact]
    public async Task Live_IsEmptyUntilSaved_ThenReturnsTheLatestSnapshot_AndKeepsEarlierDays()
    {
        var (project, _, supervisor) = await ProjectAsync();

        var empty = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/site-progress/{project}", supervisor));
        Assert.False(empty.GetProperty("exists").GetBoolean());
        Assert.Equal(0, empty.GetProperty("floors").GetArrayLength());

        // An earlier day's snapshot, then today's live save.
        Assert.Equal(HttpStatusCode.OK, (await SaveAsync(project, "2026-10-01", [Floor("L1", 1, 1, "InProgress", "Pending")], supervisor)).StatusCode);
        var live = await SaveLiveAsync(project, [Floor("L1", 5, 5, "Completed", "Approved"), Floor("L2", 2, 2, "InProgress", "Pending")], supervisor);
        Assert.Equal(HttpStatusCode.OK, live.StatusCode);

        var current = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/site-progress/{project}", supervisor));
        Assert.True(current.GetProperty("exists").GetBoolean());
        Assert.Equal(2, current.GetProperty("floors").GetArrayLength());
        Assert.Equal(5, current.GetProperty("floors")[0].GetProperty("frames").GetInt32());

        // Saving again the same day replaces that day's snapshot rather than adding one.
        await SaveLiveAsync(project, [Floor("L1", 9, 9, "Completed", "Approved")], supervisor);
        var dates = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/site-progress/{project}/dates", supervisor));
        Assert.Equal(2, dates.GetArrayLength());

        // The earlier day is untouched.
        var old = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/site-progress/{project}?date=2026-10-01", supervisor));
        Assert.Equal(1, old.GetProperty("floors")[0].GetProperty("frames").GetInt32());
    }

    [Fact]
    public async Task Live_CsvAndPdfUseTheLatestReport()
    {
        var (project, _, supervisor) = await ProjectAsync();
        await SaveLiveAsync(project, [Floor("L1", 3, 2, "InProgress", "Pending")], supervisor);

        var csv = await api.GetAsync($"/api/site-progress/{project}/csv", supervisor);
        Assert.Equal(HttpStatusCode.OK, csv.StatusCode);
        var pdf = await api.GetAsync($"/api/site-progress/{project}/pdf", supervisor);
        Assert.Equal(HttpStatusCode.OK, pdf.StatusCode);
    }

    [Fact]
    public async Task Live_SaveIsRefusedForHr()
    {
        var (project, _, _) = await ProjectAsync();
        var (_, hr) = await TestWorkers.SignInAsync(api, Roles.HR);
        Assert.Equal(HttpStatusCode.Forbidden, (await SaveLiveAsync(project, [Floor("L1", 1, 1, "InProgress", "Pending")], hr)).StatusCode);
    }

    [Fact]
    public async Task Save_StoresShuttersAndAlignment_AndCountsThemInTheKpis()
    {
        var (project, _, supervisor) = await ProjectAsync();
        var floors = new[]
        {
            Floor("L1", 4, 2, "Completed", "AlignmentComplete", "", shutters: 6, alignment: "Complete"),
            Floor("L2", 0, 0, "InProgress", "AlignmentUnderProcess", "", shutters: 3, alignment: "UnderProcess"),
            Floor("L3", 0, 0, "NotStarted", "Pending"),
        };
        Assert.Equal(HttpStatusCode.OK, (await SaveAsync(project, "2026-10-20", floors, supervisor)).StatusCode);

        var report = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/site-progress/{project}?date=2026-10-20", supervisor));
        Assert.Equal(6, report.GetProperty("floors")[0].GetProperty("shutters").GetInt32());
        Assert.Equal("UnderProcess", report.GetProperty("floors")[1].GetProperty("alignment").GetString());
        Assert.Equal("AlignmentUnderProcess", report.GetProperty("floors")[1].GetProperty("wirStatus").GetString());
        var kpis = report.GetProperty("kpis");
        Assert.Equal(9, kpis.GetProperty("totalShutters").GetInt32());
        Assert.Equal(1, kpis.GetProperty("noProgressFloors").GetInt32());
        Assert.Equal(1, kpis.GetProperty("alignmentComplete").GetInt32());
        Assert.Equal(1, kpis.GetProperty("alignmentUnderProcess").GetInt32());
        Assert.Equal(1, kpis.GetProperty("alignmentNotComplete").GetInt32());
        Assert.Equal(3, kpis.GetProperty("pendingWir").GetInt32());
    }

    [Fact]
    public async Task Save_RejectsBadShuttersAndAlignment()
    {
        var (project, _, supervisor) = await ProjectAsync();
        Assert.Equal(HttpStatusCode.BadRequest, (await SaveAsync(project, "2026-10-21", [Floor("L1", 0, 0, "InProgress", "Pending", "", shutters: -1)], supervisor)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await SaveAsync(project, "2026-10-21", [Floor("L1", 0, 0, "InProgress", "Pending", "", alignment: "Half")], supervisor)).StatusCode);
    }

    // --- copy from previous ----------------------------------------------------------------------------------------

    [Fact]
    public async Task GetForANewDate_OffersTheMostRecentEarlierReport_WithoutStoringIt()
    {
        var (project, _, supervisor) = await ProjectAsync();
        await SaveAsync(project, "2026-09-01", [Floor("L1", 1, 1, "InProgress", "Pending")], supervisor);
        await SaveAsync(project, "2026-09-10", PrototypeFloors(), supervisor);

        var report = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/site-progress/{project}?date=2026-09-15", supervisor));

        Assert.False(report.GetProperty("exists").GetBoolean());
        Assert.Equal("2026-09-10", report.GetProperty("copiedFromDate").GetString());
        Assert.Equal(6, report.GetProperty("floors").GetArrayLength());
        var dates = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/site-progress/{project}/dates", supervisor));
        Assert.Equal(["2026-09-10", "2026-09-01"], dates.EnumerateArray().Select(d => d.GetString()!).ToArray());
    }

    [Fact]
    public async Task GetForTheFirstDate_HasNoFloorsAndNothingToCopy()
    {
        var (project, _, supervisor) = await ProjectAsync();

        var report = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/site-progress/{project}?date=2026-09-15", supervisor));

        Assert.False(report.GetProperty("exists").GetBoolean());
        Assert.Equal(JsonValueKind.Null, report.GetProperty("copiedFromDate").ValueKind);
        Assert.Equal(0, report.GetProperty("floors").GetArrayLength());
    }

    [Fact]
    public async Task Save_AgainOnTheSameDate_ReplacesTheFloors()
    {
        var (project, _, supervisor) = await ProjectAsync();
        await SaveAsync(project, "2026-10-02", [Floor("L1", 1, 1, "InProgress", "Pending"), Floor("L2", 2, 2, "InProgress", "Pending")], supervisor);

        var again = await SaveAsync(project, "2026-10-02", [Floor("L2", 9, 9, "Completed", "Approved")], supervisor);

        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        var floors = (await TestWorkers.ReadJsonAsync(again)).GetProperty("floors");
        Assert.Equal(1, floors.GetArrayLength());
        Assert.Equal(9, floors[0].GetProperty("frames").GetInt32());
    }

    // --- validation ---------------------------------------------------------------------------------------------

    [Fact]
    public async Task Save_RefusesFutureDates_BadDates_AndEmptyReports()
    {
        var (project, _, supervisor) = await ProjectAsync();
        var future = DateTime.UtcNow.AddDays(3).ToString("yyyy-MM-dd");

        Assert.Equal(HttpStatusCode.BadRequest, (await SaveAsync(project, future, PrototypeFloors(), supervisor)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await SaveAsync(project, "not-a-date", PrototypeFloors(), supervisor)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await SaveAsync(project, "2026-10-03", [], supervisor)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await api.GetAsync($"/api/site-progress/{project}?date={future}", supervisor)).StatusCode);
    }

    [Fact]
    public async Task Save_RefusesDuplicateFloorNames_IgnoringCase_AndBadValues()
    {
        var (project, _, supervisor) = await ProjectAsync();

        var duplicate = await SaveAsync(project, "2026-10-04",
            [Floor("L1", 1, 1, "InProgress", "Pending"), Floor(" l1 ", 2, 2, "InProgress", "Pending")], supervisor);
        Assert.Equal(HttpStatusCode.BadRequest, duplicate.StatusCode);
        Assert.Contains("floors[1].floor", (await duplicate.Content.ReadAsStringAsync()));

        Assert.Equal(HttpStatusCode.BadRequest, (await SaveAsync(project, "2026-10-04", [Floor("L1", -1, 0, "InProgress", "Pending")], supervisor)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await SaveAsync(project, "2026-10-04", [Floor("L1", 0, 0, "Done", "Pending")], supervisor)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await SaveAsync(project, "2026-10-04", [Floor("L1", 0, 0, "InProgress", "Maybe")], supervisor)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await SaveAsync(project, "2026-10-04", [Floor("", 0, 0, "InProgress", "Pending")], supervisor)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await SaveAsync(project, "2026-10-04", [Floor("L1", 0, 0, "InProgress", "Pending", new string('x', 501))], supervisor)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await api.SendJsonAsync(HttpMethod.Put, $"/api/site-progress/{project}/2026-10-04", "{\"floors\":[{\"floor\":\"L1\"}]}", supervisor)).StatusCode);
    }

    [Fact]
    public async Task Save_IntoAnInactiveProject_ForANewDate_Conflicts_ButExistingReportsStayEditable()
    {
        var (project, manager, supervisor) = await ProjectAsync();
        await SaveAsync(project, "2026-10-05", [Floor("L1", 1, 1, "InProgress", "Pending")], supervisor);
        var name = (await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/site-projects?includeInactive=true", manager))).EnumerateArray()
            .Single(p => p.GetProperty("id").GetInt32() == project).GetProperty("name").GetString();
        await api.SendAsync(HttpMethod.Put, $"/api/site-projects/{project}", new { name, isActive = false }, manager);

        Assert.Equal(HttpStatusCode.Conflict, (await SaveAsync(project, "2026-10-06", [Floor("L1", 1, 1, "InProgress", "Pending")], supervisor)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await SaveAsync(project, "2026-10-05", [Floor("L1", 2, 2, "InProgress", "Pending")], supervisor)).StatusCode);
    }

    // --- projects -----------------------------------------------------------------------------------------------

    [Fact]
    public async Task Projects_NamesAreUniqueIgnoringCase_AndInactiveOnesAreHiddenByDefault()
    {
        var (_, manager) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var name = "Marina " + Guid.NewGuid().ToString("N")[..8];
        var created = await api.PostAsync("/api/site-projects", new { name }, manager);
        var id = (await TestWorkers.ReadJsonAsync(created)).GetProperty("id").GetInt32();

        Assert.Equal(HttpStatusCode.BadRequest, (await api.PostAsync("/api/site-projects", new { name = name.ToUpperInvariant() }, manager)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await api.PostAsync("/api/site-projects", new { name = "  " }, manager)).StatusCode);

        var renamed = await api.SendAsync(HttpMethod.Put, $"/api/site-projects/{id}", new { name = name + " II", isActive = false }, manager);
        Assert.Equal(HttpStatusCode.OK, renamed.StatusCode);
        var active = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/site-projects", manager));
        Assert.DoesNotContain(active.EnumerateArray(), p => p.GetProperty("id").GetInt32() == id);
        var all = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/site-projects?includeInactive=true", manager));
        Assert.Contains(all.EnumerateArray(), p => p.GetProperty("id").GetInt32() == id);
        Assert.Equal(HttpStatusCode.NotFound, (await api.SendAsync(HttpMethod.Put, "/api/site-projects/999999", new { name = "x", isActive = true }, manager)).StatusCode);
    }

    // --- delete, exports, audit --------------------------------------------------------------------------------

    [Fact]
    public async Task Delete_RemovesTheReport_AndItsFloors()
    {
        var (project, manager, supervisor) = await ProjectAsync();
        await SaveAsync(project, "2026-10-07", PrototypeFloors(), supervisor);

        Assert.Equal(HttpStatusCode.NoContent, (await api.SendAsync(HttpMethod.Delete, $"/api/site-progress/{project}/2026-10-07", null, manager)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await api.SendAsync(HttpMethod.Delete, $"/api/site-progress/{project}/2026-10-07", null, manager)).StatusCode);

        await using var db = TestUsers.NewContext(api.ConnectionString);
        Assert.False(await db.SiteProgressReports.AnyAsync(r => r.ProjectId == project));
    }

    [Fact]
    public async Task Csv_HasTheHeaderRows_AndNeutralisesFormulas()
    {
        var (project, _, supervisor) = await ProjectAsync();
        await SaveAsync(project, "2026-10-08", [Floor("=HYPERLINK(\"x\")", 3, 2, "InProgress", "Submitted", "say \"hi\"")], supervisor);

        var response = await api.GetAsync($"/api/site-progress/{project}/csv?date=2026-10-08", supervisor);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("text/csv", response.Content.Headers.ContentType!.MediaType);
        var text = await response.Content.ReadAsStringAsync();
        Assert.Contains("Floor,Aluminium Frames,Fixed Glass,Shutters,Alignment Status,Completion Status,WIR Status,Site Remarks", text);
        Assert.Contains("\"'=HYPERLINK(\"\"x\"\")\",3,2,0,\"Alignment Not Complete\",\"In Progress\",\"Inspection Submitted\",\"say \"\"hi\"\"\"", text);
    }

    [Fact]
    public async Task Pdf_IsAnA4Document_AndNeedsASavedReport()
    {
        var (project, _, supervisor) = await ProjectAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await api.GetAsync($"/api/site-progress/{project}/pdf?date=2026-10-09", supervisor)).StatusCode);
        await SaveAsync(project, "2026-10-09", PrototypeFloors(), supervisor);

        var response = await api.GetAsync($"/api/site-progress/{project}/pdf?date=2026-10-09", supervisor);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/pdf", response.Content.Headers.ContentType!.MediaType);
        var bytes = await response.Content.ReadAsByteArrayAsync();
        Assert.StartsWith("%PDF", System.Text.Encoding.ASCII.GetString(bytes, 0, 4));
        using var pdf = UglyToad.PdfPig.PdfDocument.Open(bytes);
        var text = string.Join(" ", pdf.GetPages().SelectMany(p => p.Letters).Select(l => l.Value));
        Assert.Contains("SITEPROGRESSREPORT", text.Replace(" ", ""));
    }

    [Fact]
    public async Task Pdf_RefusesTextTheFontCannotPrint_With422()
    {
        var (project, _, supervisor) = await ProjectAsync();
        await SaveAsync(project, "2026-10-10", [Floor("الطابق", 1, 1, "InProgress", "Pending")], supervisor);

        Assert.Equal((HttpStatusCode)422, (await api.GetAsync($"/api/site-progress/{project}/pdf?date=2026-10-10", supervisor)).StatusCode);
    }

    [Fact]
    public async Task Pdf_WithManyFloors_ContinuesOnLaterPages()
    {
        var (project, _, supervisor) = await ProjectAsync();
        var floors = Enumerable.Range(1, 60).Select(i => Floor($"Level {i}", i, i, "InProgress", "Pending", "Remark text for the floor")).ToArray();
        await SaveAsync(project, "2026-10-11", floors, supervisor);

        var bytes = await (await api.GetAsync($"/api/site-progress/{project}/pdf?date=2026-10-11", supervisor)).Content.ReadAsByteArrayAsync();

        using var pdf = UglyToad.PdfPig.PdfDocument.Open(bytes);
        Assert.True(pdf.NumberOfPages >= 2);
    }

    [Fact]
    public async Task Saving_AndDeleting_AreAudited_WithoutRemarksText()
    {
        var (project, manager, supervisor) = await ProjectAsync();
        await SaveAsync(project, "2026-10-12", [Floor("L1", 1, 1, "InProgress", "Pending", "secret remark")], supervisor);
        await api.SendAsync(HttpMethod.Delete, $"/api/site-progress/{project}/2026-10-12", null, manager);

        await using var db = TestUsers.NewContext(api.ConnectionString);
        var rows = await db.AuditLogs.Where(a => a.EntityId == $"{project}/2026-10-12").ToListAsync();
        Assert.Contains(rows, a => a.Action == "SiteProgressSaved");
        Assert.Contains(rows, a => a.Action == "SiteProgressDeleted");
        Assert.All(rows, a => Assert.DoesNotContain("secret remark", a.DetailsJson));
        Assert.Contains(await db.AuditLogs.Where(a => a.Action == "SiteProjectCreated").ToListAsync(), _ => true);
    }

    // --- role matrix --------------------------------------------------------------------------------------------

    public static TheoryData<string, string, HttpStatusCode> Matrix() => new()
    {
        // role, operation, expected
        { Roles.Supervisor, "read", HttpStatusCode.OK }, { Roles.HR, "read", HttpStatusCode.OK },
        { Roles.Manager, "read", HttpStatusCode.OK }, { Roles.Administrator, "read", HttpStatusCode.OK },
        { Roles.Supervisor, "save", HttpStatusCode.OK }, { Roles.HR, "save", HttpStatusCode.Forbidden },
        { Roles.Manager, "save", HttpStatusCode.OK }, { Roles.Administrator, "save", HttpStatusCode.OK },
        { Roles.Supervisor, "createProject", HttpStatusCode.Forbidden }, { Roles.HR, "createProject", HttpStatusCode.Forbidden },
        { Roles.Manager, "createProject", HttpStatusCode.Created }, { Roles.Administrator, "createProject", HttpStatusCode.Created },
        { Roles.Supervisor, "deleteReport", HttpStatusCode.Forbidden }, { Roles.HR, "deleteReport", HttpStatusCode.Forbidden },
        { Roles.Manager, "deleteReport", HttpStatusCode.NoContent }, { Roles.Administrator, "deleteReport", HttpStatusCode.NoContent },
        { Roles.HR, "csv", HttpStatusCode.OK }, { Roles.HR, "pdf", HttpStatusCode.OK }, { Roles.Supervisor, "pdf", HttpStatusCode.OK },
    };

    [Theory]
    [MemberData(nameof(Matrix))]
    public async Task RoleMatrix(string role, string operation, HttpStatusCode expected)
    {
        var (project, manager, _) = await ProjectAsync();
        await SaveAsync(project, "2026-10-13", [Floor("L1", 1, 1, "InProgress", "Pending")], manager);
        var (_, token) = await TestWorkers.SignInAsync(api, role);

        var response = operation switch
        {
            "read" => await api.GetAsync($"/api/site-progress/{project}?date=2026-10-13", token),
            "save" => await SaveAsync(project, "2026-10-14", [Floor("L1", 1, 1, "InProgress", "Pending")], token),
            "createProject" => await api.PostAsync("/api/site-projects", new { name = "P " + Guid.NewGuid().ToString("N")[..8] }, token),
            "deleteReport" => await api.SendAsync(HttpMethod.Delete, $"/api/site-progress/{project}/2026-10-13", null, token),
            "csv" => await api.GetAsync($"/api/site-progress/{project}/csv?date=2026-10-13", token),
            _ => await api.GetAsync($"/api/site-progress/{project}/pdf?date=2026-10-13", token),
        };

        Assert.Equal(expected, response.StatusCode);
    }

    [Theory]
    [InlineData("GET", "/api/site-projects")]
    [InlineData("POST", "/api/site-projects")]
    [InlineData("GET", "/api/site-progress/1?date=2026-10-01")]
    [InlineData("GET", "/api/site-progress/1/dates")]
    [InlineData("PUT", "/api/site-progress/1/2026-10-01")]
    [InlineData("DELETE", "/api/site-progress/1/2026-10-01")]
    [InlineData("GET", "/api/site-progress/1/pdf?date=2026-10-01")]
    [InlineData("GET", "/api/site-progress/1/csv?date=2026-10-01")]
    public async Task Anonymous_IsUnauthorized(string method, string path)
    {
        var response = await api.SendAsync(new HttpMethod(method), path, method is "POST" or "PUT" ? new { } : null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // --- database constraints ------------------------------------------------------------------------------------

    [Fact]
    public async Task Database_RejectsDuplicateReports_DuplicateFloors_NegativeCounts_AndBadStatuses()
    {
        var (project, _, _) = await ProjectAsync();
        await using var db = TestUsers.NewContext(api.ConnectionString);
        var report = new SiteProgressReport { ProjectId = project, ReportDate = new DateOnly(2026, 8, 1), UpdatedBy = "t", UpdatedUtc = DateTime.UtcNow };
        report.Floors.Add(new SiteProgressFloor { Floor = "L1" });
        db.SiteProgressReports.Add(report);
        await db.SaveChangesAsync();

        await using var dup = TestUsers.NewContext(api.ConnectionString);
        dup.SiteProgressReports.Add(new SiteProgressReport { ProjectId = project, ReportDate = new DateOnly(2026, 8, 1), UpdatedBy = "t", UpdatedUtc = DateTime.UtcNow });
        await Assert.ThrowsAsync<DbUpdateException>(() => dup.SaveChangesAsync());

        await using var floor = TestUsers.NewContext(api.ConnectionString);
        floor.SiteProgressFloors.Add(new SiteProgressFloor { ReportId = report.Id, Floor = "l1" });
        await Assert.ThrowsAsync<DbUpdateException>(() => floor.SaveChangesAsync());

        await using var negative = TestUsers.NewContext(api.ConnectionString);
        negative.SiteProgressFloors.Add(new SiteProgressFloor { ReportId = report.Id, Floor = "L2", Frames = -1 });
        await Assert.ThrowsAsync<DbUpdateException>(() => negative.SaveChangesAsync());

        await using var status = TestUsers.NewContext(api.ConnectionString);
        status.SiteProgressFloors.Add(new SiteProgressFloor { ReportId = report.Id, Floor = "L3", WirStatus = "Maybe" });
        await Assert.ThrowsAsync<DbUpdateException>(() => status.SaveChangesAsync());
    }

    [Fact]
    public async Task Database_ProjectWithReports_CannotBeDeleted()
    {
        var (project, _, supervisor) = await ProjectAsync();
        await SaveAsync(project, "2026-10-15", [Floor("L1", 1, 1, "InProgress", "Pending")], supervisor);
        await using var connection = new SqlConnection(api.ConnectionString);
        await connection.OpenAsync();
        await using var command = new SqlCommand($"DELETE FROM SiteProjects WHERE Id = {project}", connection);

        await Assert.ThrowsAsync<SqlException>(() => command.ExecuteNonQueryAsync());
    }

    // --- locking a floor ----------------------------------------------------------------------------------------

    private static object LockedFloor(string name, int frames, bool locked) =>
        new { floor = name, frames, glass = 0, shutters = 0, alignment = "NotComplete", completion = "InProgress", wirStatus = "Pending", remarks = "", isLocked = locked };

    [Fact]
    public async Task Manager_LocksAFloor_AndItIsReturnedLocked()
    {
        var (project, manager, _) = await ProjectAsync();
        var saved = await SaveLiveAsync(project, [LockedFloor("L01", 5, true), LockedFloor("L02", 3, false)], manager);
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var floors = (await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/site-progress/{project}", manager))).GetProperty("floors");
        Assert.True(floors[0].GetProperty("isLocked").GetBoolean());
        Assert.False(floors[1].GetProperty("isLocked").GetBoolean());
    }

    [Fact]
    public async Task Supervisor_CannotChangeRenameOrRemoveALockedFloor_ButCanEditTheOthers()
    {
        var (project, manager, supervisor) = await ProjectAsync();
        await SaveLiveAsync(project, [LockedFloor("L01", 5, true), LockedFloor("L02", 3, false)], manager);

        Assert.Equal(HttpStatusCode.Conflict, (await SaveLiveAsync(project, [LockedFloor("L01", 9, true), LockedFloor("L02", 3, false)], supervisor)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await SaveLiveAsync(project, [LockedFloor("L01 renamed", 5, true), LockedFloor("L02", 3, false)], supervisor)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await SaveLiveAsync(project, [LockedFloor("L02", 3, false)], supervisor)).StatusCode);

        var ok = await SaveLiveAsync(project, [LockedFloor("L01", 5, true), LockedFloor("L02", 8, false), LockedFloor("L03", 1, false)], supervisor);
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var floors = (await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/site-progress/{project}", supervisor))).GetProperty("floors");
        Assert.Equal(3, floors.GetArrayLength());
        Assert.Equal(8, floors[1].GetProperty("frames").GetInt32());
    }

    [Fact]
    public async Task Supervisor_CannotLockOrUnlock_TheFlagIsIgnored()
    {
        var (project, manager, supervisor) = await ProjectAsync();
        await SaveLiveAsync(project, [LockedFloor("L01", 5, true), LockedFloor("L02", 3, false)], manager);
        // The supervisor tries to unlock L01 and lock L02.
        await SaveLiveAsync(project, [LockedFloor("L01", 5, false), LockedFloor("L02", 3, true)], supervisor);
        var floors = (await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/site-progress/{project}", supervisor))).GetProperty("floors");
        Assert.True(floors[0].GetProperty("isLocked").GetBoolean());
        Assert.False(floors[1].GetProperty("isLocked").GetBoolean());
    }

    [Fact]
    public async Task Manager_CanUnlock_ThenTheSupervisorCanEdit()
    {
        var (project, manager, supervisor) = await ProjectAsync();
        await SaveLiveAsync(project, [LockedFloor("L01", 5, true)], manager);
        await SaveLiveAsync(project, [LockedFloor("L01", 5, false)], manager);
        Assert.Equal(HttpStatusCode.OK, (await SaveLiveAsync(project, [LockedFloor("L01", 9, false)], supervisor)).StatusCode);
    }

    [Fact]
    public async Task Manager_CanStillEditALockedFloor_AndAnOmittedFlagKeepsTheLock()
    {
        var (project, manager, _) = await ProjectAsync();
        await SaveLiveAsync(project, [LockedFloor("L01", 5, true)], manager);
        await SaveLiveAsync(project, [Floor("L01", 7, 0, "InProgress", "Pending")], manager);
        var floor = (await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/site-progress/{project}", manager))).GetProperty("floors")[0];
        Assert.Equal(7, floor.GetProperty("frames").GetInt32());
        Assert.True(floor.GetProperty("isLocked").GetBoolean());
    }

    [Fact]
    public async Task LockedFloors_CarryOverToANewDay_AndStillBindTheSupervisor()
    {
        var (project, manager, supervisor) = await ProjectAsync();
        await SaveAsync(project, "2026-10-01", [LockedFloor("L01", 5, true)], manager);
        Assert.Equal(HttpStatusCode.Conflict, (await SaveAsync(project, "2026-10-02", [LockedFloor("L01", 6, true)], supervisor)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await SaveAsync(project, "2026-10-02", [LockedFloor("L01", 5, true), LockedFloor("L02", 1, false)], supervisor)).StatusCode);
    }

    // --- the shared KPI rule -------------------------------------------------------------------------------------

    [Fact]
    public void Compute_SplitsWirIntoApprovedPendingAndRejected_AndWorksOutHandoverReady()
    {
        var kpis = SiteProgressService.Compute([
            new("A", 0, 0, 0, "NotComplete", "NotStarted", "Pending", ""), new("B", 1, 0, 2, "UnderProcess", "InProgress", "Submitted", ""),
            new("C", 2, 2, 0, "Complete", "Completed", "Approved", ""), new("D", 3, 3, 1, "Complete", "Completed", "ApprovedWithComments", ""),
            new("E", 4, 4, 0, "Complete", "InProgress", "Rejected", ""),
        ]);

        Assert.Equal(new SiteProgressKpis(10, 9, 3, 2, 1, 2, 2, 1, 1, 1, 3, 40), kpis);
    }

    [Fact]
    public void Compute_HandoverReadyIsZeroWithNoFloors() =>
        Assert.Equal(0, SiteProgressService.Compute([]).HandoverReadyPercent);
}
