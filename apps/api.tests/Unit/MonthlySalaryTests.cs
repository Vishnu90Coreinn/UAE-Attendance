using HrPayroll.Api.Services;

namespace HrPayroll.Api.Tests.Unit;

/// <summary>The client pays a fixed monthly salary on a 30-day basis, with Sunday as a paid day.</summary>
public class MonthlySalaryTests
{
    private static readonly IReadOnlyDictionary<DateOnly, (string Status, decimal BasicHours)> None = new Dictionary<DateOnly, (string, decimal)>();

    /// <summary>Every non-Sunday day of the month present for 8 hours.</summary>
    private static Dictionary<DateOnly, (string, decimal)> FullMonth(int year, int month, params DateOnly[] except)
    {
        var days = new Dictionary<DateOnly, (string, decimal)>();
        for (var d = new DateOnly(year, month, 1); d.Month == month; d = d.AddDays(1))
            if (d.DayOfWeek != DayOfWeek.Sunday && !except.Contains(d)) days[d] = ("Present", 8m);
        return days;
    }

    [Theory]
    [InlineData(1600, 6.67)]
    [InlineData(1700, 7.08)]
    [InlineData(1400, 5.83)]
    public void HourlyRate_IsTheSalaryOver240(decimal salary, decimal hourly) =>
        Assert.Equal(hourly, PayrollCalculator.HourlyFor(salary));

    [Theory]
    [InlineData(2026, 2)] // 28 days
    [InlineData(2024, 2)] // 29 days
    [InlineData(2026, 4)] // 30 days
    [InlineData(2026, 3)] // 31 days
    public void AFullMonth_PaysTheSameSalary_WhateverItsLength(int year, int month)
    {
        var (basic, deduction) = PayrollCalculator.MonthlyBasic(1600m, new(year, month, 1), null, new(year + 1, 1, 1), FullMonth(year, month));
        Assert.Equal(1600m, basic);
        Assert.Equal(0m, deduction);
    }

    [Fact]
    public void AnAbsentDay_CostsOneThirtiethOfTheSalary()
    {
        var absent = new DateOnly(2026, 3, 10);
        var days = FullMonth(2026, 3, absent);
        days[absent] = ("Absent", 0m);
        var (basic, deduction) = PayrollCalculator.MonthlyBasic(1600m, new(2026, 3, 1), null, new(2026, 4, 1), days);
        Assert.Equal(53.33m, deduction);
        Assert.Equal(1546.67m, basic);
    }

    [Fact]
    public void Sunday_IsPaidEvenWhenAbsentOrNotRecorded()
    {
        var sunday = new DateOnly(2026, 3, 8);
        var days = FullMonth(2026, 3);
        days[sunday] = ("Absent", 0m);
        Assert.Equal(1600m, PayrollCalculator.MonthlyBasic(1600m, new(2026, 3, 1), null, new(2026, 4, 1), days).Basic);
    }

    [Fact]
    public void UnpaidLeaveAndUnrecordedDays_AreDeducted_ButPaidLeaveIsNot()
    {
        var paid = new DateOnly(2026, 3, 10);
        var unpaid = new DateOnly(2026, 3, 11);
        var missing = new DateOnly(2026, 3, 12);
        var days = FullMonth(2026, 3, paid, unpaid, missing);
        days[paid] = ("Annual Leave", 8m);
        days[unpaid] = ("Annual Leave", 0m);
        var (_, deduction) = PayrollCalculator.MonthlyBasic(1600m, new(2026, 3, 1), null, new(2026, 4, 1), days);
        Assert.Equal(106.67m, deduction); // two days
    }

    [Fact]
    public void DaysThatHaveNotHappenedYet_AreNotDeducted()
    {
        // 2026-03-01 is a Sunday; with nothing recorded only Mon 2 and Tue 3 March have passed.
        var (basic, deduction) = PayrollCalculator.MonthlyBasic(1600m, new(2026, 3, 1), null, new(2026, 3, 3), None);
        Assert.Equal(106.67m, deduction);
        Assert.Equal(1493.33m, basic);
    }

    [Fact]
    public void AJoinerIsNotPaidForTheDaysBeforeTheyStarted()
    {
        // Joins on the 16th of a 30-day month: 15 days before are unpaid, the rest are present.
        var days = new Dictionary<DateOnly, (string, decimal)>();
        for (var d = new DateOnly(2026, 4, 16); d.Month == 4; d = d.AddDays(1))
            if (d.DayOfWeek != DayOfWeek.Sunday) days[d] = ("Present", 8m);
        var (basic, deduction) = PayrollCalculator.MonthlyBasic(1600m, new(2026, 4, 1), new DateOnly(2026, 4, 16), new(2026, 5, 1), days);
        Assert.Equal(800m, deduction);
        Assert.Equal(800m, basic);
    }

    [Fact]
    public void ARestDayEarnsOneShift_ForAnyStatus()
    {
        var rate = PayrollCalculator.ExactHourlyFor(1600m);
        Assert.Equal(53.33m, PayrollCalculator.DailyPay(null, 0, 0, rate, 3m, null, paidRestDay: true).TotalPay);
        Assert.Equal(53.33m, PayrollCalculator.DailyPay("Absent", 0, 0, rate, 3m, null, paidRestDay: true).TotalPay);
        Assert.Equal(0m, PayrollCalculator.DailyPay(null, 0, 0, rate, 3m).TotalPay);
    }
}
