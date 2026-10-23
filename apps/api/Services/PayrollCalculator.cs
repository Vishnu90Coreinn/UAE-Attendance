using HrPayroll.Api.Dtos;

namespace HrPayroll.Api.Services;

public sealed record DailyPay(decimal BasicPay, decimal OvertimePay, decimal TotalPay, int DaysWorked);

/// <summary>Money is rounded independently for each daily component, before aggregation.</summary>
public static class PayrollCalculator
{
    public static DailyPay DailyPay(string? status, decimal basicHours, decimal overtimeHours,
        decimal hourlyRate, decimal companyOvertimeRate, decimal? workerOvertimeRate = null)
    {
        // Paid leave is worked at the standard shift with no overtime; an over-limit leave day is stored with 0 hours and earns nothing.
        var paidLeave = LeaveEntitlements.IsLeave(status) && basicHours > 0;
        if (status != "Present" && !paidLeave) return new(0m, 0m, 0m, 0);
        if (paidLeave) overtimeHours = 0;
        var basic = decimal.Round(basicHours * hourlyRate, 2, MidpointRounding.AwayFromZero);
        var overtime = decimal.Round(overtimeHours * (workerOvertimeRate ?? companyOvertimeRate), 2, MidpointRounding.AwayFromZero);
        return new(basic, overtime, basic + overtime, 1);
    }
    public static PayrollTotals MonthSummary(IEnumerable<DailyPay> dailyPay,
        IEnumerable<(decimal BasicHours, decimal OvertimeHours)> presentHours)
    {
        var days = dailyPay.ToArray();
        var hours = presentHours.ToArray();
        return new(days.Sum(d => d.DaysWorked), hours.Sum(h => h.BasicHours), hours.Sum(h => h.OvertimeHours),
            days.Sum(d => d.BasicPay), days.Sum(d => d.OvertimePay), days.Sum(d => d.TotalPay));
    }

    public static PayrollTotals GrandTotals(IEnumerable<PayrollLine> lines)
    {
        var rows = lines.ToArray();
        return new(rows.Sum(r => r.DaysWorked), rows.Sum(r => r.BasicHours), rows.Sum(r => r.OvertimeHours),
            rows.Sum(r => r.BasicPay), rows.Sum(r => r.OvertimePay), rows.Sum(r => r.TotalPay),
            rows.Sum(r => r.TotalDeductions), rows.Sum(r => r.NetPay));
    }
}
