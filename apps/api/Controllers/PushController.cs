using System.Security.Claims;
using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Services.Push;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;

namespace HrPayroll.Api.Controllers;

public sealed record PushKeys(string? P256dh, string? Auth);
public sealed record PushSubscribeRequest(string? Endpoint, PushKeys? Keys);
public sealed record PushUnsubscribeRequest(string? Endpoint);

/// <summary>Lets a signed-in user turn phone notifications on or off for this device.</summary>
[ApiController]
[Route("api/push")]
[Authorize]
public sealed class PushController(AppDbContext db, IOptions<PushOptions> options, TimeProvider time) : ControllerBase
{
    [HttpGet("config")]
    public IActionResult Config() => Ok(new { enabled = options.Value.IsConfigured, publicKey = options.Value.IsConfigured ? options.Value.PublicKey : "" });

    [HttpPost("subscribe")]
    public async Task<IActionResult> Subscribe(PushSubscribeRequest request, CancellationToken ct)
    {
        if (!options.Value.IsConfigured) return Problem(statusCode: 409, title: "Notifications are not set up on the server.");
        var endpoint = request.Endpoint?.Trim() ?? "";
        if (!Uri.TryCreate(endpoint, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps || endpoint.Length > 800
            || string.IsNullOrWhiteSpace(request.Keys?.P256dh) || string.IsNullOrWhiteSpace(request.Keys?.Auth)
            || request.Keys.P256dh.Length > 200 || request.Keys.Auth.Length > 100)
            return ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]> { ["endpoint"] = ["Send a valid push subscription."] }));
        var userId = CurrentUserId();
        if (userId is null) return Unauthorized();

        // One row per device: a different user signing in on the same phone takes the subscription over.
        var device = await db.PushDevices.SingleOrDefaultAsync(d => d.Endpoint == endpoint, ct);
        if (device is null)
        {
            device = new PushDevice { Endpoint = endpoint, CreatedUtc = time.GetUtcNow().UtcDateTime };
            db.PushDevices.Add(device);
        }
        device.UserId = userId.Value;
        device.P256dh = request.Keys.P256dh!;
        device.Auth = request.Keys.Auth!;
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpPost("unsubscribe")]
    public async Task<IActionResult> Unsubscribe(PushUnsubscribeRequest request, CancellationToken ct)
    {
        var endpoint = request.Endpoint?.Trim() ?? "";
        var userId = CurrentUserId();
        await db.PushDevices.Where(d => d.Endpoint == endpoint && d.UserId == userId).ExecuteDeleteAsync(ct);
        return NoContent();
    }

    private int? CurrentUserId() =>
        int.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : null;
}
