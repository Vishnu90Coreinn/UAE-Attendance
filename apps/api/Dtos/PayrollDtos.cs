namespace HrPayroll.Api.Dtos;

public sealed record PayrollCompany(string CompanyName, string Tagline, string ContactEmail, string PreparedByLabel, string ApprovedByLabel);
/// <summary>TotalPay is gross (basic + overtime). NetPay = TotalPay - TotalDeductions.</summary>
public sealed record PayrollTotals(int DaysWorked, decimal BasicHours, decimal OvertimeHours, decimal BasicPay, decimal OvertimePay, decimal TotalPay,
    decimal TotalDeductions = 0, decimal NetPay = 0);
public sealed record PayrollDeductionItem(string Name, decimal Amount, string Note);
public sealed record PayrollLine(int WorkerId, string WorkerCode, string WorkerName, string Designation,
    decimal HourlyRate, decimal OvertimeRate, int DaysWorked, decimal BasicHours, decimal OvertimeHours,
    decimal BasicPay, decimal OvertimePay, decimal TotalPay, decimal TotalDeductions = 0, decimal NetPay = 0,
    IReadOnlyList<PayrollDeductionItem>? Deductions = null);
public sealed record PayrollResponse(string Period, string Status, PayrollCompany Company,
    IReadOnlyList<PayrollLine> Lines, PayrollTotals Totals, string Revision, string? FinalisedBy = null, DateTime? FinalisedUtc = null, int PendingApprovalCount = 0);
