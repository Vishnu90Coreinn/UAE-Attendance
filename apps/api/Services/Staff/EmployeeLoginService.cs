using System.Globalization;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services.Staff;

/// <summary>Gives an office employee a login: either a brand-new account with the Employee role, or an existing account (an HR user, say) linked to them.</summary>
public sealed class EmployeeLoginService(AppDbContext db, IPasswordHasher<User> hasher, IAuditLogger audit, TimeProvider time)
{
    public async Task<List<StaffLinkableUser>> LinkableAsync(CancellationToken ct) =>
        (await db.Users.AsNoTracking()
            .Where(u => u.IsActive && u.Role != Roles.Administrator && !db.Workers.Any(w => w.UserId == u.Id))
            .OrderBy(u => u.Username).ToListAsync(ct))
        .Select(u => new StaffLinkableUser(u.Id, u.Username, u.Role)).ToList();

    public async Task<StaffResult<StaffLinkableUser>> SetLoginAsync(int workerId, EmployeeLoginRequest request, CancellationToken ct)
    {
        var worker = await db.Workers.SingleOrDefaultAsync(w => w.Id == workerId, ct);
        if (worker is null || worker.Category != WorkerCategories.Employee)
            return StaffResult<StaffLinkableUser>.NotFound("Office employee not found.");
        if (worker.UserId is not null) return StaffResult<StaffLinkableUser>.Conflict("This employee already has a login.");

        User user;
        if (request.LinkUserId is { } linkId)
        {
            var existing = await db.Users.SingleOrDefaultAsync(u => u.Id == linkId, ct);
            if (existing is null || !existing.IsActive || existing.Role == Roles.Administrator)
                return StaffResult<StaffLinkableUser>.Invalid("linkUserId", "Choose an active account.");
            if (await db.Workers.AnyAsync(w => w.UserId == linkId, ct))
                return StaffResult<StaffLinkableUser>.Invalid("linkUserId", "That account is already linked to someone.");
            user = existing;
        }
        else
        {
            var username = (request.Username ?? "").Trim();
            if (username.Length == 0) return StaffResult<StaffLinkableUser>.Invalid("username", "Username is required.");
            if (username.Length > 50) return StaffResult<StaffLinkableUser>.Invalid("username", "Username must be 50 characters or fewer.");
            var passwordError = PasswordPolicy.Validate(request.Password ?? "", username);
            if (passwordError is not null) return StaffResult<StaffLinkableUser>.Invalid("password", passwordError);
            if (await db.Users.AnyAsync(u => u.Username == username, ct))
                return StaffResult<StaffLinkableUser>.Invalid("username", UserService.DuplicateUsernameMessage);

            user = new User { Username = username, Role = Roles.Employee, IsActive = true, CreatedUtc = time.GetUtcNow().UtcDateTime };
            user.PasswordHash = hasher.HashPassword(user, request.Password!);
            db.Users.Add(user);
            await db.SaveChangesAsync(ct);
            audit.Write("UserCreated", entityType: nameof(User), entityId: user.Id.ToString(CultureInfo.InvariantCulture),
                details: new { username, role = user.Role, isActive = true });
        }

        worker.UserId = user.Id;
        worker.UpdatedUtc = time.GetUtcNow().UtcDateTime;
        audit.Write("EmployeeLoginLinked", entityType: nameof(Worker), entityId: worker.Id.ToString(CultureInfo.InvariantCulture),
            details: new { username = user.Username, role = user.Role });
        await db.SaveChangesAsync(ct);
        return StaffResult<StaffLinkableUser>.Ok(new(user.Id, user.Username, user.Role));
    }

    /// <summary>Unlinks the login. The account itself stays; the employee can no longer sign in to office attendance.</summary>
    public async Task<bool> RemoveLoginAsync(int workerId, CancellationToken ct)
    {
        var worker = await db.Workers.SingleOrDefaultAsync(w => w.Id == workerId && w.UserId != null, ct);
        if (worker is null) return false;
        worker.UserId = null;
        worker.UpdatedUtc = time.GetUtcNow().UtcDateTime;
        audit.Write("EmployeeLoginUnlinked", entityType: nameof(Worker), entityId: worker.Id.ToString(CultureInfo.InvariantCulture));
        await db.SaveChangesAsync(ct);
        return true;
    }
}
