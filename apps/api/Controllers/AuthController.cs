using System.Security.Claims;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Data;
using HrPayroll.Api.Dtos;
using HrPayroll.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.JsonWebTokens;

namespace HrPayroll.Api.Controllers;

[ApiController]
[Route("api/auth")]
public sealed class AuthController(AppDbContext db, AuthService authService, JwtTokenService tokenService) : ControllerBase
{
    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<ActionResult<LoginResponse>> Login(LoginRequest request, CancellationToken cancellationToken)
    {
        var result = await authService.LoginAsync(request.Username, request.Password, cancellationToken);

        switch (result.Outcome)
        {
            case LoginOutcome.Success:
                var user = result.User!;
                var (token, expiresUtc) = tokenService.CreateToken(user);
                return Ok(new LoginResponse(token, expiresUtc, new CurrentUserResponse(user.Id, user.Username, user.Role)));

            case LoginOutcome.Locked:
                return Failure(StatusCodes.Status423Locked, "Account temporarily locked. Try again later.");

            default:
                // One body for unknown user, wrong password and inactive user; nothing request-specific in it.
                return Failure(StatusCodes.Status401Unauthorized, "Invalid username or password.");
        }
    }

    [HttpGet("me")]
    [Authorize(Policy = Policies.AnyUser)]
    public async Task<ActionResult<CurrentUserResponse>> Me(CancellationToken cancellationToken)
    {
        var subject = User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!int.TryParse(subject, out var userId))
        {
            return Unauthorized();
        }

        var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.Id == userId, cancellationToken);
        if (user is null || !user.IsActive)
        {
            return Unauthorized();
        }

        return Ok(new CurrentUserResponse(user.Id, user.Username, user.Role));
    }

    // Built by hand (not via ControllerBase.Problem) so the body has no per-request trace id and stays byte-identical.
    private ObjectResult Failure(int status, string title) =>
        new(new ProblemDetails { Status = status, Title = title })
        {
            StatusCode = status,
            ContentTypes = { "application/problem+json" },
        };
}
