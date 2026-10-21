using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Services;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>Calls <see cref="AuthService"/> directly for what the HTTP layer cannot reach (long names, log output).</summary>
public class AuthServiceTests(TestDatabase database) : IClassFixture<TestDatabase>
{
    private sealed class Scope : IAsyncDisposable
    {
        public Scope(string connectionString)
        {
            Db = TestUsers.NewContext(connectionString);
            Logger = new CapturingLogger<AuthService>();
            Service = new AuthService(
                Db, new PasswordHasher<User>(), new AuditLogger(Db, new HttpContextAccessor()), TimeProvider.System, Logger);
        }

        public AppDbContext Db { get; }
        public CapturingLogger<AuthService> Logger { get; }
        public AuthService Service { get; }

        public ValueTask DisposeAsync() => Db.DisposeAsync();
    }

    [Fact]
    public async Task Login_AttemptedUsernameLongerThanTheActorColumn_IsTruncatedTo50Characters()
    {
        await using var scope = new Scope(database.ConnectionString);
        var longName = new string('x', 80);

        var result = await scope.Service.LoginAsync(longName, "whatever-password");

        Assert.Equal(LoginOutcome.InvalidCredentials, result.Outcome);
        await using var read = TestUsers.NewContext(database.ConnectionString);
        var row = await read.AuditLogs.SingleAsync(a => a.Action == "LoginFailed" && a.ActorUsername!.StartsWith("xxxxxxxxxx"));
        Assert.Equal(50, row.ActorUsername!.Length);
    }

    [Fact]
    public async Task Login_NeverWritesThePasswordToTheLog()
    {
        var secret = $"Secret-{Guid.NewGuid():N}";
        var wrong = $"Wrong-{Guid.NewGuid():N}";
        var user = await TestUsers.CreateAsync(database.ConnectionString, password: secret);
        await using var scope = new Scope(database.ConnectionString);

        for (var attempt = 1; attempt <= 5; attempt++)
        {
            await scope.Service.LoginAsync(user.Username, wrong);
        }

        await scope.Service.LoginAsync(user.Username, secret); // locked
        await scope.Service.LoginAsync(TestUsers.UniqueName("ghost"), wrong);

        Assert.NotEmpty(scope.Logger.Entries); // the lockout is logged, so the check below is not vacuous
        foreach (var entry in scope.Logger.Entries)
        {
            Assert.DoesNotContain(secret, entry.Message);
            Assert.DoesNotContain(wrong, entry.Message);
            Assert.DoesNotContain(user.PasswordHash, entry.Message);
        }
    }

    [Fact]
    public async Task Login_Success_ReturnsTheUser()
    {
        var user = await TestUsers.CreateAsync(database.ConnectionString);
        await using var scope = new Scope(database.ConnectionString);

        var result = await scope.Service.LoginAsync(user.Username.ToUpperInvariant(), TestUsers.DefaultPassword);

        Assert.True(result.Succeeded);
        Assert.Equal(user.Id, result.User!.Id);
    }
}
