using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Services.Staff;

namespace HrPayroll.Api.Tests.Unit;

public class StaffDayCalculatorTests
{
    private static readonly StaffSettings Settings = new();                 // 09:00 to 17:00, 15 min grace, Sunday off
    private static readonly DateOnly Monday = new(2026, 11, 16);            // a past working day
    private static readonly DateTime LaterNow = new(2026, 11, 30, 12, 0, 0); // "now" is well after the day

    private static PunchPoint At(string kind, DateOnly day, int hour, int minute, bool outside = false) =>
        new(kind, StaffTime.ToUtc(day, new TimeOnly(hour, minute)), outside);

    private static StaffDay Day(DateOnly date, IReadOnlyList<PunchPoint> punches, string? holiday = null, string? leave = null, DateOnly? join = null, DateTime? now = null) =>
        StaffDayCalculator.Compute(date, now ?? LaterNow, Settings, holiday, leave, punches, join)!;

    [Fact]
    public void OnTime_FullDay_IsPresent_WithEightHours()
    {
        var day = Day(Monday, [At("In", Monday, 8, 55), At("Out", Monday, 17, 5)]);
        Assert.Equal(StaffStatuses.Present, day.Status);
        Assert.Equal(8.17m, day.Hours);
        Assert.False(day.IsLate);
    }

    [Fact]
    public void Arrival_WithinGrace_IsNotLate()
    {
        var day = Day(Monday, [At("In", Monday, 9, 15), At("Out", Monday, 17, 0)]);
        Assert.Equal(StaffStatuses.Present, day.Status);
        Assert.Equal(0, day.LateMinutes);
    }

    [Fact]
    public void Arrival_AfterGrace_IsLate_AndCountsMinutesFromShiftStart()
    {
        var day = Day(Monday, [At("In", Monday, 9, 40), At("Out", Monday, 17, 0)]);
        Assert.Equal(StaffStatuses.Late, day.Status);
        Assert.Equal(40, day.LateMinutes);
    }

    [Fact]
    public void LeavingBeforeGrace_IsEarlyLeave()
    {
        var day = Day(Monday, [At("In", Monday, 9, 0), At("Out", Monday, 16, 30)]);
        Assert.Equal(StaffStatuses.EarlyLeave, day.Status);
        Assert.Equal(30, day.EarlyLeaveMinutes);
    }

    [Fact]
    public void LeavingEarly_Today_IsNotFlaggedWhileTheShiftIsStillOn()
    {
        var now = new DateTime(2026, 11, 16, 14, 0, 0);
        var day = Day(Monday, [At("In", Monday, 9, 0), At("Out", Monday, 13, 0)], now: now);
        Assert.Equal(StaffStatuses.Present, day.Status);
        Assert.False(day.IsEarlyLeave);
    }

    [Fact]
    public void LeavingWithinGrace_IsNotEarlyLeave()
    {
        var day = Day(Monday, [At("In", Monday, 9, 0), At("Out", Monday, 16, 50)]);
        Assert.Equal(StaffStatuses.Present, day.Status);
    }

    [Fact]
    public void SeveralPairs_AreSummed()
    {
        var day = Day(Monday, [At("In", Monday, 9, 0), At("Out", Monday, 12, 0), At("In", Monday, 13, 0), At("Out", Monday, 17, 0)]);
        Assert.Equal(7m, day.Hours);
        Assert.Equal(StaffStatuses.Present, day.Status);
    }

    [Fact]
    public void ForgottenSignOut_OnAPastDay_IsFlagged()
    {
        var day = Day(Monday, [At("In", Monday, 9, 0)]);
        Assert.Equal(StaffStatuses.MissingSignOut, day.Status);
        Assert.True(day.MissingSignOut);
    }

    [Fact]
    public void SignedIn_Today_BeforeShiftEnd_IsNotMissingYet()
    {
        var now = new DateTime(2026, 11, 16, 11, 0, 0);
        var day = Day(Monday, [At("In", Monday, 9, 0)], now: now);
        Assert.Equal(StaffStatuses.Present, day.Status);
        Assert.False(day.MissingSignOut);
    }

    [Fact]
    public void NoPunches_PastWorkingDay_IsAbsent()
    {
        Assert.Equal(StaffStatuses.Absent, Day(Monday, []).Status);
    }

    [Fact]
    public void NoPunches_OnSunday_IsWeeklyOff()
    {
        var sunday = new DateOnly(2026, 11, 15);
        Assert.Equal(StaffStatuses.WeeklyOff, Day(sunday, []).Status);
    }

    [Fact]
    public void NoPunches_OnAPublicHoliday_IsHoliday_NotAbsent()
    {
        Assert.Equal(StaffStatuses.PublicHoliday, Day(Monday, [], holiday: "National Day").Status);
    }

    [Fact]
    public void ApprovedLeave_ShowsOnLeave_InsteadOfAbsent()
    {
        var day = Day(Monday, [], leave: "Annual Leave");
        Assert.Equal(StaffStatuses.OnLeave, day.Status);
        Assert.Equal("Annual Leave", day.Note);
    }

    [Fact]
    public void Today_BeforeShiftEnd_WithNoPunches_IsNotInYet()
    {
        var now = new DateTime(2026, 11, 16, 10, 0, 0);
        Assert.Equal(StaffStatuses.NotInYet, Day(Monday, [], now: now).Status);
    }

    [Fact]
    public void FutureDay_And_DayBeforeJoining_AreNotWorkedOut()
    {
        Assert.Null(StaffDayCalculator.Compute(new DateOnly(2027, 1, 5), LaterNow, Settings, null, null, [], null));
        Assert.Null(StaffDayCalculator.Compute(Monday, LaterNow, Settings, null, null, [], new DateOnly(2026, 11, 20)));
    }

    [Fact]
    public void OutsideOffice_Punch_SetsTheFlag_ButStaysPresent()
    {
        var day = Day(Monday, [At("In", Monday, 9, 0, outside: true), At("Out", Monday, 17, 0)]);
        Assert.True(day.OutsideOffice);
        Assert.Equal(StaffStatuses.Present, day.Status);
    }

    [Fact]
    public void WorkingDays_SkipSundaysAndHolidays()
    {
        var holidays = new HashSet<DateOnly> { new(2026, 11, 17) };
        // Mon 16 to Mon 23: Mon, (Tue holiday), Wed, Thu, Fri, Sat, (Sun off), Mon = 6
        Assert.Equal(6, StaffDayCalculator.WorkingDays(new DateOnly(2026, 11, 16), new DateOnly(2026, 11, 23), DayOfWeek.Sunday, holidays));
    }

    [Fact]
    public void Distance_BetweenTwoNearbyPoints_IsInMetres()
    {
        var metres = StaffDayCalculator.DistanceMeters(25.2048, 55.2708, 25.2058, 55.2708);
        Assert.InRange(metres, 105, 118);
    }
}
