namespace HrPayroll.Api.Dtos;

public sealed record CreateLeaveRequest(int? WorkerId, string? LeaveType, string? StartDate, string? EndDate);
public sealed record LeaveResponse(int Id, int WorkerId, string WorkerCode, string WorkerName, bool WorkerIsActive,
    string LeaveType, string StartDate, string EndDate, int Days, string Status, string CreatedBy, DateTime CreatedUtc,
    string? DecidedBy, DateTime? DecidedUtc);
