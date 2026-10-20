namespace HrPayroll.Api.Dtos;

/// <summary>
/// Create/update body. Every member is nullable so a missing field reaches the validator, which answers with the
/// documented field message instead of a generic model-binding error.
/// </summary>
public sealed record WorkerRequest(string? WorkerCode, string? FullName, string? Designation, decimal? HourlyRate);

public sealed record WorkerResponse(
    int Id, string WorkerCode, string FullName, string Designation, decimal HourlyRate, bool IsActive);

public sealed record NextWorkerCodeResponse(string WorkerCode);
