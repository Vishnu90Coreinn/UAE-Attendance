namespace HrPayroll.Api.Data.Entities;

public class AuditLog
{
    public long Id { get; set; }
    public DateTime TimestampUtc { get; set; }
    public string? ActorUsername { get; set; }
    public string Action { get; set; } = "";
    public string? EntityType { get; set; }
    public string? EntityId { get; set; }
    public string? DetailsJson { get; set; }
}
