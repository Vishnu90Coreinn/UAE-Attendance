using System.Text.Json;
using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Helpers;

/// <summary>Creates workers directly in the test database and signs in users of a given role.</summary>
public static class TestWorkers
{
    /// <summary>A unique, valid worker code of exactly 20 characters.</summary>
    public static string UniqueCode() => $"W{Guid.NewGuid():N}"[..20];

    public static async Task<Worker> CreateAsync(
        string connectionString,
        string? workerCode = null,
        string fullName = "Test Worker",
        string designation = "Glass Installer",
        decimal hourlyRate = 12.5m,
        bool isActive = true)
    {
        var now = DateTime.UtcNow;
        var worker = new Worker
        {
            WorkerCode = workerCode ?? UniqueCode(),
            FullName = fullName,
            Designation = designation,
            HourlyRate = hourlyRate,
            IsActive = isActive,
            CreatedUtc = now,
            UpdatedUtc = now,
        };

        await using var db = TestUsers.NewContext(connectionString);
        db.Workers.Add(worker);
        await db.SaveChangesAsync();
        return worker;
    }

    public static async Task<Worker?> FindAsync(string connectionString, int id)
    {
        await using var db = TestUsers.NewContext(connectionString);
        return await db.Workers.AsNoTracking().SingleOrDefaultAsync(w => w.Id == id);
    }

    public static async Task DeleteAllAsync(string connectionString)
    {
        await using var db = TestUsers.NewContext(connectionString);
        await db.Workers.ExecuteDeleteAsync();
    }

    /// <summary>Creates a user with the given role and returns the username and a bearer token.</summary>
    public static async Task<(string Username, string Token)> SignInAsync(ApiFixture api, string role)
    {
        var user = await TestUsers.CreateAsync(api.ConnectionString, role: role);
        var token = await TestUsers.LoginAsync(api.Client, user.Username);
        return (user.Username, token);
    }

    /// <summary>
    /// Asserts a 404 that came from the controller (a problem document), not from a route that does not exist,
    /// which answers with an empty body.
    /// </summary>
    public static async Task AssertWorkerNotFoundAsync(HttpResponseMessage response)
    {
        Assert.Equal(System.Net.HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal(404, (await ReadJsonAsync(response)).GetProperty("status").GetInt32());
    }

    public static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.Clone();
}
