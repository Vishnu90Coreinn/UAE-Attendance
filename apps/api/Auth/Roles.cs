namespace HrPayroll.Api.Auth;

public static class Roles
{
    /// <summary>The superuser: everything is always allowed.</summary>
    public const string Administrator = "Administrator";

    /// <summary>The everyday boss: manages workers, approves leave, runs payroll and manages supervisor accounts.</summary>
    public const string Manager = "Manager";

    /// <summary>A site supervisor: enters attendance and raises leave; never sees pay.</summary>
    public const string Supervisor = "Supervisor";

    public static readonly string[] All = [Administrator, Manager, Supervisor];
}
