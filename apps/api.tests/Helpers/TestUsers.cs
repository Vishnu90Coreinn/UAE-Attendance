using System.Net.Http.Json;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Helpers;

/// <summary>Creates users directly in the test database and signs them in through the HTTP API.</summary>
public static class TestUsers
{
    public const string DefaultPassword = "Correct-Horse-Battery-1";

    public static string UniqueName(string prefix = "user") => $"{prefix}{Guid.NewGuid():N}"[..30];

    public static AppDbContext NewContext(string connectionString) =>
        new(new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(connectionString).Options);

    public static async Task<User> CreateAsync(
        string connectionString,
        string? username = null,
        string password = DefaultPassword,
        string role = Roles.Supervisor,
        bool isActive = true,
        int failedLoginCount = 0,
        DateTime? lockoutEndUtc = null)
    {
        var user = new User
        {
            Username = username ?? UniqueName(),
            Role = role,
            IsActive = isActive,
            FailedLoginCount = failedLoginCount,
            LockoutEndUtc = lockoutEndUtc,
        };
        user.PasswordHash = new PasswordHasher<User>().HashPassword(user, password);

        await using var db = NewContext(connectionString);
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user;
    }

    public static async Task<User> ReloadAsync(string connectionString, int id)
    {
        await using var db = NewContext(connectionString);
        return await db.Users.AsNoTracking().SingleAsync(u => u.Id == id);
    }

    /// <summary>Signs in through <c>POST /api/auth/login</c> and returns the bearer token.</summary>
    public static async Task<string> LoginAsync(HttpClient client, string username, string password = DefaultPassword)
    {
        var response = await client.PostAsJsonAsync("/api/auth/login", new { username, password });
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("token").GetString()!;
    }
}
