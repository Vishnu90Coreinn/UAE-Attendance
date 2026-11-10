using System.Globalization;
using System.Text;
using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;
using CompletionValues = HrPayroll.Api.Data.Entities.Completion;

namespace HrPayroll.Api.Services;

public sealed record SiteProgressResult(int StatusCode, object? Body = null, Dictionary<string, string[]>? Errors = null, string? Message = null);

/// <summary>
/// Daily site progress: aluminium frames, fixed glass and shutters per floor, with each floor's alignment, completion and Work
/// Inspection Request (WIR) status. A project has at most one report per date; a report is saved as a whole.
/// </summary>
public sealed class SiteProgressService(AppDbContext db, IAuditLogger audit, TimeProvider time, IHttpContextAccessor httpContext)
{
    public const int MaxNameLength = 120;
    public const int MaxFloorLength = 60;
    public const int MaxRemarksLength = 500;
    public const int MaxCount = 1_000_000;
    private static readonly TimeZoneInfo CompanyTimeZone = TimeZoneInfo.FindSystemTimeZoneById("Asia/Dubai");

    // --- projects -----------------------------------------------------------------------------------------------

    public async Task<IReadOnlyList<SiteProjectResponse>> ListProjectsAsync(bool includeInactive, CancellationToken ct) =>
        await db.SiteProjects.AsNoTracking().Where(p => includeInactive || p.IsActive).OrderBy(p => p.Name)
            .Select(p => new SiteProjectResponse(p.Id, p.Name, p.IsActive)).ToListAsync(ct);

    public async Task<SiteProgressResult> CreateProjectAsync(SiteProjectRequest request, CancellationToken ct)
    {
        var name = Clean(request.Name);
        var errors = ValidateName(name);
        if (errors.Count > 0) return new(400, Errors: errors);
        if (await db.SiteProjects.AnyAsync(p => p.Name == name, ct)) return DuplicateName();
        var project = new SiteProject { Name = name, IsActive = true };
        db.SiteProjects.Add(project);
        audit.Write("SiteProjectCreated", entityType: nameof(SiteProject), entityId: "new", details: new { name });
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException) { return DuplicateName(); }
        return new(201, new SiteProjectResponse(project.Id, project.Name, project.IsActive));
    }

    public async Task<SiteProgressResult> UpdateProjectAsync(int id, SiteProjectRequest request, CancellationToken ct)
    {
        var project = await db.SiteProjects.SingleOrDefaultAsync(p => p.Id == id, ct);
        if (project is null) return new(404);
        var name = Clean(request.Name);
        var errors = ValidateName(name);
        if (request.IsActive is null) errors["isActive"] = ["Say whether the project is active."];
        if (errors.Count > 0) return new(400, Errors: errors);
        if (await db.SiteProjects.AnyAsync(p => p.Id != id && p.Name == name, ct)) return DuplicateName();
        var changes = new Dictionary<string, FieldChange>();
        if (project.Name != name) { changes["name"] = new FieldChange(project.Name, name); project.Name = name; }
        if (project.IsActive != request.IsActive!.Value) { changes["isActive"] = new FieldChange(project.IsActive, request.IsActive.Value); project.IsActive = request.IsActive.Value; }
        if (changes.Count > 0)
        {
            audit.Write("SiteProjectUpdated", entityType: nameof(SiteProject), entityId: id.ToString(CultureInfo.InvariantCulture), details: changes);
            try { await db.SaveChangesAsync(ct); }
            catch (DbUpdateException) { return DuplicateName(); }
        }
        return new(200, new SiteProjectResponse(project.Id, project.Name, project.IsActive));
    }

    // --- reports ------------------------------------------------------------------------------------------------

    /// <summary>Dates that have a saved report for the project, newest first.</summary>
    public async Task<SiteProgressResult> DatesAsync(int projectId, CancellationToken ct)
    {
        if (!await db.SiteProjects.AnyAsync(p => p.Id == projectId, ct)) return new(404);
        var dates = await db.SiteProgressReports.AsNoTracking().Where(r => r.ProjectId == projectId)
            .OrderByDescending(r => r.ReportDate).Select(r => r.ReportDate).ToListAsync(ct);
        return new(200, dates.Select(Label).ToArray());
    }

    /// <summary>
    /// The report for a date, or, when no date is given, the live report: the most recent one saved (empty when the
    /// project has none yet). Each day's last save is kept as that day's snapshot, so earlier dates stay readable.
    /// </summary>
    public async Task<SiteProgressResult> GetAsync(int projectId, string? dateText, CancellationToken ct)
    {
        var project = await db.SiteProjects.AsNoTracking().SingleOrDefaultAsync(p => p.Id == projectId, ct);
        if (string.IsNullOrWhiteSpace(dateText))
        {
            if (project is null) return new(404);
            var latest = await db.SiteProgressReports.AsNoTracking().Where(r => r.ProjectId == projectId)
                .OrderByDescending(r => r.ReportDate).Select(r => (DateOnly?)r.ReportDate).FirstOrDefaultAsync(ct);
            return new(200, await BuildAsync(project, latest ?? Today(), ct));
        }
        if (!TryDate(dateText, out var date, out var dateErrors)) return new(400, Errors: dateErrors);
        if (project is null) return new(404);
        return new(200, await BuildAsync(project, date, ct));
    }

    /// <summary>Saves the floors for a date; with no date, for today (Dubai), which is how the live report is updated.</summary>
    public async Task<SiteProgressResult> SaveAsync(int projectId, string? dateText, SiteProgressSaveRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(dateText)) dateText = Label(Today());
        if (!TryDate(dateText, out var date, out var errors)) return new(400, Errors: errors);
        var floors = request.Floors ?? [];
        errors = ValidateFloors(floors);
        if (errors.Count > 0) return new(400, Errors: errors);
        var project = await db.SiteProjects.SingleOrDefaultAsync(p => p.Id == projectId, ct);
        if (project is null) return new(404);
        var now = time.GetUtcNow().UtcDateTime;
        var actor = httpContext.HttpContext?.User.Identity?.Name ?? "";

        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        try
        {
            var report = await db.SiteProgressReports.Include(r => r.Floors)
                .SingleOrDefaultAsync(r => r.ProjectId == projectId && r.ReportDate == date, ct);
            if (report is null)
            {
                if (!project.IsActive) return new(409, Message: "This project is inactive. Reactivate it to add reports.");
                report = new SiteProgressReport { ProjectId = projectId, ReportDate = date };
                db.SiteProgressReports.Add(report);
            }
            else
            {
                // Replace the floors in two steps so a renamed floor never collides with the unique (report, floor) index.
                db.SiteProgressFloors.RemoveRange(report.Floors);
                await db.SaveChangesAsync(ct);
                report.Floors.Clear();
            }

            report.UpdatedBy = actor;
            report.UpdatedUtc = now;
            var order = 0;
            foreach (var f in floors.Cast<SiteProgressFloorRequest>())
            {
                report.Floors.Add(new SiteProgressFloor
                {
                    SortOrder = order++, Floor = Clean(f.Floor), Frames = f.Frames!.Value, Glass = f.Glass!.Value,
                    Shutters = f.Shutters!.Value, Alignment = f.Alignment!, Completion = f.Completion!, WirStatus = f.WirStatus!, Remarks = Clean(f.Remarks),
                });
            }
            audit.Write("SiteProgressSaved", entityType: nameof(SiteProgressReport), entityId: $"{projectId}/{Label(date)}",
                details: new { project = project.Name, date = Label(date), floors = floors.Count });
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        }
        catch (DbUpdateException)
        {
            return new(409, Message: "The report changed while you were saving. Reload and try again.");
        }
        return new(200, await BuildAsync(project, date, ct));
    }

    public async Task<SiteProgressResult> DeleteAsync(int projectId, string? dateText, CancellationToken ct)
    {
        if (!TryDate(dateText, out var date, out var errors)) return new(400, Errors: errors);
        var report = await db.SiteProgressReports.Include(r => r.Project).Include(r => r.Floors)
            .SingleOrDefaultAsync(r => r.ProjectId == projectId && r.ReportDate == date, ct);
        if (report is null) return new(404);
        audit.Write("SiteProgressDeleted", entityType: nameof(SiteProgressReport), entityId: $"{projectId}/{Label(date)}",
            details: new { project = report.Project.Name, date = Label(date), floors = report.Floors.Count });
        db.SiteProgressReports.Remove(report);
        await db.SaveChangesAsync(ct);
        return new(204);
    }

    /// <summary>The report as comma-separated text (UTF-8 with a byte-order mark so Excel opens it correctly).</summary>
    public async Task<SiteProgressResult> CsvAsync(int projectId, string? dateText, CancellationToken ct)
    {
        var result = await GetAsync(projectId, dateText, ct);
        if (result.StatusCode != 200) return result;
        var report = (SiteProgressResponse)result.Body!;
        if (!report.Exists) return new(404, Message: "There is no saved report for this date.");
        var csv = new StringBuilder();
        csv.Append("Floor,Aluminium Frames,Fixed Glass,Shutters,Alignment Status,Completion Status,WIR Status,Site Remarks\r\n");
        foreach (var f in report.Floors)
            csv.Append(Csv(f.Floor)).Append(',').Append(f.Frames).Append(',').Append(f.Glass).Append(',').Append(f.Shutters).Append(',')
                .Append(Csv(AlignmentLabel(f.Alignment))).Append(',').Append(Csv(CompletionLabel(f.Completion))).Append(',').Append(Csv(WirLabel(f.WirStatus))).Append(',').Append(Csv(f.Remarks)).Append("\r\n");
        var bytes = Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(csv.ToString())).ToArray();
        return new(200, new SiteProgressFile(bytes, $"SiteProgress_{FileStem(report.ProjectName)}_{report.Date}.csv", "text/csv"));
    }

    public async Task<SiteProgressResult> PdfAsync(int projectId, string? dateText, SiteProgressPdf pdf, CancellationToken ct)
    {
        var result = await GetAsync(projectId, dateText, ct);
        if (result.StatusCode != 200) return result;
        var report = (SiteProgressResponse)result.Body!;
        if (!report.Exists) return new(404, Message: "There is no saved report for this date.");
        var s = await db.PayrollSettings.AsNoTracking().SingleAsync(x => x.Id == PayrollSettings.SingletonId, ct);
        var company = new PayrollCompany(s.CompanyName, s.Tagline, s.ContactEmail, s.PreparedByLabel, s.ApprovedByLabel);
        var bytes = pdf.Generate(report, company);
        return new(200, new SiteProgressFile(bytes, $"SiteProgress_{FileStem(report.ProjectName)}_{report.Date}.pdf", AttendanceExportService.PdfType));
    }

    // --- helpers ------------------------------------------------------------------------------------------------

    private async Task<SiteProgressResponse> BuildAsync(SiteProject project, DateOnly date, CancellationToken ct)
    {
        var report = await db.SiteProgressReports.AsNoTracking().Include(r => r.Floors)
            .SingleOrDefaultAsync(r => r.ProjectId == project.Id && r.ReportDate == date, ct);
        string? copiedFrom = null;
        if (report is null)
        {
            report = await db.SiteProgressReports.AsNoTracking().Include(r => r.Floors)
                .Where(r => r.ProjectId == project.Id && r.ReportDate < date).OrderByDescending(r => r.ReportDate).FirstOrDefaultAsync(ct);
            if (report is not null) copiedFrom = Label(report.ReportDate);
            var starting = (report?.Floors ?? []).OrderBy(f => f.SortOrder).Select(ToResponse).ToList();
            return new(project.Id, project.Name, Label(date), false, copiedFrom, null, null, starting, Compute(starting));
        }
        var floors = report.Floors.OrderBy(f => f.SortOrder).Select(ToResponse).ToList();
        return new(project.Id, project.Name, Label(date), true, null, report.UpdatedBy, DateTime.SpecifyKind(report.UpdatedUtc, DateTimeKind.Utc), floors, Compute(floors));
    }

    private static SiteProgressFloorResponse ToResponse(SiteProgressFloor f) => new(f.Floor, f.Frames, f.Glass, f.Shutters, f.Alignment, f.Completion, f.WirStatus, f.Remarks);

    /// <summary>
    /// Approved WIR is Approved or Approved with Comments; Rejected stands alone; every other status is still pending.
    /// A floor is handover ready when it is Completed and its WIR is approved.
    /// </summary>
    public static SiteProgressKpis Compute(IEnumerable<SiteProgressFloorResponse> floors)
    {
        int frames = 0, glass = 0, shutters = 0, completed = 0, none = 0, pending = 0, approved = 0, rejected = 0;
        int alignNot = 0, alignUnder = 0, alignDone = 0, ready = 0, total = 0;
        foreach (var f in floors)
        {
            total++;
            frames += f.Frames;
            glass += f.Glass;
            shutters += f.Shutters;
            if (f.Completion == CompletionValues.Completed) completed++;
            if (f.Frames == 0 && f.Glass == 0 && f.Shutters == 0) none++;
            var isApproved = f.WirStatus is WirStatuses.Approved or WirStatuses.ApprovedWithComments;
            if (isApproved) approved++;
            else if (f.WirStatus == WirStatuses.Rejected) rejected++;
            else pending++;
            if (isApproved && f.Completion == CompletionValues.Completed) ready++;
            switch (f.Alignment)
            {
                case AlignmentStatuses.Complete: alignDone++; break;
                case AlignmentStatuses.UnderProcess: alignUnder++; break;
                default: alignNot++; break;
            }
        }
        var percent = total == 0 ? 0 : (int)Math.Round(ready * 100m / total, 0, MidpointRounding.AwayFromZero);
        return new(frames, glass, shutters, completed, none, pending, approved, rejected, alignNot, alignUnder, alignDone, percent);
    }

    private static Dictionary<string, string[]> ValidateFloors(List<SiteProgressFloorRequest?> floors)
    {
        var errors = new Dictionary<string, string[]>();
        if (floors.Count == 0) errors["floors"] = ["Add at least one floor."];
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < floors.Count; i++)
        {
            var f = floors[i];
            var p = $"floors[{i}]";
            if (f is null) { errors[p] = ["Floor details are missing."]; continue; }
            var name = Clean(f.Floor);
            if (name.Length == 0) errors[$"{p}.floor"] = ["Enter the floor name."];
            else if (name.Length > MaxFloorLength) errors[$"{p}.floor"] = [$"Floor name must be {MaxFloorLength} characters or fewer."];
            else if (!seen.Add(name)) errors[$"{p}.floor"] = [$"The floor \"{name}\" appears more than once."];
            if (f.Frames is null or < 0 or > MaxCount) errors[$"{p}.frames"] = ["Enter the frames installed as a whole number of 0 or more."];
            if (f.Glass is null or < 0 or > MaxCount) errors[$"{p}.glass"] = ["Enter the fixed glass installed as a whole number of 0 or more."];
            if (f.Shutters is null or < 0 or > MaxCount) errors[$"{p}.shutters"] = ["Enter the shutters finished as a whole number of 0 or more."];
            if (f.Alignment is null || !AlignmentStatuses.All.Contains(f.Alignment)) errors[$"{p}.alignment"] = ["Choose an alignment status."];
            if (f.Completion is null || !CompletionValues.All.Contains(f.Completion)) errors[$"{p}.completion"] = ["Choose a completion status."];
            if (f.WirStatus is null || !WirStatuses.All.Contains(f.WirStatus)) errors[$"{p}.wirStatus"] = ["Choose a WIR status."];
            if (Clean(f.Remarks).Length > MaxRemarksLength) errors[$"{p}.remarks"] = [$"Remarks must be {MaxRemarksLength} characters or fewer."];
        }
        return errors;
    }

    private DateOnly Today() => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(time.GetUtcNow(), CompanyTimeZone).DateTime);

    /// <summary>Parses yyyy-MM-dd and refuses future dates (Dubai time).</summary>
    private bool TryDate(string? text, out DateOnly date, out Dictionary<string, string[]> errors)
    {
        errors = [];
        if (!DateOnly.TryParseExact(text, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out date))
        {
            errors["date"] = ["Choose a date in YYYY-MM-DD format."];
            return false;
        }
        if (date > Today())
        {
            errors["date"] = ["The report date cannot be in the future."];
            return false;
        }
        return true;
    }

    public static string Label(DateOnly d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    private static string Clean(string? value) => (value ?? "").Trim();
    private static string FileStem(string name) => System.Text.RegularExpressions.Regex.Replace(name.Trim(), "[^A-Za-z0-9-]+", "_").Trim('_');

    private static string Csv(string value)
    {
        // A leading = + - @ would be run as a formula by spreadsheets, so it is neutralised.
        if (value.Length > 0 && "=+-@\t\r".Contains(value[0])) value = "'" + value;
        return "\"" + value.Replace("\"", "\"\"") + "\"";
    }

    public static string CompletionLabel(string value) => value switch
    {
        CompletionValues.Completed => "Completed",
        CompletionValues.InProgress => "In Progress",
        _ => "Not Started",
    };

    public static string WirLabel(string value) => value switch
    {
        WirStatuses.Approved => "Approved",
        WirStatuses.ApprovedWithComments => "Approved with Comments",
        WirStatuses.Submitted => "Inspection Submitted",
        WirStatuses.Rejected => "Rejected",
        WirStatuses.AlignmentNotComplete => "WIR: Alignment Not Complete",
        WirStatuses.AlignmentUnderProcess => "WIR: Alignment Under Process",
        WirStatuses.AlignmentComplete => "WIR: Alignment Complete",
        _ => "Not Submitted",
    };

    public static string AlignmentLabel(string value) => value switch
    {
        AlignmentStatuses.Complete => "Alignment Complete",
        AlignmentStatuses.UnderProcess => "Alignment Under Process",
        _ => "Alignment Not Complete",
    };

    private static Dictionary<string, string[]> ValidateName(string name)
    {
        var errors = new Dictionary<string, string[]>();
        if (name.Length == 0) errors["name"] = ["Enter the project name."];
        else if (name.Length > MaxNameLength) errors["name"] = [$"Project name must be {MaxNameLength} characters or fewer."];
        return errors;
    }

    private static SiteProgressResult DuplicateName() => new(400, Errors: new() { ["name"] = ["A project with this name already exists."] });
}

public sealed record SiteProgressFile(byte[] Bytes, string FileName, string ContentType);
