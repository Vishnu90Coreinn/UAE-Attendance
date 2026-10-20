namespace HrPayroll.Api.Auth;

/// <summary>Authorization policy names. The policies themselves are registered in Program.cs.</summary>
public static class Policies
{
    public const string AnyUser = "AnyUser";
    public const string HrOrAdmin = "HrOrAdmin";
    public const string AdminOnly = "AdminOnly";
}
