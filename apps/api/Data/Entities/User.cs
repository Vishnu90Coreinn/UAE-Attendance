namespace HrPayroll.Api.Data.Entities;

public class User
{
    public int Id { get; set; }
    public string Username { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public string Role { get; set; } = "";
    public bool IsActive { get; set; } = true;

    /// <summary>Office staff a Manager has allowed to submit expenses for approval (see Finance). Managers and Administrators need no flag.</summary>
    public bool CanSubmitExpenses { get; set; }
    public int FailedLoginCount { get; set; }

    /// <summary>Goes up when the password changes. Each sign-in token carries the number it was issued with, so older tokens stop working.</summary>
    public int SecurityStamp { get; set; }
    public DateTime? LockoutEndUtc { get; set; }
    public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
}
