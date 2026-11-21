using HrPayroll.Api.Data.Entities;

namespace HrPayroll.Api.Services.Staff;

public static class StaffStatuses
{
    public const string Present = "Present";
    public const string Late = "Late";
    public const string EarlyLeave = "Early Leave";
    public const string Absent = "Absent";
    public const string WeeklyOff = "Weekly Off";
    public const string PublicHoliday = "Public Holiday";
    public const string MissingSignOut = "Missing Sign-out";
    public const string OnLeave = "On Leave";

    /// <summary>Today, nobody has signed in yet and the shift is not over.</summary>
    public const string NotInYet = "Not In Yet";
}

/// <summary>One employee's worked-out day. Late, early leave, missing sign-out and outside office are flags; <see cref="Status"/> is the headline.</summary>
public sealed record StaffDay(
    DateOnly Date, string Status, decimal Hours, int LateMinutes, int EarlyLeaveMinutes, string? FirstIn, string? LastOut,
    bool IsLate, bool IsEarlyLeave, bool MissingSignOut, bool OutsideOffice, int PunchCount, string? Note);

public sealed record PunchPoint(string Kind, DateTime TimestampUtc, bool OutsideOffice);

/// <summary>The company works on UAE time whatever the server's own time zone is.</summary>
public static class StaffTime
{
    private static readonly TimeZoneInfo Zone = TimeZoneInfo.FindSystemTimeZoneById("Asia/Dubai");

    public static DateTime ToLocal(DateTime utc) =>
        TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), Zone);

    public static DateTime ToUtc(DateOnly date, TimeOnly time) =>
        TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(date.ToDateTime(time), DateTimeKind.Unspecified), Zone);

    public static DateTime NowLocal(TimeProvider time) => ToLocal(time.GetUtcNow().UtcDateTime);

    public static DateOnly Today(TimeProvider time) => DateOnly.FromDateTime(NowLocal(time));
}

/// <summary>The rules that turn a day's sign-ins and sign-outs into a status. Pure: nothing here touches the database.</summary>
public static class StaffDayCalculator
{
    /// <returns>Null for a day that is not worked out: before the join date or in the future.</returns>
    public static StaffDay? Compute(
        DateOnly date, DateTime nowLocal, StaffSettings settings, string? holidayName, string? leaveType,
        IReadOnlyList<PunchPoint> punches, DateOnly? joinDate)
    {
        var today = DateOnly.FromDateTime(nowLocal);
        if (date > today) return null;
        if (joinDate is { } join && date < join) return null;

        var weeklyOff = date.DayOfWeek == settings.WeeklyOff;
        var ordered = punches.OrderBy(p => p.TimestampUtc).ToList();
        var outside = ordered.Any(p => p.OutsideOffice);

        if (ordered.Count == 0)
        {
            var status =
                leaveType is not null ? StaffStatuses.OnLeave
                : holidayName is not null ? StaffStatuses.PublicHoliday
                : weeklyOff ? StaffStatuses.WeeklyOff
                : date == today && TimeOnly.FromDateTime(nowLocal) < settings.ShiftEnd ? StaffStatuses.NotInYet
                : StaffStatuses.Absent;
            return new StaffDay(date, status, 0, 0, 0, null, null, false, false, false, false, 0, leaveType ?? holidayName);
        }

        decimal total = 0;
        DateTime? open = null;
        DateTime? firstIn = null;
        DateTime? lastOut = null;
        foreach (var p in ordered)
        {
            var local = StaffTime.ToLocal(p.TimestampUtc);
            if (p.Kind == PunchKinds.In)
            {
                firstIn ??= local;
                open ??= local;
            }
            else if (open is { } started)
            {
                total += (decimal)(local - started).TotalHours;
                open = null;
                lastOut = local;
            }
        }

        var hours = decimal.Round(total, 2);
        var shiftStart = date.ToDateTime(settings.ShiftStart);
        var shiftEnd = date.ToDateTime(settings.ShiftEnd);
        var worksDay = !weeklyOff && holidayName is null;

        var missing = open is not null && (date < today || nowLocal > shiftEnd);
        var lateMinutes = worksDay && firstIn is { } fi && fi > shiftStart.AddMinutes(settings.LateGraceMinutes)
            ? (int)(fi - shiftStart).TotalMinutes : 0;
        // Leaving early is judged once the day is over: until then the employee can still sign back in.
        var dayOver = date < today || nowLocal >= shiftEnd;
        var earlyMinutes = worksDay && dayOver && open is null && lastOut is { } lo && lo < shiftEnd.AddMinutes(-settings.EarlyGraceMinutes)
            ? (int)Math.Ceiling((shiftEnd - lo).TotalMinutes) : 0;

        var headline =
            missing ? StaffStatuses.MissingSignOut
            : lateMinutes > 0 ? StaffStatuses.Late
            : earlyMinutes > 0 ? StaffStatuses.EarlyLeave
            : StaffStatuses.Present;

        return new StaffDay(date, headline, hours, lateMinutes, earlyMinutes,
            firstIn?.ToString("HH:mm"), lastOut?.ToString("HH:mm"),
            lateMinutes > 0, earlyMinutes > 0, missing, outside, ordered.Count,
            weeklyOff ? "Worked on the weekly off day" : holidayName is not null ? $"Worked on {holidayName}" : null);
    }

    /// <summary>Distance between two coordinates in metres.</summary>
    public static double DistanceMeters(double lat1, double lon1, double lat2, double lon2)
    {
        const double earthRadius = 6371000;
        static double Rad(double d) => d * Math.PI / 180;
        var dLat = Rad(lat2 - lat1);
        var dLon = Rad(lon2 - lon1);
        var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2) + Math.Cos(Rad(lat1)) * Math.Cos(Rad(lat2)) * Math.Sin(dLon / 2) * Math.Sin(dLon / 2);
        return earthRadius * 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
    }

    /// <summary>Working days in a range: Sundays (the weekly off day) and public holidays are not counted.</summary>
    public static int WorkingDays(DateOnly start, DateOnly end, DayOfWeek weeklyOff, ISet<DateOnly> holidays)
    {
        var count = 0;
        for (var d = start; d <= end; d = d.AddDays(1))
            if (d.DayOfWeek != weeklyOff && !holidays.Contains(d)) count++;
        return count;
    }
}

public sealed record StaffResult<T>(int Status, T? Value = default, Dictionary<string, string[]>? Errors = null, string? Title = null)
{
    public static StaffResult<T> Ok(T value) => new(200, value);
    public static StaffResult<T> NotFound(string? title = null) => new(404, Title: title);
    public static StaffResult<T> Invalid(string field, string message) => new(400, Errors: new() { [field] = [message] });
    public static StaffResult<T> Conflict(string title) => new(409, Title: title);
    public static StaffResult<T> Forbidden(string title) => new(403, Title: title);
}
