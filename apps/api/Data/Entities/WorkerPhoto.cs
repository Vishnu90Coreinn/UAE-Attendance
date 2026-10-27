namespace HrPayroll.Api.Data.Entities;

/// <summary>A worker's portrait. Kept apart from Worker so listing workers never reads the image bytes.</summary>
public sealed class WorkerPhoto
{
    public int WorkerId { get; set; }
    public Worker Worker { get; set; } = null!;
    public byte[] Data { get; set; } = [];
    public DateTime UpdatedUtc { get; set; }
}
