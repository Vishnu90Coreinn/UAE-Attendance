namespace HrPayroll.Api.Auth;

/// <summary>Rate limiter policy names. The policies themselves are registered in Program.cs.</summary>
public static class RateLimitPolicies
{
    public const string Login = "login";
}
