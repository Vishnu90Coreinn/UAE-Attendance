namespace HrPayroll.Api.Data.Entities;

public sealed class LeaveRequest
{
    public int Id { get; set; }
    public int WorkerId { get; set; }
    public Worker Worker { get; set; } = null!;
    public string LeaveType { get; set; } = "";
    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }
    public int Days { get; private set; }
    public string Status { get; set; } = "Pending";
    public string CreatedBy { get; set; } = "";
    public DateTime CreatedUtc { get; set; }
    public string? DecidedBy { get; set; }
    public DateTime? DecidedUtc { get; set; }
}
