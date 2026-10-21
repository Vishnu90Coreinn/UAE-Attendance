namespace HrPayroll.Api.Auth;

/// <summary>Authorization policy names. The policies themselves are registered in Program.cs.</summary>
public static class Policies
{
    public const string AnyUser = "AnyUser";
    public const string AdminOnly = "AdminOnly";

    /// <summary>Manager or Administrator: management actions (workers, leave decisions, payroll, settings, users).</summary>
    public const string ManagerOrAdmin = "ManagerOrAdmin";

    /// <summary>Supervisor, Manager or Administrator: entering attendance and raising leave.</summary>
    public const string SupervisorOrAbove = "SupervisorOrAbove";
}
