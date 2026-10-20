using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace HrPayroll.Api.Tests.Helpers;

public static class TestTokens
{
    /// <summary>Reads the payload of a JWT without validating it.</summary>
    public static JsonElement Payload(string token)
    {
        var segment = token.Split('.')[1].Replace('-', '+').Replace('_', '/');
        segment = segment.PadRight(segment.Length + (4 - segment.Length % 4) % 4, '=');
        return JsonDocument.Parse(Convert.FromBase64String(segment)).RootElement.Clone();
    }

    /// <summary>Builds a signed token the way the API does, with every part adjustable so a test can break one.</summary>
    public static string Forge(
        int userId = 1,
        string username = "forged",
        string role = "Administrator",
        string key = ApiFactory.TestJwtKey,
        string issuer = "HrPayroll",
        string audience = "HrPayrollWeb",
        DateTime? notBeforeUtc = null,
        DateTime? expiresUtc = null)
    {
        var now = DateTime.UtcNow;
        var descriptor = new SecurityTokenDescriptor
        {
            Subject = new ClaimsIdentity(
            [
                new Claim(JwtRegisteredClaimNames.Sub, userId.ToString()),
                new Claim(ClaimTypes.Name, username),
                new Claim(ClaimTypes.Role, role),
            ]),
            Issuer = issuer,
            Audience = audience,
            NotBefore = notBeforeUtc ?? now.AddMinutes(-1),
            Expires = expiresUtc ?? now.AddHours(1),
            SigningCredentials = new SigningCredentials(
                new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)), SecurityAlgorithms.HmacSha256),
        };

        return new JsonWebTokenHandler().CreateToken(descriptor);
    }
}
