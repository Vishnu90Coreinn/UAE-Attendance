using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services.Finance;

/// <summary>The people and companies the business pays or is paid by. Saved once, picked on the entry form, switched off and never deleted.</summary>
public sealed class FinancePayeeService(AppDbContext db, IAuditLogger audit, TimeProvider time)
{
    private async Task<List<FinPayeeResponse>> ProjectAsync(IQueryable<FinPayee> payees, CancellationToken ct)
    {
        var rows = await payees.OrderBy(p => p.Name).ToListAsync(ct);
        var ids = rows.Select(r => r.Id).ToList();
        var uses = (await db.FinEntries.AsNoTracking().Where(e => e.PayeeId != null && ids.Contains(e.PayeeId.Value) && e.Status == FinStatuses.Active)
            .GroupBy(e => e.PayeeId!.Value).Select(g => new { Id = g.Key, Count = g.Count(), Sum = g.Sum(e => e.Amount) }).ToListAsync(ct)).ToDictionary(x => x.Id);
        var categoryIds = rows.Where(r => r.DefaultCategoryId != null).Select(r => r.DefaultCategoryId!.Value).Distinct().ToList();
        var categories = await db.FinCategories.AsNoTracking().Where(c => categoryIds.Contains(c.Id)).ToDictionaryAsync(c => c.Id, c => c.Name, ct);
        return rows.Select(p => new FinPayeeResponse(
            p.Id, p.Kind, p.Name, p.DefaultCategoryId, p.DefaultCategoryId is { } c ? categories.GetValueOrDefault(c) : null, p.Phone, p.TaxNumber, p.Notes, p.IsActive,
            uses.TryGetValue(p.Id, out var u) ? u.Count : 0, uses.TryGetValue(p.Id, out var u2) ? u2.Sum : 0m)).ToList();
    }

    public Task<List<FinPayeeResponse>> ListAsync(string? kind, bool includeInactive, CancellationToken ct)
    {
        var query = db.FinPayees.AsNoTracking().AsQueryable();
        if (kind is not null) query = query.Where(p => p.Kind == kind);
        if (!includeInactive) query = query.Where(p => p.IsActive);
        return ProjectAsync(query, ct);
    }

    private async Task<Dictionary<string, string[]>> ValidateAsync(FinPayeeRequest request, string? kind, string? name, int? existingId, CancellationToken ct)
    {
        var errors = new Dictionary<string, string[]>();
        if (name is null) errors["name"] = ["Enter the name."];
        else if (name.Length > 120) errors["name"] = ["Use 120 characters or fewer."];
        if (kind is null || !FinEntryKinds.All.Contains(kind)) errors["kind"] = ["Choose Expense (paid to) or Income (received from)."];
        if (FinanceRules.Clean(request.Phone)?.Length > 40) errors["phone"] = ["Use 40 characters or fewer."];
        if (FinanceRules.Clean(request.TaxNumber)?.Length > 40) errors["taxNumber"] = ["Use 40 characters or fewer."];
        if (FinanceRules.Clean(request.Notes)?.Length > 500) errors["notes"] = ["Use 500 characters or fewer."];
        if (request.DefaultCategoryId is { } categoryId && kind is not null)
        {
            var category = await db.FinCategories.AsNoTracking().SingleOrDefaultAsync(c => c.Id == categoryId && c.Kind == kind, ct);
            if (category is null || !category.IsActive) errors["defaultCategoryId"] = ["Choose an active category of the same type."];
        }

        if (errors.Count == 0 && await db.FinPayees.AnyAsync(p => p.Kind == kind && p.Name == name && p.Id != existingId, ct))
            errors["name"] = ["This payee already exists."];
        return errors;
    }

    public async Task<FinResult<FinPayeeResponse>> CreateAsync(FinPayeeRequest request, CancellationToken ct)
    {
        var name = FinanceRules.Clean(request.Name);
        var errors = await ValidateAsync(request, request.Kind, name, null, ct);
        if (errors.Count > 0) return FinResult<FinPayeeResponse>.Invalid(errors);

        var payee = new FinPayee
        {
            Kind = request.Kind!, Name = name!, DefaultCategoryId = request.DefaultCategoryId, Phone = FinanceRules.Clean(request.Phone),
            TaxNumber = FinanceRules.Clean(request.TaxNumber), Notes = FinanceRules.Clean(request.Notes), CreatedUtc = time.GetUtcNow().UtcDateTime,
        };
        db.FinPayees.Add(payee);
        try
        {
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            await db.SaveChangesAsync(ct);
            audit.Write("FinPayeeCreated", entityType: nameof(FinPayee), entityId: payee.Id.ToString(), details: new { payee.Kind, payee.Name });
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        }
        catch (DbUpdateException ex) when (FinanceRules.IsDuplicate(ex))
        {
            return FinResult<FinPayeeResponse>.Invalid("name", "This payee already exists.");
        }

        return FinResult<FinPayeeResponse>.Created((await ProjectAsync(db.FinPayees.AsNoTracking().Where(p => p.Id == payee.Id), ct)).Single());
    }

    public async Task<FinResult<FinPayeeResponse>> UpdateAsync(int id, FinPayeeRequest request, CancellationToken ct)
    {
        var payee = await db.FinPayees.SingleOrDefaultAsync(p => p.Id == id, ct);
        if (payee is null) return FinResult<FinPayeeResponse>.NotFound("Payee not found.");
        var name = FinanceRules.Clean(request.Name);
        var errors = await ValidateAsync(request, payee.Kind, name, id, ct);
        if (errors.Count > 0) return FinResult<FinPayeeResponse>.Invalid(errors);

        var before = new { payee.Name, payee.DefaultCategoryId, payee.IsActive };
        payee.Name = name!;
        payee.DefaultCategoryId = request.DefaultCategoryId;
        payee.Phone = FinanceRules.Clean(request.Phone);
        payee.TaxNumber = FinanceRules.Clean(request.TaxNumber);
        payee.Notes = FinanceRules.Clean(request.Notes);
        if (request.IsActive is { } active) payee.IsActive = active;
        try
        {
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            audit.Write("FinPayeeUpdated", entityType: nameof(FinPayee), entityId: id.ToString(), details: new { before, after = new { payee.Name, payee.DefaultCategoryId, payee.IsActive } });
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        }
        catch (DbUpdateException ex) when (FinanceRules.IsDuplicate(ex))
        {
            return FinResult<FinPayeeResponse>.Invalid("name", "This payee already exists.");
        }

        return FinResult<FinPayeeResponse>.Ok((await ProjectAsync(db.FinPayees.AsNoTracking().Where(p => p.Id == id), ct)).Single());
    }
}
