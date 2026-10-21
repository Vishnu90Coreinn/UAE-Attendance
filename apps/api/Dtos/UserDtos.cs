using System.ComponentModel.DataAnnotations;

namespace HrPayroll.Api.Dtos;

public sealed record UserResponse(int Id, string Username, string Role, bool IsActive, DateTime CreatedUtc);

public sealed record CreateUserRequest(
    [Required, StringLength(50)] string Username,
    [Required, StringLength(128)] string Password,
    [Required, StringLength(20)] string Role);

public sealed record UpdateUserRequest(
    [Required, StringLength(20)] string Role,
    bool Active);

public sealed record ResetUserPasswordRequest(
    [Required, StringLength(128)] string Password);
