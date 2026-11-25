using HrPayroll.Api.Auth;
using HrPayroll.Api.Data;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services.Finance;

/// <summary>Which office staff may submit expenses for a Manager's approval.</summary>
public sealed class FinanceSubmitterService(AppDbContext db, IAuditLogger audit)
{
    private static readonly string[] StaffRoles = [Roles.Employee, Roles.Supervisor, Roles.HR];

    public async Task<List<FinSubmitterResponse>> ListAsync(CancellationToken ct) =>
        await db.Users.AsNoTracking().Where(u => u.IsActive && StaffRoles.Contains(u.Role)).OrderBy(u => u.Username)
            .Select(u => new FinSubmitterResponse(u.Id, u.Username, u.Role, u.CanSubmitExpenses)).ToListAsync(ct);

    public async Task<FinResult<FinSubmitterResponse>> SetAsync(int userId, FinSubmitterRequest request, CancellationToken ct)
    {
        if (request.CanSubmit is not { } allowed) return FinResult<FinSubmitterResponse>.Invalid("canSubmit", "Choose on or off.");
        var user = await db.Users.SingleOrDefaultAsync(u => u.Id == userId && u.IsActive && StaffRoles.Contains(u.Role), ct);
        if (user is null) return FinResult<FinSubmitterResponse>.NotFound("That office login was not found.");
        if (user.CanSubmitExpenses != allowed)
        {
            user.CanSubmitExpenses = allowed;
            audit.Write("FinSubmitterChanged", entityType: "User", entityId: user.Id.ToString(), details: new { user.Username, canSubmit = allowed });
            await db.SaveChangesAsync(ct);
        }

        return FinResult<FinSubmitterResponse>.Ok(new(user.Id, user.Username, user.Role, user.CanSubmitExpenses));
    }
}
