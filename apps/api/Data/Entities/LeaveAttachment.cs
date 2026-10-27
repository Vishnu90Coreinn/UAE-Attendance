namespace HrPayroll.Api.Data.Entities;

/// <summary>The photo of a leave request or doctor's note. Kept apart from LeaveRequest so listing leave never reads the image bytes.</summary>
public sealed class LeaveAttachment
{
    public int LeaveRequestId { get; set; }
    public LeaveRequest LeaveRequest { get; set; } = null!;
    public string ContentType { get; set; } = "image/jpeg";
    public byte[] Data { get; set; } = [];
    public DateTime UploadedUtc { get; set; }
}
