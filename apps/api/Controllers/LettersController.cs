using HrPayroll.Api.Auth;
using HrPayroll.Api.Dtos;
using HrPayroll.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace HrPayroll.Api.Controllers;

/// <summary>HR certificates and letters. Manager, Administrator and HR issue and read them; a Supervisor has no access.</summary>
[ApiController]
[Route("api/letters")]
public sealed class LettersController(LetterService letters, LetterPdf pdf) : ControllerBase
{
    [HttpGet]
    [Authorize(Policy = Policies.ManagerAdminOrHr)]
    public async Task<IActionResult> List(
        [FromQuery] string? search, [FromQuery] string? type, [FromQuery] string? from, [FromQuery] string? to, CancellationToken ct)
    {
        var errors = new Dictionary<string, string[]>();
        DateOnly? fromDate = null, toDate = null;
        if (!string.IsNullOrEmpty(from)) { if (DateOnly.TryParse(from, out var f)) fromDate = f; else errors["from"] = ["Enter a valid date."]; }
        if (!string.IsNullOrEmpty(to)) { if (DateOnly.TryParse(to, out var t)) toDate = t; else errors["to"] = ["Enter a valid date."]; }
        if (errors.Count > 0) return ValidationProblem(new ValidationProblemDetails(errors));
        return Ok(await letters.ListAsync(search, type, fromDate, toDate, ct));
    }

    /// <summary>Builds the letter from the current worker and settings without saving anything.</summary>
    [HttpPost("preview")]
    [Authorize(Policy = Policies.ManagerAdminOrHr)]
    public async Task<IActionResult> Preview(LetterRequest request, CancellationToken ct) => Map(await letters.PreviewAsync(request, ct));

    [HttpPost]
    [Authorize(Policy = Policies.ManagerAdminOrHr)]
    public async Task<IActionResult> Issue(LetterRequest request, CancellationToken ct) => Map(await letters.IssueAsync(request, ct));

    [HttpGet("{id:int}")]
    [Authorize(Policy = Policies.ManagerAdminOrHr)]
    public async Task<IActionResult> Get(int id, CancellationToken ct) => Map(await letters.GetAsync(id, ct));

    [HttpGet("{id:int}/pdf")]
    [Authorize(Policy = Policies.ManagerAdminOrHr)]
    public async Task<IActionResult> Pdf(int id, CancellationToken ct)
    {
        var loaded = await letters.LoadForPdfAsync(id, ct);
        if (loaded is null) return Problem(statusCode: 404, title: "Letter not found.");
        try
        {
            var bytes = pdf.Generate(loaded.Value.Content, loaded.Value.Settings);
            Response.Headers.CacheControl = "private, no-store";
            return File(bytes, "application/pdf", loaded.Value.RefNo.Replace('/', '-') + ".pdf");
        }
        catch (PdfTextNotSupportedException)
        {
            return Problem(statusCode: 422, title: "The PDF supports English text. Update names that use other scripts.");
        }
    }

    /// <summary>The uploaded company logo, seal or signature, for the on-screen preview and print.</summary>
    [HttpGet("images/{kind:regex(^(logo|seal|signature)$)}")]
    [Authorize(Policy = Policies.ManagerAdminOrHr)]
    public async Task<IActionResult> Image(string kind, CancellationToken ct)
    {
        var image = await letters.GetImageAsync(kind, ct);
        if (image is null) return Problem(statusCode: 404, title: "No image has been uploaded.");
        Response.Headers.CacheControl = "private, no-store";
        return File(image.Value.Data, image.Value.ContentType);
    }

    private IActionResult Map(LetterResult r) => r.StatusCode switch
    {
        200 => Ok(r.Body),
        201 => StatusCode(201, r.Body),
        400 => ValidationProblem(new ValidationProblemDetails(r.Errors!)),
        404 => Problem(statusCode: 404, title: "Letter not found."),
        _ => Problem(statusCode: 409, title: r.Message ?? "The letter could not be issued. Try again."),
    };
}
