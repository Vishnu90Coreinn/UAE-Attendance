using System.ComponentModel.DataAnnotations;

namespace HrPayroll.Api.Dtos;

// Validation attributes sit on the record's constructor parameters, which is where MVC looks for them.
public sealed record LoginRequest(
    [Required, MaxLength(50)] string Username,
    [Required, MaxLength(128)] string Password);

public sealed record ChangePasswordRequest(
    [Required, MaxLength(128)] string CurrentPassword,
    [Required, MaxLength(128)] string NewPassword);

public sealed record CurrentUserResponse(int Id, string Username, string Role);

public sealed record LoginResponse(string Token, DateTime ExpiresUtc, CurrentUserResponse User);
