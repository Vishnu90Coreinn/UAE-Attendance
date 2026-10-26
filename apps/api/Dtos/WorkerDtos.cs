namespace HrPayroll.Api.Dtos;

/// <summary>
/// Create/update body. Every member is nullable so a missing field reaches the validator, which answers with the
/// documented field message instead of a generic model-binding error. A missing or null <c>OvertimeRate</c> is valid
/// and means "use the company overtime rate". The profile fields after <c>JoinDate</c> are optional; blank means not recorded.
/// </summary>
public sealed record WorkerRequest(
    string? WorkerCode, string? FullName, string? Designation, decimal? HourlyRate, decimal? OvertimeRate = null, DateOnly? JoinDate = null,
    string? Department = null, string? EmiratesId = null, string? PassportNumber = null, string? Phone = null,
    string? Email = null, string? EmergencyContact = null, string? WorkLocation = null, string? Notes = null,
    bool? ContractSigned = null, bool? VisaMedicalCleared = null, bool? SafetyGearIssued = null,
    bool? SiteOrientationDone = null, bool? WpsRegistered = null, bool? BadgeIssued = null);

/// <summary>
/// <c>OvertimeRate</c> is the worker's own rate (null = none set); <c>EffectiveOvertimeRate</c> is that rate, or the
/// company <c>OvertimeRatePerHour</c> when none is set.
/// </summary>
public sealed record WorkerResponse(
    int Id, string WorkerCode, string FullName, string Designation, decimal? HourlyRate,
    decimal? OvertimeRate, decimal? EffectiveOvertimeRate, bool IsActive, DateOnly? JoinDate = null,
    string? Department = null, string? EmiratesId = null, string? PassportNumber = null, string? Phone = null,
    string? Email = null, string? EmergencyContact = null, string? WorkLocation = null, string? Notes = null,
    bool ContractSigned = false, bool VisaMedicalCleared = false, bool SafetyGearIssued = false,
    bool SiteOrientationDone = false, bool WpsRegistered = false, bool BadgeIssued = false);

public sealed record NextWorkerCodeResponse(string WorkerCode);
