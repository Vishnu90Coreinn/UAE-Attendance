namespace HrPayroll.Api.Auth;

/// <summary>The password rules (A7): 10 to 128 characters and not the same as the username.</summary>
public static class PasswordPolicy
{
    public const int MinimumLength = 10;
    public const int MaximumLength = 128;

    /// <summary>Returns a message a user can act on, or null when the password is acceptable.</summary>
    public static string? Validate(string password, string username)
    {
        if (password.Length < MinimumLength)
        {
            return $"Password must be at least {MinimumLength} characters.";
        }

        if (password.Length > MaximumLength)
        {
            return $"Password must be at most {MaximumLength} characters.";
        }

        if (string.Equals(password, username, StringComparison.OrdinalIgnoreCase))
        {
            return "Password must not be the same as the username.";
        }

        return null;
    }
}
