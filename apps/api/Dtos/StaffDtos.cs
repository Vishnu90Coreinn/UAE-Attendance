using HrPayroll.Api.Services.Staff;

namespace HrPayroll.Api.Dtos;

public sealed record StaffSettingsDto(
    string? ShiftStart, string? ShiftEnd, int? LateGraceMinutes, int? EarlyGraceMinutes, int? WeeklyOff,
    double? OfficeLatitude, double? OfficeLongitude, int? OfficeRadiusMeters,
    bool? DeductAbsentDays = null, decimal? LateDeductionPerMinute = null);

public sealed record HolidayDto(int Id, string Date, string Name);
/// <summary>EndDate is optional: when set, every day from Date to EndDate (inclusive) becomes a holiday with this name.</summary>
public sealed record HolidayRequest(string? Date, string? Name, string? EndDate = null);

/// <summary>A sign-in or sign-out. The selfie is a JPEG as base64; the location is optional but expected.</summary>
public sealed record PunchRequest(string? SelfieBase64, double? Latitude, double? Longitude, double? AccuracyMeters);

public sealed record PunchDto(
    long Id, string Kind, string Date, string Time, bool OutsideOffice, double? Latitude, double? Longitude,
    double? DistanceMeters, string Source, string? Reason, bool HasSelfie, bool IsVoided, string? VoidReason, string CreatedBy);

public sealed record StaffMeResponse(
    int WorkerId, string Code, string Name, string? Department, string ShiftStart, string ShiftEnd, bool OfficeCheckOn,
    StaffDay Today, string NextKind, List<PunchDto> Punches, string? DayType = null);

/// <summary>The employee's own record. Pay and bank details are not part of it.</summary>
public sealed record StaffProfile(
    int WorkerId, string Code, string FullName, string Designation, string? Department, string? JoinDate, string? Nationality,
    string? EmiratesId, string? PassportNumber, string? Phone, string? Email, string? EmergencyContact, string? WorkLocation,
    string Username, string Role, bool HasPhoto);

public sealed record StaffDayRow(int WorkerId, string Code, string Name, string? Department, StaffDay Day);

public sealed record StaffDayDetail(StaffDayRow Row, List<PunchDto> Punches);

public sealed record ManualPunchRequest(int? WorkerId, string? Date, string? Time, string? Kind, string? Reason);
public sealed record VoidPunchRequest(string? Reason);

public sealed record StaffDashboard(
    string Date, string? DayType, int Total, int SignedIn, int Late, int Absent, int OutsideOffice, int MissingSignOut,
    int OnLeave, int NotInYet, List<StaffDayRow> Attention);

public sealed record StaffReportRow(
    int WorkerId, string Code, string Name, string? Department, int PresentDays, int LateDays, int LateMinutes,
    int EarlyLeaveDays, int EarlyLeaveMinutes, int AbsentDays, int LeaveDays, int WeeklyOffDays, int HolidayDays,
    int MissingSignOutDays, int OutsideOfficeDays, decimal TotalHours);

public sealed record StaffReport(string From, string To, List<StaffReportRow> Rows, List<StaffDayRow> Days);

/// <summary>One office employee's month: salary beside attendance. No deductions are applied (that is a later, optional stage).</summary>
public sealed record StaffPayrollRow(
    int WorkerId, string Code, string Name, string? Department, decimal MonthlySalary, int WorkingDays, int PresentDays,
    int AbsentDays, int LeaveDays, int LateDays, int LateMinutes, int EarlyLeaveMinutes, decimal TotalHours,
    decimal AbsentDeduction, decimal LateDeduction, decimal NetSalary,
    decimal OtherDeduction = 0m, List<StaffOtherDeduction>? OtherItems = null);

/// <summary>An advance, loan or other deduction entered on the Deductions page, with its reason.</summary>
public sealed record StaffOtherDeduction(string Type, string Reason, decimal Amount);

public sealed record StaffPayrollSummary(
    string Month, string Label, List<StaffPayrollRow> Rows, decimal TotalSalary, decimal TotalDeductions, decimal TotalNet,
    bool DeductAbsentDays, decimal LateDeductionPerMinute);

public sealed record MyLetterRequest(string? LetterType, string? Reason);

public sealed record StaffLinkableUser(int Id, string Username, string Role);
public sealed record EmployeeLoginRequest(int? LinkUserId, string? Username, string? Password);

// Leave (stage 2)
public sealed record StaffLeaveTypeDto(int Id, string Name, int YearlyDays, bool IsActive, bool RequiresDocument = false);
public sealed record StaffLeaveTypeRequest(string? Name, int? YearlyDays, bool? IsActive, bool? RequiresDocument = null);

public sealed record StaffLeaveDto(
    int Id, int WorkerId, string Code, string Name, string? Department, int LeaveTypeId, string LeaveType, string StartDate,
    string EndDate, int Days, string Reason, string Status, string CreatedBy, string CreatedUtc, string? DecidedBy,
    string? DecidedUtc, string? DecisionNote, bool HasAttachment = false);

public sealed record StaffLeaveRequestInput(int? LeaveTypeId, string? StartDate, string? EndDate, string? Reason, int? WorkerId = null, string? AttachmentBase64 = null);
public sealed record StaffLeaveDecision(string? Note);

public sealed record StaffLeaveBalanceDto(int LeaveTypeId, string LeaveType, int Entitlement, int Used, int Pending, int Remaining);
public sealed record StaffLeaveBalanceRow(int WorkerId, string Code, string Name, string? Department, List<StaffLeaveBalanceDto> Balances);

public sealed record StaffMyLeaveResponse(List<StaffLeaveBalanceDto> Balances, List<StaffLeaveDto> Requests, List<StaffLeaveTypeDto> Types);
