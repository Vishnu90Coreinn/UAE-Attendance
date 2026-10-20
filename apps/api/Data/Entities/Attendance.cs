namespace HrPayroll.Api.Data.Entities;

public sealed class Attendance
{
    public int Id { get; set; }
    public int WorkerId { get; set; }
    public Worker Worker { get; set; } = null!;
    public DateOnly WorkDate { get; set; }
    public string Status { get; set; } = "Present";
    public decimal BasicHours { get; set; }
    public decimal OvertimeHours { get; set; }
    public DateTime UpdatedUtc { get; set; }
    public string UpdatedBy { get; set; } = "";
    public string ApprovalStatus { get; set; } = ApprovalStatuses.Approved;
    public string? RejectionReason { get; set; }
    public string? DecidedBy { get; set; }
    public DateTime? DecidedUtc { get; set; }
}

/// <summary>Where an attendance entry is in the supervisor-to-manager approval flow. Only Approved entries reach payroll.</summary>
public static class ApprovalStatuses
{
    public const string Submitted = "Submitted";
    public const string Approved = "Approved";
    public const string Rejected = "Rejected";
}
