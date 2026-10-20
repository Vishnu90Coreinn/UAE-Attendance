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
}
