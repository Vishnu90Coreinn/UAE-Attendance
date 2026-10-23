using HrPayroll.Api.Auth;
using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Integration;

public class UserConstraintTests(TestDatabase database) : IClassFixture<TestDatabase>
{
    private AppDbContext NewContext() =>
        new(new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(database.ConnectionString).Options);

    private static User NewUser(string username, string role = Roles.Supervisor) =>
        new() { Username = username, PasswordHash = "hash", Role = role };

    [Fact]
    public async Task Username_IsUniqueCaseInsensitively()
    {
        var name = $"Admin{Guid.NewGuid():N}"[..20];
        await using var db = NewContext();
        db.Users.Add(NewUser(name));
        await db.SaveChangesAsync();

        await using var second = NewContext();
        second.Users.Add(NewUser(name.ToLowerInvariant()));

        await Assert.ThrowsAsync<DbUpdateException>(() => second.SaveChangesAsync());
    }

    [Fact]
    public async Task Role_OutsideTheThreeKnownRoles_IsRejected()
    {
        await using var db = NewContext();
        db.Users.Add(NewUser($"boss{Guid.NewGuid():N}"[..20], "Boss"));

        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Theory]
    [InlineData("HR Staff")]
    [InlineData("Viewer")]
    public async Task Role_RemovedRoles_AreRejectedByTheCheckConstraint(string role)
    {
        await using var db = NewContext();
        db.Users.Add(NewUser($"old{Guid.NewGuid():N}"[..20], role));

        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Theory]
    [InlineData("Administrator")]
    [InlineData("Manager")]
    [InlineData("Supervisor")]
    public async Task Role_EachKnownRole_IsAccepted(string role)
    {
        await using var db = NewContext();
        db.Users.Add(NewUser($"ok{Guid.NewGuid():N}"[..20], role));

        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task ValidUser_RoundTripsWithDefaults()
    {
        var name = $"round{Guid.NewGuid():N}"[..20];
        var before = DateTime.UtcNow.AddMinutes(-1);
        await using (var db = NewContext())
        {
            db.Users.Add(NewUser(name, Roles.Manager));
            await db.SaveChangesAsync();
        }

        await using var read = NewContext();
        var user = await read.Users.SingleAsync(u => u.Username == name.ToUpperInvariant());

        Assert.True(user.Id > 0);
        Assert.Equal(name, user.Username);
        Assert.Equal("hash", user.PasswordHash);
        Assert.Equal(Roles.Manager, user.Role);
        Assert.True(user.IsActive);
        Assert.Equal(0, user.FailedLoginCount);
        Assert.Null(user.LockoutEndUtc);
        Assert.True(user.CreatedUtc >= before && user.CreatedUtc <= DateTime.UtcNow.AddMinutes(1));
    }

    [Fact]
    public void Roles_All_ListsTheFourRoles()
    {
        Assert.Equal(new[] { "Administrator", "Manager", "Supervisor", "HR" }, Roles.All);
    }
}
