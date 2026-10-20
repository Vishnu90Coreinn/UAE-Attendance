using System.Text.Json.Serialization;
using HrPayroll.Api.Services;

namespace HrPayroll.Api.Dtos;

public sealed class AttendanceRequest
{
    public int WorkerId { get; init; }
    // Explicit null means remove this record atomically with the rest of the batch.
    [JsonRequired]
    public string? Status { get; init; }
    public decimal? BasicHours { get; init; }
    public decimal? OvertimeHours { get; init; }
}

public sealed record AttendanceRecordResponse(string Status, decimal BasicHours, decimal OvertimeHours);
public sealed record AttendanceRowResponse(WorkerResponse Worker, AttendanceRecordResponse? Record, DailyPay DailyPay);
public sealed record AttendanceDayResponse(DateOnly Date, bool IsFinalised, List<AttendanceRowResponse> Rows);
