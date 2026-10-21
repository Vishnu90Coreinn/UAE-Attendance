namespace HrPayroll.Api.Dtos;

public sealed record PayrollSettingsResponse(
    string CompanyName,
    string Tagline,
    string ContactEmail,
    decimal? OvertimeRatePerHour,
    decimal MaxBasicHoursPerDay,
    string ShiftDescription,
    string PreparedByLabel,
    string ApprovedByLabel);

/// <summary>
/// Body of <c>PUT /api/settings/payroll</c>. Every member is nullable so a missing field reaches the validator, which
/// answers with the documented field message instead of a generic model-binding error. A missing tagline counts as empty.
/// </summary>
public sealed record PayrollSettingsRequest(
    string? CompanyName,
    string? Tagline,
    string? ContactEmail,
    decimal? OvertimeRatePerHour,
    decimal? MaxBasicHoursPerDay,
    string? ShiftDescription,
    string? PreparedByLabel,
    string? ApprovedByLabel);
