using HrPayroll.Api.Auth;
using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services;

/// <summary>
/// First-run administrator (A12). Creates the initial Administrator from <c>Seed:AdminUsername</c> and
/// <c>Seed:AdminPassword</c> when, and only when, the Users table is empty. The password is never logged,
/// audited or stored in clear text, and no default password exists anywhere.
/// </summary>
public class AdminSeeder(
    AppDbContext db,
    IPasswordHasher<User> passwordHasher,
    IAuditLogger audit,
    IConfiguration configuration,
    IHostEnvironment environment,
    ILogger<AdminSeeder> logger)
{
    private const int MaxUsernameLength = 50;
    private const string SystemActor = "system";

    public async Task SeedAsync(CancellationToken cancellationToken = default)
    {
        if (await db.Users.AnyAsync(cancellationToken))
        {
            return;
        }

        var username = configuration["Seed:AdminUsername"]?.Trim();
        var password = configuration["Seed:AdminPassword"];

        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password))
        {
            if (environment.IsProduction())
            {
                throw new InvalidOperationException(
                    "No users exist. Set Seed__AdminUsername and Seed__AdminPassword for the first start.");
            }

            logger.LogWarning(
                "No users exist and no first administrator is configured. Set Seed:AdminUsername and Seed:AdminPassword "
                + "(for development: dotnet user-secrets) to create one.");
            return;
        }

        if (username.Length > MaxUsernameLength)
        {
            throw new InvalidOperationException(
                $"Seed:AdminUsername must be at most {MaxUsernameLength} characters.");
        }

        var violation = PasswordPolicy.Validate(password, username);
        if (violation is not null)
        {
            throw new InvalidOperationException($"Seed:AdminPassword is not acceptable. {violation}");
        }

        var user = new User
        {
            Username = username,
            Role = Roles.Administrator,
            IsActive = true,
            CreatedUtc = DateTime.UtcNow,
        };
        user.PasswordHash = passwordHasher.HashPassword(user, password);

        db.Users.Add(user);
        audit.Write("AdminSeeded", SystemActor, nameof(User), details: new { Username = username });
        await db.SaveChangesAsync(cancellationToken);

        logger.LogInformation("Created the first administrator '{Username}'. Remove the Seed settings now.", username);
    }

    /// <summary>
    /// Seeds only when the database can be reached and has no pending migrations. Otherwise the start-up continues
    /// (the health endpoint reports an unreachable database) and the seeding happens on a later start.
    /// </summary>
    public async Task SeedWhenReadyAsync(CancellationToken cancellationToken = default)
    {
        if (!await db.Database.CanConnectAsync(cancellationToken))
        {
            logger.LogWarning("Skipping first-run administrator check: the database is not reachable.");
            return;
        }

        if ((await db.Database.GetPendingMigrationsAsync(cancellationToken)).Any())
        {
            logger.LogWarning("Skipping first-run administrator check: the database has pending migrations.");
            return;
        }

        await SeedAsync(cancellationToken);
    }
}
