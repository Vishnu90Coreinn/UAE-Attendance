namespace HrPayroll.Api.Data.Entities;

public class Worker
{
    public int Id { get; set; }
    public string WorkerCode { get; set; } = "";
    public string FullName { get; set; } = "";
    public string Designation { get; set; } = "";
    public decimal HourlyRate { get; set; }

    /// <summary>The worker's own overtime rate per hour; null means "use the company rate" (<c>PayrollSettings.OvertimeRatePerHour</c>). 0 means no overtime pay.</summary>
    public decimal? OvertimeRate { get; set; }

    public bool IsActive { get; set; } = true;
    public DateOnly? JoinDate { get; set; }
    public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedUtc { get; set; } = DateTime.UtcNow;
}
