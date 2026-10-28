using HrPayroll.Api.Dtos;

namespace HrPayroll.Api.Services;

public sealed record DailyPay(decimal BasicPay, decimal OvertimePay, decimal TotalPay, int DaysWorked);

/// <summary>Money is rounded independently for each daily component, before aggregation.</summary>
public static class PayrollCalculator
{
    /// <summary>A month is always paid as 30 days of 8 hours, so the hourly rate is the monthly salary / 240.</summary>
    public const decimal HoursPerMonth = 240m;
    public const int DaysPerMonth = 30;
    public const decimal ShiftHours = 8m;

    /// <summary>The exact (unrounded) rate behind a monthly salary; only displayed figures are rounded.</summary>
    public static decimal ExactHourlyFor(decimal monthlySalary) => monthlySalary / HoursPerMonth;

    public static decimal HourlyFor(decimal monthlySalary) => decimal.Round(ExactHourlyFor(monthlySalary), 2, MidpointRounding.AwayFromZero);

    /// <summary>
    /// A day's earnings. Sunday is a paid rest day for every worker: when the day is not otherwise paid it earns one standard shift.
    /// </summary>
    public static DailyPay DailyPay(string? status, decimal basicHours, decimal overtimeHours,
        decimal hourlyRate, decimal companyOvertimeRate, decimal? workerOvertimeRate = null, bool paidRestDay = false)
    {
        // Paid leave is worked at the standard shift with no overtime; an over-limit leave day is stored with 0 hours and earns nothing.
        var paidLeave = LeaveEntitlements.IsLeave(status) && basicHours > 0;
        if (status != "Present" && !paidLeave)
        {
            if (!paidRestDay) return new(0m, 0m, 0m, 0);
            var rest = decimal.Round(ShiftHours * hourlyRate, 2, MidpointRounding.AwayFromZero);
            return new(rest, 0m, rest, 0);
        }
        if (paidLeave) overtimeHours = 0;
        var basic = decimal.Round(basicHours * hourlyRate, 2, MidpointRounding.AwayFromZero);
        var overtime = decimal.Round(overtimeHours * (workerOvertimeRate ?? companyOvertimeRate), 2, MidpointRounding.AwayFromZero);
        return new(basic, overtime, basic + overtime, 1);
    }
    /// <summary>
    /// The fixed monthly salary less a day's share (salary / 30) for every day that is not paid: absent, unpaid leave, or not yet
    /// approved. Sundays are paid rest days and never deducted. A full month is the same salary whether it has 28, 30 or 31
    /// days. Days before the join date are unpaid, and days after <paramref name="lastCountedDay"/> are not deducted yet.
    /// </summary>
    public static (decimal Basic, decimal Deduction) MonthlyBasic(decimal monthlySalary, DateOnly monthStart, DateOnly? joinDate,
        DateOnly lastCountedDay, IReadOnlyDictionary<DateOnly, (string Status, decimal BasicHours)> approved)
    {
        var monthEnd = new DateOnly(monthStart.Year, monthStart.Month, DateTime.DaysInMonth(monthStart.Year, monthStart.Month));
        var first = joinDate is { } join && join > monthStart ? join : monthStart;
        if (first > monthEnd) return (0m, 0m);

        var unpaid = first.DayNumber - monthStart.DayNumber;
        for (var day = first; day <= monthEnd && day <= lastCountedDay; day = day.AddDays(1))
        {
            if (day.DayOfWeek == DayOfWeek.Sunday) continue;
            if (!approved.TryGetValue(day, out var record)
                || record.Status == "Absent"
                || (LeaveEntitlements.IsLeave(record.Status) && record.BasicHours <= 0)) unpaid++;
        }

        var deduction = Math.Min(monthlySalary, decimal.Round(monthlySalary * unpaid / DaysPerMonth, 2, MidpointRounding.AwayFromZero));
        return (monthlySalary - deduction, deduction);
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
