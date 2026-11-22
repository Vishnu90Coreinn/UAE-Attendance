namespace HrPayroll.Api.Data.Entities;

public static class PunchKinds
{
    public const string In = "In";
    public const string Out = "Out";
}

/// <summary>One sign-in or sign-out by an office employee. The time always comes from the server.</summary>
public sealed class StaffPunch
{
    public long Id { get; set; }
    public int WorkerId { get; set; }
    public Worker Worker { get; set; } = null!;
    public string Kind { get; set; } = PunchKinds.In;
    public DateTime TimestampUtc { get; set; }

    /// <summary>The calendar day in the company time zone (UAE) the punch belongs to.</summary>
    public DateOnly WorkDate { get; set; }

    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
    public double? AccuracyMeters { get; set; }

    /// <summary>Metres from the office, when the office location is set and the punch has a location.</summary>
    public double? DistanceMeters { get; set; }

    /// <summary>True when the office check is on and the punch was outside the allowed radius or had no location.</summary>
    public bool OutsideOffice { get; set; }

    /// <summary>"Self" for an employee's own sign-in, "Manual" for a record added by HR or a manager.</summary>
    public string Source { get; set; } = "Self";

    public string? Reason { get; set; }
    public string CreatedBy { get; set; } = "";
    public bool IsVoided { get; set; }
    public string? VoidReason { get; set; }
    public string? VoidedBy { get; set; }
    public DateTime? VoidedUtc { get; set; }
}

/// <summary>The selfie of a punch, kept apart so listing punches never reads the image bytes.</summary>
public sealed class StaffPunchSelfie
{
    public long PunchId { get; set; }
    public StaffPunch Punch { get; set; } = null!;
    public byte[] Data { get; set; } = [];
}

public sealed class PublicHoliday
{
    public int Id { get; set; }
    public DateOnly Date { get; set; }
    public string Name { get; set; } = "";
}

/// <summary>Shift, weekly off and office location for office attendance. One row.</summary>
public sealed class StaffSettings
{
    public const int SingletonId = 1;

    public int Id { get; set; } = SingletonId;
    public TimeOnly ShiftStart { get; set; } = new(9, 0);
    public TimeOnly ShiftEnd { get; set; } = new(17, 0);
    public int LateGraceMinutes { get; set; } = 15;
    public int EarlyGraceMinutes { get; set; } = 15;
    public DayOfWeek WeeklyOff { get; set; } = DayOfWeek.Sunday;
    public double? OfficeLatitude { get; set; }
    public double? OfficeLongitude { get; set; }
    public int? OfficeRadiusMeters { get; set; }

    /// <summary>Off by default. When on, each absent day costs salary / 30 in the employee payroll summary.</summary>
    public bool DeductAbsentDays { get; set; }

    /// <summary>Off (0) by default. AED taken per minute of late arrival in the employee payroll summary.</summary>
    public decimal LateDeductionPerMinute { get; set; }

    public bool OfficeCheckOn => OfficeLatitude is not null && OfficeLongitude is not null && OfficeRadiusMeters is > 0;
}

public sealed class StaffLeaveType
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public int YearlyDays { get; set; }
    public bool IsActive { get; set; } = true;

    /// <summary>When true, a request of this type cannot be sent without a document (a medical certificate for sick leave).</summary>
    public bool RequiresDocument { get; set; }
}

public static class StaffLeaveStatuses
{
    public const string Pending = "Pending";
    public const string Approved = "Approved";
    public const string Rejected = "Rejected";
    public const string Cancelled = "Cancelled";
}

/// <summary>A medical certificate or other document for a leave request. Kept apart so listing leave never reads the image bytes.</summary>
public sealed class StaffLeaveAttachment
{
    public int StaffLeaveRequestId { get; set; }
    public StaffLeaveRequest StaffLeaveRequest { get; set; } = null!;
    public byte[] Data { get; set; } = [];
    public DateTime UploadedUtc { get; set; }
}

public sealed class StaffLeaveRequest
{
    public int Id { get; set; }
    public int WorkerId { get; set; }
    public Worker Worker { get; set; } = null!;
    public int LeaveTypeId { get; set; }
    public StaffLeaveType LeaveType { get; set; } = null!;
    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }

    /// <summary>Working days in the range: Sundays and public holidays are not counted.</summary>
    public int Days { get; set; }

    public string Reason { get; set; } = "";
    public string Status { get; set; } = StaffLeaveStatuses.Pending;
    public string CreatedBy { get; set; } = "";
    public DateTime CreatedUtc { get; set; }
    public string? DecidedBy { get; set; }
    public DateTime? DecidedUtc { get; set; }
    public string? DecisionNote { get; set; }
}
