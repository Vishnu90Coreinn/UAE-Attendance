namespace HrPayroll.Api.Auth;

public static class Roles
{
    public const string Administrator = "Administrator";
    public const string HrStaff = "HR Staff";
    public const string Viewer = "Viewer";

    public static readonly string[] All = [Administrator, HrStaff, Viewer];
}
