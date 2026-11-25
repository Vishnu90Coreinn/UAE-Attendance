using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services.Finance;

/// <summary>Expense and income categories, managed in Settings. Renamed or switched off, never deleted.</summary>
public sealed class FinanceCategoryService(AppDbContext db, IAuditLogger audit)
{
    private const int MaxNameLength = 80;

    public async Task<List<FinCategoryResponse>> ListAsync(string? kind, bool includeInactive, CancellationToken ct)
    {
        var query = db.FinCategories.AsNoTracking().Where(c => !FinEntryKinds.CapitalKinds.Contains(c.Kind));
        if (kind is not null) query = query.Where(c => c.Kind == kind);
        if (!includeInactive) query = query.Where(c => c.IsActive);
        return await query
            .OrderBy(c => c.Kind).ThenBy(c => c.Name)
            .Select(c => new FinCategoryResponse(c.Id, c.Kind, c.Name, c.IsActive, db.FinEntryLines.Count(l => l.CategoryId == c.Id), c.DefaultTaxTypeId))
            .ToListAsync(ct);
    }

    public async Task<List<FinTaxTypeResponse>> TaxTypesAsync(CancellationToken ct) =>
        await db.FinTaxTypes.AsNoTracking().Where(t => t.IsActive).OrderBy(t => t.SortOrder).Select(t => new FinTaxTypeResponse(t.Id, t.Name, t.Treatment, t.Rate)).ToListAsync(ct);

    /// <summary>Which VAT type a category offers first on the entry form. The accountant decides this per category.</summary>
    public async Task<FinResult<FinCategoryResponse>> SetTaxDefaultAsync(int id, int? taxTypeId, CancellationToken ct)
    {
        var category = await db.FinCategories.SingleOrDefaultAsync(c => c.Id == id && !FinEntryKinds.CapitalKinds.Contains(c.Kind), ct);
        if (category is null) return FinResult<FinCategoryResponse>.NotFound("Category not found.");
        if (taxTypeId is { } t && !await db.FinTaxTypes.AnyAsync(x => x.Id == t && x.IsActive, ct)) return FinResult<FinCategoryResponse>.Invalid("taxTypeId", "Choose an active VAT type.");
        if (category.DefaultTaxTypeId != taxTypeId)
        {
            audit.Write("FinCategoryTaxDefaultChanged", entityType: nameof(FinCategory), entityId: id.ToString(), details: new { category.Name, from = category.DefaultTaxTypeId, to = taxTypeId });
            category.DefaultTaxTypeId = taxTypeId;
            await db.SaveChangesAsync(ct);
        }

        return FinResult<FinCategoryResponse>.Ok(new(category.Id, category.Kind, category.Name, category.IsActive, await db.FinEntryLines.CountAsync(l => l.CategoryId == id, ct), category.DefaultTaxTypeId));
    }

    private static string? NameError(string? name) =>
        name is null ? "Enter the category name." : name.Length > MaxNameLength ? $"Use {MaxNameLength} characters or fewer." : null;

    public async Task<FinResult<FinCategoryResponse>> CreateAsync(FinCategoryRequest request, CancellationToken ct)
    {
        var errors = new Dictionary<string, string[]>();
        var name = FinanceRules.Clean(request.Name);
        if (NameError(name) is { } nameError) errors["name"] = [nameError];
        if (request.Kind is null || !FinEntryKinds.All.Contains(request.Kind)) errors["kind"] = ["Choose Expense or Income."];
        if (errors.Count == 0 && await db.FinCategories.AnyAsync(c => c.Kind == request.Kind && c.Name == name, ct))
            errors["name"] = ["This category already exists."];
        if (errors.Count > 0) return FinResult<FinCategoryResponse>.Invalid(errors);

        var category = new FinCategory { Kind = request.Kind!, Name = name! };
        db.FinCategories.Add(category);
        try
        {
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            await db.SaveChangesAsync(ct);
            audit.Write("FinCategoryCreated", entityType: nameof(FinCategory), entityId: category.Id.ToString(), details: new { category.Kind, category.Name });
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        }
        catch (DbUpdateException ex) when (FinanceRules.IsDuplicate(ex))
        {
            return FinResult<FinCategoryResponse>.Invalid("name", "This category already exists.");
        }

        return FinResult<FinCategoryResponse>.Created(new(category.Id, category.Kind, category.Name, category.IsActive, 0));
    }

    public async Task<FinResult<FinCategoryResponse>> UpdateAsync(int id, FinCategoryRequest request, CancellationToken ct)
    {
        var category = await db.FinCategories.SingleOrDefaultAsync(c => c.Id == id, ct);
        if (category is null) return FinResult<FinCategoryResponse>.NotFound("Category not found.");

        var name = FinanceRules.Clean(request.Name);
        if (NameError(name) is { } nameError) return FinResult<FinCategoryResponse>.Invalid("name", nameError);
        if (await db.FinCategories.AnyAsync(c => c.Kind == category.Kind && c.Name == name && c.Id != id, ct))
            return FinResult<FinCategoryResponse>.Invalid("name", "This category already exists.");

        var active = request.IsActive ?? category.IsActive;
        if (category.Name != name || category.IsActive != active)
        {
            audit.Write("FinCategoryUpdated", entityType: nameof(FinCategory), entityId: category.Id.ToString(),
                details: new { before = new { category.Name, category.IsActive }, after = new { Name = name, IsActive = active } });
            category.Name = name!;
            category.IsActive = active;
            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException ex) when (FinanceRules.IsDuplicate(ex))
            {
                return FinResult<FinCategoryResponse>.Invalid("name", "This category already exists.");
            }
        }

        var uses = await db.FinEntryLines.CountAsync(l => l.CategoryId == id, ct);
        return FinResult<FinCategoryResponse>.Ok(new(category.Id, category.Kind, category.Name, category.IsActive, uses));
    }
}
