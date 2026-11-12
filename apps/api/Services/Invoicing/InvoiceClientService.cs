using System.Globalization;
using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services;

/// <summary>The customers invoices are addressed to.</summary>
public sealed class InvoiceClientService(AppDbContext db, IAuditLogger audit)
{
    public async Task<IReadOnlyList<InvoiceClientResponse>> ListAsync(bool includeInactive, CancellationToken ct) =>
        await db.InvoiceClients.AsNoTracking().Where(c => includeInactive || c.IsActive).OrderBy(c => c.Name)
            .Select(c => new InvoiceClientResponse(c.Id, c.Name, c.Trn, c.Address, c.IsActive)).ToListAsync(ct);

    public async Task<DocumentResult> CreateAsync(InvoiceClientRequest request, CancellationToken ct)
    {
        var (name, trn, address, errors) = Validate(request);
        if (errors.Count > 0) return new(400, Errors: errors);
        if (await db.InvoiceClients.AnyAsync(c => c.Name == name, ct)) return Duplicate();
        var client = new InvoiceClient { Name = name, Trn = trn, Address = address, IsActive = true };
        db.InvoiceClients.Add(client);
        audit.Write("InvoiceClientCreated", entityType: nameof(InvoiceClient), entityId: "new", details: new { name });
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException) { return Duplicate(); }
        return new(201, ToResponse(client));
    }

    public async Task<DocumentResult> UpdateAsync(int id, InvoiceClientRequest request, CancellationToken ct)
    {
        var client = await db.InvoiceClients.SingleOrDefaultAsync(c => c.Id == id, ct);
        if (client is null) return new(404);
        var (name, trn, address, errors) = Validate(request);
        if (request.IsActive is null) errors["isActive"] = ["Say whether the client is active."];
        if (errors.Count > 0) return new(400, Errors: errors);
        if (await db.InvoiceClients.AnyAsync(c => c.Id != id && c.Name == name, ct)) return Duplicate();

        var changes = new Dictionary<string, FieldChange>();
        if (client.Name != name) { changes["name"] = new(client.Name, name); client.Name = name; }
        if (client.Trn != trn) { changes["trn"] = new(client.Trn, trn); client.Trn = trn; }
        if (client.Address != address) { changes["address"] = new(client.Address, address); client.Address = address; }
        if (client.IsActive != request.IsActive!.Value) { changes["isActive"] = new(client.IsActive, request.IsActive.Value); client.IsActive = request.IsActive.Value; }
        if (changes.Count > 0)
        {
            audit.Write("InvoiceClientUpdated", entityType: nameof(InvoiceClient), entityId: id.ToString(CultureInfo.InvariantCulture), details: changes);
            try { await db.SaveChangesAsync(ct); }
            catch (DbUpdateException) { return Duplicate(); }
        }
        return new(200, ToResponse(client));
    }

    private static (string Name, string Trn, string Address, Dictionary<string, string[]> Errors) Validate(InvoiceClientRequest r)
    {
        var errors = new Dictionary<string, string[]>();
        var name = (r.Name ?? "").Trim();
        var trn = (r.Trn ?? "").Trim();
        var address = (r.Address ?? "").Trim();
        if (name.Length == 0) errors["name"] = ["Enter the client's name."];
        else if (name.Length > 120) errors["name"] = ["Name must be 120 characters or fewer."];
        if (trn.Length > 30) errors["trn"] = ["TRN must be 30 characters or fewer."];
        if (address.Length > 250) errors["address"] = ["Address must be 250 characters or fewer."];
        return (name, trn, address, errors);
    }

    private static DocumentResult Duplicate() => new(400, Errors: new() { ["name"] = ["A client with this name already exists."] });

    private static InvoiceClientResponse ToResponse(InvoiceClient c) => new(c.Id, c.Name, c.Trn, c.Address, c.IsActive);
}
