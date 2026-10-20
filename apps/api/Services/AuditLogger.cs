using System.Text.Json;
using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;

namespace HrPayroll.Api.Services;

public interface IAuditLogger
{
    /// <summary>
    /// Adds an audit row to the current <see cref="AppDbContext"/>. It does not save: the caller's
    /// SaveChangesAsync commits the audit row together with the change it describes.
    /// </summary>
    void Write(string action, string? actorUsername = null, string? entityType = null, string? entityId = null, object? details = null);
}

public class AuditLogger(AppDbContext db, IHttpContextAccessor httpContextAccessor) : IAuditLogger
{
    public void Write(string action, string? actorUsername = null, string? entityType = null, string? entityId = null, object? details = null)
    {
        db.AuditLogs.Add(new AuditLog
        {
            TimestampUtc = DateTime.UtcNow,
            ActorUsername = actorUsername ?? httpContextAccessor.HttpContext?.User.Identity?.Name,
            Action = action,
            EntityType = entityType,
            EntityId = entityId,
            DetailsJson = details is null ? null : JsonSerializer.Serialize(details),
        });
    }
}
