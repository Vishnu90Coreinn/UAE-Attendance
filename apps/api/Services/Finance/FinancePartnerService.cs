using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services.Finance;

/// <summary>The company's partners and how much capital each has put in. Shares come from <see cref="FinanceCalculator.Shares"/>.</summary>
public sealed class FinancePartnerService(AppDbContext db, IAuditLogger audit, FinancePeriodService periods)
{
    private const int MaxNameLength = 120;

    /// <summary>What each partner has added and had returned, from entries that are not voided.</summary>
    public async Task<FinPartnersResponse> ListAsync(CancellationToken ct)
    {
        var partners = await db.FinPartners.AsNoTracking().OrderBy(p => p.SortOrder).ThenBy(p => p.Name).ToListAsync(ct);
        var sums = await db.FinEntries.AsNoTracking()
            .Where(e => e.PartnerId != null)
            .GroupBy(e => e.PartnerId!.Value)
            .Select(g => new
            {
                PartnerId = g.Key,
                Added = g.Where(e => e.Status == FinStatuses.Active && e.Kind == FinEntryKinds.Capital).Sum(e => (decimal?)e.Amount) ?? 0m,
                Returned = g.Where(e => e.Status == FinStatuses.Active && e.Kind == FinEntryKinds.CapitalOut).Sum(e => (decimal?)e.Amount) ?? 0m,
                Count = g.Count(e => e.Status == FinStatuses.Active),
                Last = g.Where(e => e.Status == FinStatuses.Active).Max(e => (DateOnly?)e.EntryDate),
            }).ToListAsync(ct);

        var nets = partners.Select(p =>
        {
            var s = sums.SingleOrDefault(x => x.PartnerId == p.Id);
            return p.OpeningCapital + (s?.Added ?? 0m) - (s?.Returned ?? 0m);
        }).ToList();
        var shares = FinanceCalculator.Shares(nets);

        var rows = partners.Select((p, i) =>
        {
            var s = sums.SingleOrDefault(x => x.PartnerId == p.Id);
            return new FinPartnerResponse(p.Id, p.Name, p.OpeningCapital, p.IsActive, p.SortOrder, s?.Added ?? 0m, s?.Returned ?? 0m, nets[i], shares[i],
                s?.Count ?? 0, s?.Last is { } last ? FinanceRules.Format(last) : null);
        }).ToList();
        return new FinPartnersResponse(rows, nets.Sum());
    }

    private async Task<FinPartnerResponse> OneAsync(int id, CancellationToken ct) => (await ListAsync(ct)).Partners.Single(p => p.Id == id);

    private static Dictionary<string, string[]> Validate(FinPartnerRequest request)
    {
        var errors = new Dictionary<string, string[]>();
        var name = FinanceRules.Clean(request.Name);
        if (name is null) errors["name"] = ["Enter the partner's name."];
        else if (name.Length > MaxNameLength) errors["name"] = [$"Use {MaxNameLength} characters or fewer."];
        var opening = request.OpeningCapital ?? 0m;
        if (opening < 0) errors["openingCapital"] = ["Opening capital cannot be negative."];
        else if (!FinanceCalculator.IsMoney(opening)) errors["openingCapital"] = ["Use at most 2 decimal places."];
        else if (opening > FinanceRules.MaxAmount) errors["openingCapital"] = ["That amount is too large."];
        return errors;
    }

    public async Task<FinResult<FinPartnerResponse>> CreateAsync(FinPartnerRequest request, CancellationToken ct)
    {
        var errors = Validate(request);
        var name = FinanceRules.Clean(request.Name);
        if (errors.Count == 0 && await db.FinPartners.AnyAsync(p => p.Name == name, ct)) errors["name"] = ["A partner with this name already exists."];
        if (errors.Count == 0 && (request.OpeningCapital ?? 0m) != 0m && await periods.AnyLockedAsync(ct))
            errors["openingCapital"] = ["A month has been locked, so opening figures are settled. Record the capital as an entry instead."];
        if (errors.Count > 0) return FinResult<FinPartnerResponse>.Invalid(errors);

        var now = DateTime.UtcNow;
        var partner = new FinPartner { Name = name!, OpeningCapital = request.OpeningCapital ?? 0m, SortOrder = request.SortOrder ?? 0, CreatedUtc = now, UpdatedUtc = now };
        db.FinPartners.Add(partner);
        try
        {
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            await db.SaveChangesAsync(ct);
            audit.Write("FinPartnerCreated", entityType: nameof(FinPartner), entityId: partner.Id.ToString(), details: new { partner.Name, partner.OpeningCapital });
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        }
        catch (DbUpdateException ex) when (FinanceRules.IsDuplicate(ex))
        {
            return FinResult<FinPartnerResponse>.Invalid("name", "A partner with this name already exists.");
        }

        return FinResult<FinPartnerResponse>.Created(await OneAsync(partner.Id, ct));
    }

    public async Task<FinResult<FinPartnerResponse>> UpdateAsync(int id, FinPartnerRequest request, CancellationToken ct)
    {
        var partner = await db.FinPartners.SingleOrDefaultAsync(p => p.Id == id, ct);
        if (partner is null) return FinResult<FinPartnerResponse>.NotFound("Partner not found.");

        var errors = Validate(request);
        var name = FinanceRules.Clean(request.Name);
        if (errors.Count == 0 && await db.FinPartners.AnyAsync(p => p.Name == name && p.Id != id, ct)) errors["name"] = ["A partner with this name already exists."];
        var opening = request.OpeningCapital ?? partner.OpeningCapital;
        if (errors.Count == 0 && opening != partner.OpeningCapital && await periods.AnyLockedAsync(ct))
            errors["openingCapital"] = ["A month has been locked, so opening figures are settled. Unlock every month first to change this."];
        if (errors.Count > 0) return FinResult<FinPartnerResponse>.Invalid(errors);

        var active = request.IsActive ?? partner.IsActive;
        var order = request.SortOrder ?? partner.SortOrder;
        if (partner.Name != name || partner.OpeningCapital != opening || partner.IsActive != active || partner.SortOrder != order)
        {
            audit.Write("FinPartnerUpdated", entityType: nameof(FinPartner), entityId: partner.Id.ToString(),
                details: new { before = new { partner.Name, partner.OpeningCapital, partner.IsActive }, after = new { Name = name, OpeningCapital = opening, IsActive = active } });
            partner.Name = name!;
            partner.OpeningCapital = opening;
            partner.IsActive = active;
            partner.SortOrder = order;
            partner.UpdatedUtc = DateTime.UtcNow;
            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException ex) when (FinanceRules.IsDuplicate(ex))
            {
                return FinResult<FinPartnerResponse>.Invalid("name", "A partner with this name already exists.");
            }
        }

        return FinResult<FinPartnerResponse>.Ok(await OneAsync(id, ct));
    }
}
