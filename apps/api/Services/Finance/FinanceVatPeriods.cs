namespace HrPayroll.Api.Services.Finance;

public static class FinanceVatPeriods
{
    public static (DateOnly From, DateOnly To) For(DateOnly date, int months, int startMonth)
    {
        var anchor = new DateOnly(date.Year, startMonth, 1);
        while (anchor > date) anchor = anchor.AddMonths(-months);
        while (anchor.AddMonths(months) <= date) anchor = anchor.AddMonths(months);
        return (anchor, anchor.AddMonths(months).AddDays(-1));
    }
}
