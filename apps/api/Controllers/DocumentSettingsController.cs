using HrPayroll.Api.Auth;
using HrPayroll.Api.Dtos;
using HrPayroll.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace HrPayroll.Api.Controllers;

/// <summary>Company identity, bank details and artwork shared by invoices and letters.</summary>
[Route("api/documents")]
public sealed class DocumentSettingsController(DocumentSettingsService settings) : InvoiceBaseController
{
    [HttpGet("settings")]
    [Authorize(Policy = Policies.ManagerAdminOrHr)]
    public async Task<IActionResult> Get(CancellationToken ct) => Ok(await settings.GetAsync(ct));

    [HttpPut("settings")]
    [Authorize(Policy = Policies.ManagerOrAdmin)]
    public async Task<IActionResult> Update(DocumentSettingsRequest request, CancellationToken ct) => Map(await settings.UpdateAsync(request, ct));

    /// <summary><c>kind</c> is logo, seal or signature.</summary>
    [HttpGet("images/{kind}")]
    [Authorize(Policy = Policies.ManagerAdminOrHr)]
    public async Task<IActionResult> GetImage(string kind, CancellationToken ct)
    {
        var image = await settings.GetImageAsync(kind, ct);
        if (image is null) return Problem(statusCode: 404, title: "No picture has been uploaded.");
        Response.Headers.CacheControl = "private, no-store";
        return File(image.Data, image.ContentType);
    }

    [HttpPost("images/{kind}")]
    [Authorize(Policy = Policies.ManagerOrAdmin)]
    public async Task<IActionResult> SetImage(string kind, DocumentImageRequest request, CancellationToken ct) => Map(await settings.SetImageAsync(kind, request.ImageBase64, ct));

    [HttpDelete("images/{kind}")]
    [Authorize(Policy = Policies.ManagerOrAdmin)]
    public async Task<IActionResult> DeleteImage(string kind, CancellationToken ct) => Map(await settings.DeleteImageAsync(kind, ct));
}
