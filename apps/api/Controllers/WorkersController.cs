using HrPayroll.Api.Auth;
using HrPayroll.Api.Dtos;
using HrPayroll.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace HrPayroll.Api.Controllers;

[ApiController]
[Route("api/workers")]
public sealed class WorkersController(WorkerService workers, WageRedactor wages, WorkerProfileService profiles) : ControllerBase
{
    [HttpGet]
    [Authorize(Policy = Policies.AnyUser)]
    public async Task<ActionResult<List<WorkerResponse>>> List(
        [FromQuery] bool includeInactive = false, CancellationToken cancellationToken = default) =>
        Ok(wages.Apply(await workers.ListAsync(includeInactive, cancellationToken)));

    [HttpGet("next-code")]
    [Authorize(Policy = Policies.AnyUser)]
    public async Task<ActionResult<NextWorkerCodeResponse>> NextCode(CancellationToken cancellationToken) =>
        Ok(new NextWorkerCodeResponse(await workers.NextCodeAsync(cancellationToken)));

    [HttpGet("{id:int}")]
    [Authorize(Policy = Policies.AnyUser)]
    public async Task<ActionResult<WorkerResponse>> Get(int id, CancellationToken cancellationToken)
    {
        var worker = await workers.GetAsync(id, cancellationToken);
        return worker is null ? NotFound() : Ok(wages.Apply(worker));
    }

    [HttpGet("{id:int}/photo")]
    [Authorize(Policy = Policies.AnyUser)]
    public async Task<IActionResult> Photo(int id, CancellationToken cancellationToken)
    {
        var photo = await workers.GetPhotoAsync(id, cancellationToken);
        if (photo is null) return Problem(statusCode: 404, title: "This worker has no photo.");
        Response.Headers.CacheControl = "private, no-store";
        return File(photo, "image/jpeg");
    }

    [HttpGet("{id:int}/profile/pdf")]
    [Authorize(Policy = Policies.ManagerAdminOrHr)]
    public async Task<IActionResult> ProfilePdf(int id, CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        try
        {
            var result = await profiles.GetAsync(id, includeRates: !wages.HidesWages, cancellationToken);
            return result is null ? NotFound() : File(result.Value.Pdf, "application/pdf", result.Value.FileName);
        }
        catch (PdfTextNotSupportedException)
        {
            return Problem(statusCode: 422, title: "Worker records support English text. Update details that use other scripts.");
        }
    }

    [HttpPost]
    [Authorize(Policy = Policies.ManagerAdminOrHr)]
    public async Task<ActionResult<WorkerResponse>> Create(WorkerRequest request, CancellationToken cancellationToken)
    {
        var result = await workers.CreateAsync(request, cancellationToken);
        return result.Succeeded
            ? CreatedAtAction(nameof(Get), new { id = result.Worker!.Id }, result.Worker)
            : ToProblem(result);
    }

    [HttpPut("{id:int}")]
    [Authorize(Policy = Policies.ManagerAdminOrHr)]
    public async Task<ActionResult<WorkerResponse>> Update(int id, WorkerRequest request, CancellationToken cancellationToken) =>
        ToActionResult(await workers.UpdateAsync(id, request, cancellationToken));

    [HttpPost("{id:int}/deactivate")]
    [Authorize(Policy = Policies.ManagerOrAdmin)]
    public async Task<ActionResult<WorkerResponse>> Deactivate(int id, CancellationToken cancellationToken) =>
        ToActionResult(await workers.SetActiveAsync(id, active: false, cancellationToken));

    [HttpPost("{id:int}/activate")]
    [Authorize(Policy = Policies.ManagerOrAdmin)]
    public async Task<ActionResult<WorkerResponse>> Activate(int id, CancellationToken cancellationToken) =>
        ToActionResult(await workers.SetActiveAsync(id, active: true, cancellationToken));

    [HttpDelete("{id:int}")]
    [Authorize(Policy = Policies.ManagerOrAdmin)]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        var result = await workers.DeleteAsync(id, cancellationToken);
        return result.Succeeded ? NoContent() : ToProblem(result);
    }

    private ActionResult<WorkerResponse> ToActionResult(WorkerResult result) =>
        result.Succeeded ? Ok(result.Worker) : ToProblem(result);

    private ActionResult ToProblem(WorkerResult result)
    {
        switch (result.Outcome)
        {
            case WorkerOutcome.Invalid:
                var errors = result.Errors!.ToDictionary(e => e.Key, e => new[] { e.Value });
                return ValidationProblem(new ValidationProblemDetails(errors));

            case WorkerOutcome.InUse:
                return new ObjectResult(new ProblemDetails
                {
                    Status = StatusCodes.Status409Conflict,
                    Title = WorkerService.InUseMessage,
                })
                {
                    StatusCode = StatusCodes.Status409Conflict,
                    ContentTypes = { "application/problem+json" },
                };

            default:
                return NotFound();
        }
    }
}
