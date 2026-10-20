namespace HrPayroll.Api.Data.Entities;

public class Worker
{
    public int Id { get; set; }
    public string WorkerCode { get; set; } = "";
    public string FullName { get; set; } = "";
    public string Designation { get; set; } = "";
    public decimal HourlyRate { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedUtc { get; set; } = DateTime.UtcNow;
}
