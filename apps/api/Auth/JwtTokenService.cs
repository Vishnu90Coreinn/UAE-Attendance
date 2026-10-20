using System.Security.Claims;
using System.Text;
using HrPayroll.Api.Data.Entities;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace HrPayroll.Api.Auth;

/// <summary>Issues HS256 access tokens carrying the user id (<c>sub</c>), user name and role.</summary>
public sealed class JwtTokenService(IOptions<JwtOptions> options, TimeProvider time)
{
    public (string Token, DateTime ExpiresUtc) CreateToken(User user)
    {
        var settings = options.Value;
        var now = time.GetUtcNow().UtcDateTime;
        var expires = now.AddHours(settings.ExpiryHours);

        var descriptor = new SecurityTokenDescriptor
        {
            Subject = new ClaimsIdentity(
            [
                new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
                new Claim(ClaimTypes.Name, user.Username),
                new Claim(ClaimTypes.Role, user.Role),
            ]),
            Issuer = settings.Issuer,
            Audience = settings.Audience,
            IssuedAt = now,
            NotBefore = now,
            Expires = expires,
            SigningCredentials = new SigningCredentials(
                new SymmetricSecurityKey(Encoding.UTF8.GetBytes(settings.Key)), SecurityAlgorithms.HmacSha256),
        };

        return (new JsonWebTokenHandler().CreateToken(descriptor), expires);
    }
}
