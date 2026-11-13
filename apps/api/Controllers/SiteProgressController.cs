using HrPayroll.Api.Auth;
using HrPayroll.Api.Dtos;
using HrPayroll.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace HrPayroll.Api.Controllers;

/// <summary>Projects: a Manager or the Administrator maintains them; everyone signed in can read them.</summary>
[ApiController]
[Route("api/site-projects")]
public sealed class SiteProjectsController(SiteProgressService progress) : ControllerBase
{
    [HttpGet]
    [Authorize(Policy = Policies.SiteProgressAccess)]
    public async Task<IActionResult> List([FromQuery] bool includeInactive, CancellationToken ct) =>
        Ok(await progress.ListProjectsAsync(includeInactive, ct));

    [HttpPost]
    [Authorize(Policy = Policies.ManagerOrAdmin)]
    public async Task<IActionResult> Create(SiteProjectRequest request, CancellationToken ct) =>
        SiteProgressController.Map(this, await progress.CreateProjectAsync(request, ct));

    [HttpPut("{id:int}")]
    [Authorize(Policy = Policies.ManagerOrAdmin)]
    public async Task<IActionResult> Update(int id, SiteProjectRequest request, CancellationToken ct) =>
        SiteProgressController.Map(this, await progress.UpdateProjectAsync(id, request, ct));
}

/// <summary>Daily progress reports. Supervisors and above enter them; HR and the rest read, print and export.</summary>
[ApiController]
[Route("api/site-progress")]
public sealed class SiteProgressController(SiteProgressService progress, SiteProgressPdf pdf) : ControllerBase
{
    [HttpGet("{projectId:int}/dates")]
    [Authorize(Policy = Policies.SiteProgressAccess)]
    public async Task<IActionResult> Dates(int projectId, CancellationToken ct) => Map(this, await progress.DatesAsync(projectId, ct));

    [HttpGet("{projectId:int}")]
    [Authorize(Policy = Policies.SiteProgressAccess)]
    public async Task<IActionResult> Get(int projectId, [FromQuery] string? date, CancellationToken ct) =>
        Map(this, await progress.GetAsync(projectId, date, ct));

    /// <summary>Updates the live report (today's snapshot). Earlier days stay as they were saved.</summary>
    [HttpPut("{projectId:int}")]
    [Authorize(Policy = Policies.SupervisorOrAbove)]
    public async Task<IActionResult> SaveLive(int projectId, [FromBody] SiteProgressSaveRequest? request, CancellationToken ct) =>
        Map(this, await progress.SaveAsync(projectId, null, request ?? new(null), ct));

    [HttpPut("{projectId:int}/{date}")]
    [Authorize(Policy = Policies.SupervisorOrAbove)]
    public async Task<IActionResult> Save(int projectId, string date, [FromBody] SiteProgressSaveRequest? request, CancellationToken ct) =>
        Map(this, await progress.SaveAsync(projectId, date, request ?? new(null), ct));

    [HttpDelete("{projectId:int}/{date}")]
    [Authorize(Policy = Policies.ManagerOrAdmin)]
    public async Task<IActionResult> Delete(int projectId, string date, CancellationToken ct) =>
        Map(this, await progress.DeleteAsync(projectId, date, ct));

    [HttpGet("{projectId:int}/csv")]
    [Authorize(Policy = Policies.SiteProgressAccess)]
    public async Task<IActionResult> Csv(int projectId, [FromQuery] string? date, CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        return Map(this, await progress.CsvAsync(projectId, date, ct));
    }

    [HttpGet("{projectId:int}/pdf")]
    [Authorize(Policy = Policies.SiteProgressAccess)]
    public async Task<IActionResult> Pdf(int projectId, [FromQuery] string? date, CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        try
        {
            return Map(this, await progress.PdfAsync(projectId, date, pdf, ct));
        }
        catch (PdfTextNotSupportedException)
        {
            return Problem(statusCode: 422, title: "The PDF supports English text. Update names that use other scripts.");
        }
    }

    internal static IActionResult Map(ControllerBase c, SiteProgressResult r) => r.StatusCode switch
    {
        200 when r.Body is SiteProgressFile f => c.File(f.Bytes, f.ContentType, f.FileName),
        200 => c.Ok(r.Body),
        201 => c.StatusCode(201, r.Body),
        204 => c.NoContent(),
        400 => c.ValidationProblem(new ValidationProblemDetails(r.Errors!)),
        404 => c.Problem(statusCode: 404, title: r.Message ?? "Not found."),
        _ => c.Problem(statusCode: 409, title: r.Message ?? "The change conflicts with the current data. Reload and try again."),
    };
}
