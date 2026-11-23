using System.Text.Json;
using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using WebPush;

namespace HrPayroll.Api.Services.Push;

/// <summary>Web push settings. The VAPID key pair comes from the environment (<c>Push__PublicKey</c>, <c>Push__PrivateKey</c>, <c>Push__Subject</c>); without them push is switched off.</summary>
public sealed class PushOptions
{
    public const string SectionName = "Push";
    public string PublicKey { get; set; } = "";
    public string PrivateKey { get; set; } = "";
    /// <summary>A mailto: or https: contact the push services can reach, for example mailto:it@company.com.</summary>
    public string Subject { get; set; } = "";
    public bool IsConfigured => PublicKey.Length > 0 && PrivateKey.Length > 0 && Subject.Length > 0;
}

public sealed record PushMessage(string Title, string Body, string Url);

/// <summary>Delivers one message to one device. Implementations never throw.</summary>
public interface IPushSender
{
    bool IsConfigured { get; }
    void Send(PushDevice device, PushMessage message);
}

/// <summary>Sends through the browser vendors' push services. Delivery is fire-and-forget so a slow push service never delays a request.</summary>
public sealed class WebPushSender(IOptions<PushOptions> options, IServiceScopeFactory scopes, ILogger<WebPushSender> logger) : IPushSender
{
    private static readonly WebPushClient Client = new();
    public bool IsConfigured => options.Value.IsConfigured;

    public void Send(PushDevice device, PushMessage message)
    {
        if (!IsConfigured) return;
        var settings = options.Value;
        var payload = JsonSerializer.Serialize(new { title = message.Title, body = message.Body, url = message.Url });
        var endpoint = device.Endpoint;
        var subscription = new WebPush.PushSubscription(device.Endpoint, device.P256dh, device.Auth);
        _ = Task.Run(async () =>
        {
            try
            {
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
                await Client.SendNotificationAsync(subscription, payload, new VapidDetails(settings.Subject, settings.PublicKey, settings.PrivateKey), timeout.Token);
            }
            catch (WebPushException ex) when (ex.StatusCode is System.Net.HttpStatusCode.Gone or System.Net.HttpStatusCode.NotFound)
            {
                // The phone uninstalled the app or revoked permission: forget the subscription.
                await using var scope = scopes.CreateAsyncScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                await db.PushDevices.Where(d => d.Endpoint == endpoint).ExecuteDeleteAsync();
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Push delivery failed.");
            }
        });
    }
}

/// <summary>Works out who should hear about an event, by user type or by person, and hands the message to the sender.</summary>
public interface IPushNotifier
{
    Task NotifyRolesAsync(string[] roles, PushMessage message, int? exceptUserId = null, CancellationToken ct = default);
    Task NotifyUserAsync(int userId, PushMessage message, CancellationToken ct = default);
    Task NotifyUsernameAsync(string username, PushMessage message, CancellationToken ct = default);
}

public sealed class PushNotifier(AppDbContext db, IPushSender sender, ILogger<PushNotifier> logger) : IPushNotifier
{
    public async Task NotifyRolesAsync(string[] roles, PushMessage message, int? exceptUserId = null, CancellationToken ct = default)
    {
        if (!sender.IsConfigured) return;
        await DeliverAsync(db.PushDevices.Where(d => d.User.IsActive && roles.Contains(d.User.Role) && d.UserId != exceptUserId), message, ct);
    }

    public async Task NotifyUserAsync(int userId, PushMessage message, CancellationToken ct = default)
    {
        if (!sender.IsConfigured) return;
        await DeliverAsync(db.PushDevices.Where(d => d.UserId == userId && d.User.IsActive), message, ct);
    }

    public async Task NotifyUsernameAsync(string username, PushMessage message, CancellationToken ct = default)
    {
        if (!sender.IsConfigured) return;
        await DeliverAsync(db.PushDevices.Where(d => d.User.Username == username && d.User.IsActive), message, ct);
    }

    private async Task DeliverAsync(IQueryable<PushDevice> devices, PushMessage message, CancellationToken ct)
    {
        try
        {
            foreach (var device in await devices.AsNoTracking().ToListAsync(ct)) sender.Send(device, message);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // A notification must never fail the action that caused it.
            logger.LogWarning(ex, "Could not queue push notifications.");
        }
    }
}
