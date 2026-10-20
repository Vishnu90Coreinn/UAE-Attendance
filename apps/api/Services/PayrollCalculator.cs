namespace HrPayroll.Api.Services;

public sealed record DailyPay(decimal BasicPay, decimal OvertimePay, decimal TotalPay, int DaysWorked);

/// <summary>Money is rounded independently for each daily component, before aggregation.</summary>
public static class PayrollCalculator
{
    public static DailyPay DailyPay(string? status, decimal basicHours, decimal overtimeHours,
        decimal hourlyRate, decimal companyOvertimeRate, decimal? workerOvertimeRate = null)
    {
        if (status != "Present") return new(0m, 0m, 0m, 0);
        var basic = decimal.Round(basicHours * hourlyRate, 2, MidpointRounding.AwayFromZero);
        var overtime = decimal.Round(overtimeHours * (workerOvertimeRate ?? companyOvertimeRate), 2, MidpointRounding.AwayFromZero);
        return new(basic, overtime, basic + overtime, 1);
    }
}
