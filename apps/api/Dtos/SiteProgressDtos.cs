namespace HrPayroll.Api.Dtos;

public sealed record SiteProjectResponse(int Id, string Name, bool IsActive);

/// <summary>Members are nullable so a missing field reaches the validator and gets a field message.</summary>
public sealed record SiteProjectRequest(string? Name, bool? IsActive = null);

/// <summary>One floor of a report. Counts are nullable so a missing value is reported as a field error.</summary>
public sealed record SiteProgressFloorRequest(string? Floor, int? Frames, int? Glass, string? Completion, string? WirStatus, string? Remarks);

public sealed record SiteProgressSaveRequest(List<SiteProgressFloorRequest?>? Floors);

public sealed record SiteProgressFloorResponse(string Floor, int Frames, int Glass, string Completion, string WirStatus, string Remarks);

/// <summary>The five summary figures, always computed on the server.</summary>
public sealed record SiteProgressKpis(int TotalFrames, int TotalGlass, int CompletedFloors, int NoProgressFloors, int PendingWir);

/// <summary>
/// A report for one project and date. When none is saved yet, <c>Exists</c> is false and <c>Floors</c> is the most recent
/// earlier report's floors (<c>CopiedFromDate</c>) as a starting point; nothing is stored until the report is saved.
/// </summary>
public sealed record SiteProgressResponse(
    int ProjectId, string ProjectName, string Date, bool Exists, string? CopiedFromDate,
    string? UpdatedBy, DateTime? UpdatedUtc, IReadOnlyList<SiteProgressFloorResponse> Floors, SiteProgressKpis Kpis);
