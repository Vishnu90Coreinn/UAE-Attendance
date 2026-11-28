using System.Security.Claims;
using HrPayroll.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Auth;

public sealed class FinanceSubmitRequirement : IAuthorizationRequirement;

/// <summary>
/// Lets a Manager or Administrator through, and office staff (Employee, Supervisor, HR) only while a Manager has switched on
/// "can submit expenses" for them. The flag is read from the database each time, so switching it off takes effect at once.
/// A Viewer (the Partner) never passes.
/// </summary>
public sealed class FinanceSubmitHandler(AppDbContext db) : AuthorizationHandler<FinanceSubmitRequirement>
{
    protected override async Task HandleRequirementAsync(AuthorizationHandlerContext context, FinanceSubmitRequirement requirement)
    {
        var user = context.User;
        if (user.IsInRole(Roles.Administrator) || user.IsInRole(Roles.Manager))
        {
            context.Succeed(requirement);
            return;
        }

        if (!(user.IsInRole(Roles.Employee) || user.IsInRole(Roles.Supervisor) || user.IsInRole(Roles.HR))) return;
        if (!int.TryParse(user.FindFirstValue("sub"), out var id)) return;
        if (await db.Users.AsNoTracking().AnyAsync(u => u.Id == id && u.IsActive && u.CanSubmitExpenses)) context.Succeed(requirement);
    }
}
