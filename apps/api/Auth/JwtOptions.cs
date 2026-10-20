namespace HrPayroll.Api.Auth;

/// <summary>Bound from the <c>Jwt</c> configuration section. The key comes from the <c>Jwt__Key</c> environment variable.</summary>
public sealed class JwtOptions
{
    public const string SectionName = "Jwt";
    public const int MinimumKeyLength = 32;

    public string Issuer { get; set; } = "";
    public string Audience { get; set; } = "";
    public string Key { get; set; } = "";
    public double ExpiryHours { get; set; } = 8;
}
