namespace HrPayroll.Api.Data.Entities;

/// <summary>The company-wide payroll rules and print details. There is exactly one row (<c>Id = 1</c>), seeded by a migration.</summary>
public class PayrollSettings
{
    public const int SingletonId = 1;

    public int Id { get; set; }
    public string CompanyName { get; set; } = "";
    public string Tagline { get; set; } = "";
    public string ContactEmail { get; set; } = "";
    public decimal OvertimeRatePerHour { get; set; }
    public decimal MaxBasicHoursPerDay { get; set; }
    public string ShiftDescription { get; set; } = "";
    public string PreparedByLabel { get; set; } = "";
    public string ApprovedByLabel { get; set; } = "";
}
