using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services;

public enum LoginOutcome
{
    Success,
    InvalidCredentials,
    Locked,
}

/// <summary>
/// Result of a sign-in attempt. <see cref="User"/> is set only for <see cref="LoginOutcome.Success"/>;
/// every failure cause other than a lockout is deliberately the same <see cref="LoginOutcome.InvalidCredentials"/>.
/// </summary>
public sealed record LoginResult(LoginOutcome Outcome, User? User = null)
{
    public bool Succeeded => Outcome == LoginOutcome.Success;
}

public class AuthService(
    AppDbContext db,
    IPasswordHasher<User> passwordHasher,
    IAuditLogger audit,
    TimeProvider time,
    ILogger<AuthService> logger)
{
    public const int MaxFailedAttempts = 5;
    public static readonly TimeSpan LockoutDuration = TimeSpan.FromMinutes(15);

    private const int MaxActorLength = 50;

    // A real PBKDF2 hash (same format and cost as the ones we store) of a throw-away value, used so a
    // login for an unknown user costs the same as one for a known user.
    private const string DummyPasswordHash = "AQAAAAIAAYagAAAAECSHsvI4p0wEkYpAXCgB+sJPiAFpmuSE62gn3KFweGTF/p2RL0EdYIN6f0gJ9tqeDA==";

    public async Task<LoginResult> LoginAsync(string username, string password, CancellationToken cancellationToken = default)
    {
        var now = time.GetUtcNow().UtcDateTime;
        var attempted = Truncate(username);

        // Username is a case-insensitive column, so this comparison is case-insensitive in SQL Server.
        var user = await db.Users.SingleOrDefaultAsync(u => u.Username == username, cancellationToken);

        if (user is null)
        {
            passwordHasher.VerifyHashedPassword(null!, DummyPasswordHash, password);
            return await FailAsync(attempted, entity: null, "UnknownUser", cancellationToken);
        }

        if (!user.IsActive)
        {
            // Still pay for a verification so an inactive account is indistinguishable by timing.
            passwordHasher.VerifyHashedPassword(user, user.PasswordHash, password);
            return await FailAsync(attempted, user, "Inactive", cancellationToken);
        }

        if (user.LockoutEndUtc is { } lockoutEnd)
        {
            if (lockoutEnd > now)
            {
                // Locked: the password is not even looked at, so it cannot be guessed while the lock lasts.
                audit.Write("LoginFailed", attempted, nameof(User), user.Id.ToString(), new { Reason = "Locked" });
                await db.SaveChangesAsync(cancellationToken);
                return new LoginResult(LoginOutcome.Locked);
            }

            // An expired lockout behaves as unlocked, with a fresh count.
            user.LockoutEndUtc = null;
            user.FailedLoginCount = 0;
        }

        var verification = passwordHasher.VerifyHashedPassword(user, user.PasswordHash, password);
        if (verification == PasswordVerificationResult.Failed)
        {
            user.FailedLoginCount++;
            if (user.FailedLoginCount >= MaxFailedAttempts)
            {
                user.LockoutEndUtc = now.Add(LockoutDuration);
                audit.Write("AccountLocked", attempted, nameof(User), user.Id.ToString(),
                    new { user.FailedLoginCount, LockoutMinutes = (int)LockoutDuration.TotalMinutes });
                logger.LogWarning("User {UserId} locked for {Minutes} minutes after {Failures} failed sign-ins",
                    user.Id, (int)LockoutDuration.TotalMinutes, user.FailedLoginCount);
            }

            return await FailAsync(attempted, user, "WrongPassword", cancellationToken);
        }

        user.FailedLoginCount = 0;
        user.LockoutEndUtc = null;
        audit.Write("LoginSucceeded", user.Username, nameof(User), user.Id.ToString());
        await db.SaveChangesAsync(cancellationToken);
        return new LoginResult(LoginOutcome.Success, user);
    }

    private async Task<LoginResult> FailAsync(
        string attemptedUsername, User? entity, string reason, CancellationToken cancellationToken)
    {
        audit.Write("LoginFailed", attemptedUsername, entity is null ? null : nameof(User), entity?.Id.ToString(), new { Reason = reason });
        await db.SaveChangesAsync(cancellationToken);
        return new LoginResult(LoginOutcome.InvalidCredentials);
    }

    private static string Truncate(string value) =>
        value.Length <= MaxActorLength ? value : value[..MaxActorLength];
}
