namespace HrPayroll.Api.Services;

/// <summary>
/// UAE paid-leave allowances. Annual leave unlocks 10 months after the join date; sick and emergency leave are allowed
/// from the join date. Every allowance renews on the worker's join-date anniversary. A worker without a join date has
/// no annual leave and uses the calendar year for the other two.
/// </summary>
public static class LeaveEntitlements
{
    public const string Annual = "Annual Leave";
    public const string Sick = "Sick Leave";
    public const string Emergency = "Emergency Leave";
    public const int AnnualWaitMonths = 10;

    public static readonly string[] Types = [Annual, Sick, Emergency];

    public static bool IsLeave(string? status) => status is Annual or Sick or Emergency;

    public static int Allowance(string type) => type switch { Annual => 30, Sick => 15, Emergency => 5, _ => 0 };

    /// <summary>First day annual leave can be taken, or null when the join date is unknown.</summary>
    public static DateOnly? EligibleFrom(string type, DateOnly? joinDate) =>
        type != Annual ? joinDate : joinDate?.AddMonths(AnnualWaitMonths);

    /// <summary>The allowance year containing <paramref name="day"/>, or null when the worker cannot take this leave then.</summary>
    public static (DateOnly Start, DateOnly End)? Period(string type, DateOnly? joinDate, DateOnly day)
    {
        if (joinDate is null)
            return type == Annual ? null : (new DateOnly(day.Year, 1, 1), new DateOnly(day.Year, 12, 31));
        var join = joinDate.Value;
        if (EligibleFrom(type, join) is { } from && day < from) return null;
        var years = Math.Max(0, day.Year - join.Year);
        if (join.AddYears(years) > day) years = Math.Max(0, years - 1);
        return (join.AddYears(years), join.AddYears(years + 1).AddDays(-1));
    }
}
