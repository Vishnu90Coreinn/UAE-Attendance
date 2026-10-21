namespace HrPayroll.Api.Dtos;

public sealed record DeductionTypeResponse(int Id, string Name, bool IsActive);

/// <summary>Create uses only <c>Name</c>; update uses both. Missing fields are answered with field messages.</summary>
public sealed class DeductionTypeRequest
{
    public string? Name { get; init; }
    public bool? IsActive { get; init; }
}

public sealed record DeductionEntry(int DeductionTypeId, decimal? Amount, string? Note);

public sealed record MonthDeductionWorker(int WorkerId, string WorkerCode, string FullName, bool IsActive,
    IReadOnlyList<DeductionEntry> Entries);

public sealed record MonthDeductionsResponse(string Month, bool IsFinalised, IReadOnlyList<DeductionTypeResponse> Types,
    IReadOnlyList<MonthDeductionWorker> Workers);

public sealed class MonthDeductionWorkerRequest
{
    public int WorkerId { get; init; }
    public List<DeductionEntry>? Entries { get; init; }
}

public sealed class MonthDeductionsSaveRequest
{
    public List<MonthDeductionWorkerRequest?>? Workers { get; init; }
}
