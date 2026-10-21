namespace HrPayroll.Api.Dtos;

/// <summary>
/// Create/update body. Every member is nullable so a missing field reaches the validator, which answers with the
/// documented field message instead of a generic model-binding error. A missing or null <c>OvertimeRate</c> is valid
/// and means "use the company overtime rate".
/// </summary>
public sealed record WorkerRequest(
    string? WorkerCode, string? FullName, string? Designation, decimal? HourlyRate, decimal? OvertimeRate = null, DateOnly? JoinDate = null);

/// <summary>
/// <c>OvertimeRate</c> is the worker's own rate (null = none set); <c>EffectiveOvertimeRate</c> is that rate, or the
/// company <c>OvertimeRatePerHour</c> when none is set.
/// </summary>
public sealed record WorkerResponse(
    int Id, string WorkerCode, string FullName, string Designation, decimal? HourlyRate,
    decimal? OvertimeRate, decimal? EffectiveOvertimeRate, bool IsActive, DateOnly? JoinDate = null);

public sealed record NextWorkerCodeResponse(string WorkerCode);
