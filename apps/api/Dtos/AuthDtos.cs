using System.ComponentModel.DataAnnotations;

namespace HrPayroll.Api.Dtos;

// Validation attributes sit on the record's constructor parameters, which is where MVC looks for them.
public sealed record LoginRequest(
    [Required, MaxLength(50)] string Username,
    [Required, MaxLength(128)] string Password);

public sealed record ChangePasswordRequest(
    [Required, MaxLength(128)] string CurrentPassword,
    [Required, MaxLength(128)] string NewPassword);

/// <summary><c>EmployeeId</c> is the office employee record linked to this login, or null; it decides whether My Attendance and My Leave show.</summary>
public sealed record CurrentUserResponse(int Id, string Username, string Role, int? EmployeeId = null);

public sealed record LoginResponse(string Token, DateTime ExpiresUtc, CurrentUserResponse User);
