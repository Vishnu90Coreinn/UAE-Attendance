namespace HrPayroll.Api.Dtos;

public sealed record SiteProjectResponse(int Id, string Name, bool IsActive);

/// <summary>Members are nullable so a missing field reaches the validator and gets a field message.</summary>
public sealed record SiteProjectRequest(string? Name, bool? IsActive = null);

/// <summary>One floor of a report. Counts are nullable so a missing value is reported as a field error.</summary>
public sealed record SiteProgressFloorRequest(string? Floor, int? Frames, int? Glass, int? Shutters, string? Alignment, string? Completion, string? WirStatus, string? Remarks, bool? IsLocked = null);

public sealed record SiteProgressSaveRequest(List<SiteProgressFloorRequest?>? Floors);

public sealed record SiteProgressFloorResponse(string Floor, int Frames, int Glass, int Shutters, string Alignment, string Completion, string WirStatus, string Remarks, bool IsLocked = false);

/// <summary>
/// The summary figures, always computed on the server. <c>HandoverReadyPercent</c> is the share of floors that are
/// completed and whose WIR the consultant has approved (with or without comments), rounded to a whole percent.
/// </summary>
public sealed record SiteProgressKpis(
    int TotalFrames, int TotalGlass, int TotalShutters, int CompletedFloors, int NoProgressFloors,
    int PendingWir, int ApprovedWir, int RejectedWir,
    int AlignmentNotComplete, int AlignmentUnderProcess, int AlignmentComplete, int HandoverReadyPercent);

/// <summary>
/// A report for one project and date. When none is saved yet, <c>Exists</c> is false and <c>Floors</c> is the most recent
/// earlier report's floors (<c>CopiedFromDate</c>) as a starting point; nothing is stored until the report is saved.
/// </summary>
public sealed record SiteProgressResponse(
    int ProjectId, string ProjectName, string Date, bool Exists, string? CopiedFromDate,
    string? UpdatedBy, DateTime? UpdatedUtc, IReadOnlyList<SiteProgressFloorResponse> Floors, SiteProgressKpis Kpis);
