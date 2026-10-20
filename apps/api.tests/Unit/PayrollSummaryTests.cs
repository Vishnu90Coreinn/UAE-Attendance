using HrPayroll.Api.Services;

namespace HrPayroll.Api.Tests.Unit;

public class PayrollSummaryTests
{
    [Fact]
    public void MonthSummary_SumsDailyRoundingAndPresentHours()
    {
        var days = Enumerable.Repeat(PayrollCalculator.DailyPay("Present", .01m, .01m, .50m, .50m), 3).ToArray();
        var result = PayrollCalculator.MonthSummary(days, Enumerable.Repeat((.01m, .01m), 3));
        Assert.Equal(3, result.DaysWorked);
        Assert.Equal(.03m, result.BasicHours);
        Assert.Equal(.03m, result.OvertimeHours);
        Assert.Equal(.03m, result.BasicPay);
        Assert.Equal(.03m, result.OvertimePay);
        Assert.Equal(.06m, result.TotalPay);
    }

    [Theory]
    [InlineData("0001-01")] [InlineData("9999-12")] [InlineData("2024-02")]
    public void MonthParser_AcceptsFullDateOnlyRange(string month) => Assert.True(PayrollService.TryMonth(month, out _));
}
