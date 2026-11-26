using HrPayroll.Api.Services.Finance;

namespace HrPayroll.Api.Tests.Unit;

public class FinanceVatPeriodTests
{
    [Fact]
    public void AssignedQuarter_CanStartInFebruary_AndCrossYearBoundary()
    {
        var period = FinanceVatPeriods.For(new DateOnly(2027, 1, 10), 3, 2);
        Assert.Equal(new DateOnly(2026, 11, 1), period.From);
        Assert.Equal(new DateOnly(2027, 1, 31), period.To);
    }

    [Fact]
    public void AssignedMonthlyPeriod_UsesTheSelectedMonth()
    {
        var period = FinanceVatPeriods.For(new DateOnly(2026, 11, 10), 1, 1);
        Assert.Equal(new DateOnly(2026, 11, 1), period.From);
        Assert.Equal(new DateOnly(2026, 11, 30), period.To);
    }
}
