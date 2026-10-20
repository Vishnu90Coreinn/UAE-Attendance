namespace HrPayroll.Api.Dtos;

public sealed record FinalisePayrollRequest(string? Revision);
public sealed record ReopenPayrollRequest(string? Reason);
