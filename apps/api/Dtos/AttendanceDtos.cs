using System.Text.Json.Serialization;
using HrPayroll.Api.Services;

namespace HrPayroll.Api.Dtos;

public sealed class AttendanceRequest
{
    public int WorkerId { get; init; }
    // Explicit null means remove this record atomically with the rest of the batch.
    [JsonRequired]
    public string? Status { get; init; }
    public decimal? BasicHours { get; init; }
    public decimal? OvertimeHours { get; init; }
}

public sealed record AttendanceRecordResponse(string Status, decimal BasicHours, decimal OvertimeHours,
    string ApprovalStatus, string? RejectionReason);
/// <summary><paramref name="ApprovedLeave"/> is the leave type when an approved leave request covers this day; such rows are locked.</summary>
public sealed record AttendanceRowResponse(WorkerResponse Worker, AttendanceRecordResponse? Record, DailyPay? DailyPay, string? ApprovedLeave = null);
public sealed record AttendanceDayResponse(DateOnly Date, bool IsFinalised, List<AttendanceRowResponse> Rows, int PendingCount = 0);

public sealed class ApproveAttendanceRequest
{
    /// <summary>Omit or leave empty to approve every submitted entry for the date.</summary>
    public List<int>? WorkerIds { get; init; }
}

public sealed class RejectAttendanceRequest
{
    public List<int>? WorkerIds { get; init; }
    public string? Reason { get; init; }
}

public sealed record AttendanceDayCount(DateOnly Date, int Count);
public sealed record AttendanceSummaryResponse(int SubmittedTotal, List<AttendanceDayCount> Submitted,
    int RejectedTotal, List<AttendanceDayCount> Rejected);
