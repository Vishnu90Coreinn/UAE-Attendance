using System.Security.Claims;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Dtos;
using HrPayroll.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace HrPayroll.Api.Controllers;

[ApiController]
[Route("api/users")]
[Authorize(Policy = Policies.AdminOnly)]
public sealed class UsersController(UserService users) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<List<UserResponse>>> List(CancellationToken ct) => Ok(await users.ListAsync(ct));

    [HttpPost]
    public async Task<ActionResult<UserResponse>> Create(CreateUserRequest request, CancellationToken ct)
    {
        var result = await users.CreateAsync(request, User.Identity!.Name!, ct);
        return result.Succeeded ? Created($"/api/users/{result.User!.Id}", result.User) : Problem(result);
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<UserResponse>> Update(int id, UpdateUserRequest request, CancellationToken ct)
    {
        var result = await users.UpdateAsync(id, request, CurrentUserId(), User.Identity!.Name!, ct);
        return result.Succeeded ? Ok(result.User) : Problem(result);
    }

    [HttpPost("{id:int}/reset-password")]
    public async Task<IActionResult> ResetPassword(int id, ResetUserPasswordRequest request, CancellationToken ct)
    {
        var result = await users.ResetPasswordAsync(id, request, User.Identity!.Name!, ct);
        return result.Succeeded ? NoContent() : Problem(result);
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        var result = await users.DeleteAsync(id, CurrentUserId(), User.Identity!.Name!, ct);
        return result.Succeeded ? NoContent() : Problem(result);
    }

    private int CurrentUserId() => int.Parse(
        User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier)!,
        System.Globalization.CultureInfo.InvariantCulture);

    private ActionResult Problem(UserResult result) => result.Outcome switch
    {
        UserOutcome.Invalid => ValidationProblem(new ValidationProblemDetails(
            result.Errors!.ToDictionary(x => x.Key, x => new[] { x.Value }))),
        UserOutcome.Conflict => new ObjectResult(new ProblemDetails
        {
            Status = StatusCodes.Status409Conflict,
            Title = result.Message,
        }) { StatusCode = StatusCodes.Status409Conflict, ContentTypes = { "application/problem+json" } },
        _ => NotFound(),
    };
}
