namespace HrPayroll.Api.Data.Entities;

public sealed class PayrollPeriod
{
    public int Id { get; set; }
    public int Year { get; set; }
    public int Month { get; set; }
    public decimal OvertimeRateApplied { get; set; }
    public DateTime FinalisedUtc { get; set; }
    public string FinalisedBy { get; set; } = "";
    public string CompanyName { get; set; } = "";
    public string Tagline { get; set; } = "";
    public string ContactEmail { get; set; } = "";
    public string PreparedByLabel { get; set; } = "";
    public string ApprovedByLabel { get; set; } = "";
    public List<PayrollDetail> Details { get; set; } = [];
}

public sealed class PayrollDetail
{
    public int Id { get; set; }
    public int PeriodId { get; set; }
    public PayrollPeriod Period { get; set; } = null!;
    public int WorkerId { get; set; }
    public string WorkerCode { get; set; } = "";
    public string WorkerName { get; set; } = "";
    public string Designation { get; set; } = "";
    public decimal HourlyRate { get; set; }
    public decimal OvertimeRate { get; set; }
    public int DaysWorked { get; set; }
    public decimal BasicHours { get; set; }
    public decimal OvertimeHours { get; set; }
    public decimal BasicPay { get; set; }
    public decimal OvertimePay { get; set; }
    public decimal TotalPay { get; set; }
}
