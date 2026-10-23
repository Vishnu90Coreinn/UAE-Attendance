using System.Data;
using System.Globalization;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace HrPayroll.Api.Services;

public enum UserOutcome { Success, Invalid, NotFound, Conflict, Forbidden }

public sealed record UserResult(
    UserOutcome Outcome,
    UserResponse? User = null,
    IReadOnlyDictionary<string, string>? Errors = null,
    string? Message = null)
{
    public bool Succeeded => Outcome == UserOutcome.Success;
}

public sealed class UserService(
    AppDbContext db,
    IPasswordHasher<User> passwordHasher,
    IAuditLogger audit,
    TimeProvider time)
{
    public const string SelfMutationMessage = "You cannot delete or deactivate your own account.";
    public const string LastAdministratorMessage = "At least one active Administrator account is required.";
    public const string DuplicateUsernameMessage = "Username already exists.";
    public const string SupervisorsOnlyMessage = "Managers can manage Supervisor and HR accounts only.";

    /// <summary>An Administrator sees every account; a Manager sees Supervisor and HR accounts only.</summary>
    public async Task<List<UserResponse>> ListAsync(bool administrator, CancellationToken ct) =>
        (await db.Users.AsNoTracking().Where(x => administrator || x.Role == Roles.Supervisor || x.Role == Roles.HR).OrderBy(x => x.Username).ToListAsync(ct)).Select(Response).ToList();

    public async Task<UserResult> CreateAsync(CreateUserRequest request, string actor, bool administrator, CancellationToken ct)
    {
        var username = request.Username.Trim();
        var errors = Validate(username, request.Password, request.Role, validatePassword: true);
        if (errors.Count > 0) return Invalid(errors);
        if (!administrator && !IsManagerAssignable(request.Role)) return Forbidden();

        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        await LockAsync(ct);
        if (await db.Users.AnyAsync(x => x.Username == username, ct))
            return Invalid(new() { ["username"] = DuplicateUsernameMessage });

        var user = new User
        {
            Username = username,
            Role = request.Role,
            IsActive = true,
            CreatedUtc = time.GetUtcNow().UtcDateTime,
        };
        user.PasswordHash = passwordHasher.HashPassword(user, request.Password);
        db.Users.Add(user);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException exception) when (IsUniqueViolation(exception))
        {
            return Invalid(new() { ["username"] = DuplicateUsernameMessage });
        }

        audit.Write("UserCreated", actor, nameof(User), Id(user), new { username, role = user.Role, isActive = true });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return new(UserOutcome.Success, Response(user));
    }

    public async Task<UserResult> UpdateAsync(int id, UpdateUserRequest request, int actorId, string actor, bool administrator, CancellationToken ct)
    {
        var errors = Validate(null, null, request.Role, validatePassword: false);
        if (errors.Count > 0) return Invalid(errors);

        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        await LockAsync(ct);
        var user = await db.Users.SingleOrDefaultAsync(x => x.Id == id, ct);
        if (user is null) return new(UserOutcome.NotFound);
        if (!administrator && (!IsManagerAssignable(user.Role) || !IsManagerAssignable(request.Role))) return Forbidden();
        if (id == actorId && !request.Active) return new(UserOutcome.Conflict, Message: SelfMutationMessage);
        if (RemovesActiveAdministrator(user, request.Role, request.Active) &&
            !await db.Users.AnyAsync(x => x.Id != id && x.IsActive && x.Role == Roles.Administrator, ct))
            return new(UserOutcome.Conflict, Message: LastAdministratorMessage);

        var roleChanged = !string.Equals(user.Role, request.Role, StringComparison.Ordinal);
        var activeChanged = user.IsActive != request.Active;
        if (!roleChanged && !activeChanged) return new(UserOutcome.Success, Response(user));

        if (roleChanged)
        {
            var previous = user.Role;
            user.Role = request.Role;
            audit.Write("UserRoleChanged", actor, nameof(User), Id(user),
                new { username = user.Username, oldRole = previous, newRole = user.Role });
        }
        if (activeChanged)
        {
            user.IsActive = request.Active;
            user.FailedLoginCount = 0;
            user.LockoutEndUtc = null;
            audit.Write(user.IsActive ? "UserActivated" : "UserDeactivated", actor, nameof(User), Id(user),
                new { username = user.Username });
        }

        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return new(UserOutcome.Success, Response(user));
    }

    public async Task<UserResult> ResetPasswordAsync(int id, ResetUserPasswordRequest request, string actor, bool administrator, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        await LockAsync(ct);
        var user = await db.Users.SingleOrDefaultAsync(x => x.Id == id, ct);
        if (user is null) return new(UserOutcome.NotFound);
        if (!administrator && !IsManagerAssignable(user.Role)) return Forbidden();
        var error = PasswordPolicy.Validate(request.Password, user.Username);
        if (error is not null) return Invalid(new() { ["password"] = error });

        user.PasswordHash = passwordHasher.HashPassword(user, request.Password);
        user.FailedLoginCount = 0;
        user.LockoutEndUtc = null;
        audit.Write("PasswordReset", actor, nameof(User), Id(user), new { username = user.Username });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return new(UserOutcome.Success);
    }

    public async Task<UserResult> DeleteAsync(int id, int actorId, string actor, bool administrator, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        await LockAsync(ct);
        var user = await db.Users.SingleOrDefaultAsync(x => x.Id == id, ct);
        if (user is null) return new(UserOutcome.NotFound);
        if (!administrator && !IsManagerAssignable(user.Role)) return Forbidden();
        if (id == actorId) return new(UserOutcome.Conflict, Message: SelfMutationMessage);
        if (user.IsActive && user.Role == Roles.Administrator &&
            !await db.Users.AnyAsync(x => x.Id != id && x.IsActive && x.Role == Roles.Administrator, ct))
            return new(UserOutcome.Conflict, Message: LastAdministratorMessage);

        audit.Write("UserDeleted", actor, nameof(User), Id(user),
            new { username = user.Username, role = user.Role, isActive = user.IsActive });
        db.Users.Remove(user);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return new(UserOutcome.Success);
    }

    private static Dictionary<string, string> Validate(string? username, string? password, string role, bool validatePassword)
    {
        var errors = new Dictionary<string, string>();
        if (username is not null && username.Length == 0) errors["username"] = "Username is required.";
        if (!Roles.All.Contains(role)) errors["role"] = "Select a valid role.";
        if (validatePassword && password is not null && username is not null)
        {
            var error = PasswordPolicy.Validate(password, username);
            if (error is not null) errors["password"] = error;
        }
        return errors;
    }

    private async Task LockAsync(CancellationToken ct)
    {
        await using var command = db.Database.GetDbConnection().CreateCommand();
        command.Transaction = db.Database.CurrentTransaction!.GetDbTransaction();
        command.CommandText = "DECLARE @result int; EXEC @result = sys.sp_getapplock @Resource = 'UserAdministration', @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 3000; SELECT @result;";
        if (Convert.ToInt32(await command.ExecuteScalarAsync(ct), CultureInfo.InvariantCulture) < 0)
            throw new InvalidOperationException("User administration is busy. Try again.");
    }

    private static bool RemovesActiveAdministrator(User user, string role, bool active) =>
        user.IsActive && user.Role == Roles.Administrator && (!active || role != Roles.Administrator);
    private static UserResult Invalid(Dictionary<string, string> errors) => new(UserOutcome.Invalid, Errors: errors);
    private static bool IsManagerAssignable(string role) => role is Roles.Supervisor or Roles.HR;

    private static UserResult Forbidden() => new(UserOutcome.Forbidden, Message: SupervisorsOnlyMessage);
    private static string Id(User user) => user.Id.ToString(CultureInfo.InvariantCulture);
    private static UserResponse Response(User user) =>
        new(user.Id, user.Username, user.Role, user.IsActive, DateTime.SpecifyKind(user.CreatedUtc, DateTimeKind.Utc));
    private static bool IsUniqueViolation(Exception exception)
    {
        for (Exception? current = exception; current is not null; current = current.InnerException)
            if (current is SqlException { Number: 2601 or 2627 }) return true;
        return false;
    }
}
