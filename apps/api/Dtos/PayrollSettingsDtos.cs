namespace HrPayroll.Api.Dtos;

public sealed record PayrollSettingsResponse(
    string CompanyName,
    string Tagline,
    string ContactEmail,
    decimal OvertimeRatePerHour,
    decimal MaxBasicHoursPerDay,
    string ShiftDescription,
    string PreparedByLabel,
    string ApprovedByLabel);
