namespace HrPayroll.Api.Data.Entities;

/// <summary>A browser or installed-app push subscription for one signed-in user. One row per device endpoint.</summary>
public sealed class PushDevice
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public User User { get; set; } = null!;
    public string Endpoint { get; set; } = "";
    public string P256dh { get; set; } = "";
    public string Auth { get; set; } = "";
    public DateTime CreatedUtc { get; set; }
}
