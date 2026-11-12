using HrPayroll.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace HrPayroll.Api.Controllers;

/// <summary>Maps a <see cref="DocumentResult"/> from the invoicing services to an HTTP response.</summary>
[ApiController]
public abstract class InvoiceBaseController : ControllerBase
{
    protected IActionResult Map(DocumentResult r) => r.StatusCode switch
    {
        200 => Ok(r.Body),
        201 => StatusCode(201, r.Body),
        204 => NoContent(),
        400 => ValidationProblem(new ValidationProblemDetails(r.Errors!)),
        404 => Problem(statusCode: 404, title: "Not found."),
        _ => Problem(statusCode: 409, title: r.Message ?? "The change conflicts with the current data. Reload and try again."),
    };
}
