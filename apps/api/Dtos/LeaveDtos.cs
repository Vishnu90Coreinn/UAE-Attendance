namespace HrPayroll.Api.Dtos;

public sealed record CreateLeaveRequest(int? WorkerId, string? LeaveType, string? StartDate, string? EndDate);
public sealed record LeaveResponse(int Id, int WorkerId, string WorkerCode, string WorkerName, bool WorkerIsActive,
    string LeaveType, string StartDate, string EndDate, int Days, string Status, string CreatedBy, DateTime CreatedUtc,
    string? DecidedBy, DateTime? DecidedUtc);

/// <summary>One leave type for one worker in their current allowance year. Used counts only paid days.</summary>
public sealed record LeaveTypeBalance(string LeaveType, int Allowance, int Used, int Remaining, bool Available,
    string? EligibleFrom, string? PeriodStart, string? PeriodEnd);
public sealed record WorkerLeaveBalance(int WorkerId, string WorkerCode, string WorkerName, string? JoinDate,
    IReadOnlyList<LeaveTypeBalance> Balances);
