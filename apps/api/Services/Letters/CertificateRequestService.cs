using System.Globalization;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services;

/// <summary>
/// The certificate workflow: a supervisor raises a request, HR adds and updates the details and sends it to a manager, and
/// only the manager's approval issues (and numbers) the letter. A manager can send a request back to HR with a reason.
/// </summary>
public sealed class CertificateRequestService(
    AppDbContext db, LetterService letters, IAuditLogger audit, TimeProvider time, IHttpContextAccessor httpContext)
{
    public const int MaxReasonLength = 500;
    public const int MaxListed = 500;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private string Actor => httpContext.HttpContext?.User.Identity?.Name ?? "";
    private DateTime Now => time.GetUtcNow().UtcDateTime;

    private const string ManagerOwnOnly = "A manager can only prepare a request they raised themselves.";

    /// <summary>HR and the Administrator prepare any request; a Manager only the ones they raised.</summary>
    private bool CanPrepare(CertificateRequest entity)
    {
        var user = httpContext.HttpContext?.User;
        if (user is null || user.IsInRole(Roles.Administrator) || user.IsInRole(Roles.HR)) return true;
        return user.IsInRole(Roles.Manager) && entity.RequestedBy == Actor;
    }

    // --- supervisor: raise ---------------------------------------------------------------------------------

    public async Task<LetterResult> CreateAsync(CertificateRequestCreate request, CancellationToken ct)
    {
        var errors = new Dictionary<string, string[]>();
        var type = (request.LetterType ?? "").Trim();
        if (!LetterTypes.All.Contains(type)) errors["letterType"] = ["Choose the type of certificate."];
        var reason = (request.Reason ?? "").Trim();
        if (reason.Length > MaxReasonLength) errors["reason"] = [$"The note must be {MaxReasonLength} characters or fewer."];
        Worker? worker = null;
        if (request.WorkerId is null or <= 0) errors["workerId"] = ["Choose a worker."];
        else
        {
            worker = await db.Workers.AsNoTracking().SingleOrDefaultAsync(w => w.Id == request.WorkerId, ct);
            if (worker is null) errors["workerId"] = ["Choose a worker."];
        }
        if (errors.Count > 0) return new(400, Errors: errors);

        var entity = new CertificateRequest
        {
            WorkerId = worker!.Id, LetterType = type, Reason = reason, Status = CertificateStatuses.Requested,
            RequestedBy = Actor, RequestedUtc = Now,
        };
        db.CertificateRequests.Add(entity);
        audit.Write("CertificateRequested", entityType: nameof(CertificateRequest), entityId: "new",
            details: new { workerId = worker.Id, letterType = type });
        await db.SaveChangesAsync(ct);
        return new(201, await ResponseAsync(entity.Id, ct));
    }

    // --- reads ---------------------------------------------------------------------------------------------

    /// <summary>Requests newest first. <paramref name="onlyRequestedBy"/> limits a supervisor to the requests they raised.</summary>
    public async Task<IReadOnlyList<CertificateRequestResponse>> ListAsync(string? status, string? onlyRequestedBy, CancellationToken ct)
    {
        var query = db.CertificateRequests.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(status)) query = query.Where(r => r.Status == status);
        if (onlyRequestedBy is not null) query = query.Where(r => r.RequestedBy == onlyRequestedBy);
        return await query.OrderByDescending(r => r.RequestedUtc).ThenByDescending(r => r.Id).Take(MaxListed).Select(Project).ToListAsync(ct);
    }

    public async Task<LetterResult> GetAsync(int id, CancellationToken ct)
    {
        var response = await ResponseAsync(id, ct);
        if (response is null) return new(404);
        var entity = await db.CertificateRequests.AsNoTracking().SingleAsync(r => r.Id == id, ct);
        var details = Read(entity);
        LetterDocument? document = null;
        if (details is not null && entity.Status != CertificateStatuses.Approved)
        {
            var preview = await letters.PreviewAsync(details, ct);
            document = preview.Body as LetterDocument;
        }
        else if (entity.IssuedLetterId is { } letterId)
        {
            document = (await letters.GetAsync(letterId, ct)).Body is LetterRecord record ? record.Document : null;
        }
        return new(200, new CertificateRequestDetail(response, details, document));
    }

    // --- HR: add or update the details, then send to the manager -------------------------------------------

    public async Task<LetterResult> SaveDetailsAsync(int id, LetterRequest details, CancellationToken ct)
    {
        var entity = await db.CertificateRequests.SingleOrDefaultAsync(r => r.Id == id, ct);
        if (entity is null) return new(404);
        if (!CanPrepare(entity)) return new(403, Message: ManagerOwnOnly);
        if (entity.Status is not (CertificateStatuses.Requested or CertificateStatuses.Returned))
            return new(409, Message: "These details can no longer be changed.");

        var forced = Force(entity, details);
        var preview = await letters.PreviewAsync(forced, ct);
        if (preview.StatusCode != 200) return preview;

        entity.DetailsJson = JsonSerializer.Serialize(forced, Json);
        entity.PreparedBy = Actor;
        entity.PreparedUtc = Now;
        audit.Write("CertificateDetailsSaved", entityType: nameof(CertificateRequest), entityId: id.ToString(CultureInfo.InvariantCulture));
        await db.SaveChangesAsync(ct);
        return new(200, await ResponseAsync(id, ct));
    }

    public async Task<LetterResult> SubmitAsync(int id, CancellationToken ct)
    {
        var entity = await db.CertificateRequests.SingleOrDefaultAsync(r => r.Id == id, ct);
        if (entity is null) return new(404);
        if (!CanPrepare(entity)) return new(403, Message: ManagerOwnOnly);
        if (entity.Status is not (CertificateStatuses.Requested or CertificateStatuses.Returned))
            return new(409, Message: "This request has already been sent for approval.");
        var details = Read(entity);
        if (details is null)
            return new(400, Errors: new() { ["details"] = ["Save the certificate details before sending it for approval."] });
        var preview = await letters.PreviewAsync(details, ct);
        if (preview.StatusCode != 200) return preview;

        entity.Status = CertificateStatuses.PendingApproval;
        entity.ReviewNote = "";
        audit.Write("CertificateSubmitted", entityType: nameof(CertificateRequest), entityId: id.ToString(CultureInfo.InvariantCulture));
        await db.SaveChangesAsync(ct);
        return new(200, await ResponseAsync(id, ct));
    }

    // --- manager: approve or send back ---------------------------------------------------------------------

    public async Task<LetterResult> ApproveAsync(int id, CancellationToken ct)
    {
        var entity = await db.CertificateRequests.AsNoTracking().SingleOrDefaultAsync(r => r.Id == id, ct);
        if (entity is null) return new(404);
        if (entity.Status != CertificateStatuses.PendingApproval) return new(409, Message: "This request is not waiting for approval.");
        var details = Read(entity);
        if (details is null) return new(409, Message: "This request has no certificate details.");
        // Issuing numbers the letter and closes the request in one transaction.
        var issued = await letters.IssueAsync(Force(entity, details), ct, fulfilling: id);
        return issued.StatusCode == 201 ? new(200, await ResponseAsync(id, ct)) : issued;
    }

    public async Task<LetterResult> RejectAsync(int id, string? reason, CancellationToken ct)
    {
        var note = (reason ?? "").Trim();
        if (note.Length == 0) return new(400, Errors: new() { ["reason"] = ["Say why it is being sent back."] });
        if (note.Length > MaxReasonLength) return new(400, Errors: new() { ["reason"] = [$"The reason must be {MaxReasonLength} characters or fewer."] });
        var entity = await db.CertificateRequests.SingleOrDefaultAsync(r => r.Id == id, ct);
        if (entity is null) return new(404);
        if (entity.Status != CertificateStatuses.PendingApproval) return new(409, Message: "This request is not waiting for approval.");

        entity.Status = CertificateStatuses.Returned;
        entity.ReviewNote = note;
        entity.ReviewedBy = Actor;
        entity.ReviewedUtc = Now;
        audit.Write("CertificateReturned", entityType: nameof(CertificateRequest), entityId: id.ToString(CultureInfo.InvariantCulture), details: new { reason = note });
        await db.SaveChangesAsync(ct);
        return new(200, await ResponseAsync(id, ct));
    }

    // --- helpers -------------------------------------------------------------------------------------------

    /// <summary>The request decides the worker and the kind of letter; HR cannot change them while preparing details.</summary>
    private static LetterRequest Force(CertificateRequest entity, LetterRequest details) =>
        details with { WorkerId = entity.WorkerId, LetterType = entity.LetterType };

    private static LetterRequest? Read(CertificateRequest entity) =>
        entity.DetailsJson is null ? null : JsonSerializer.Deserialize<LetterRequest>(entity.DetailsJson, Json);

    private async Task<CertificateRequestResponse?> ResponseAsync(int id, CancellationToken ct) =>
        await db.CertificateRequests.AsNoTracking().Where(r => r.Id == id).Select(Project).SingleOrDefaultAsync(ct);

    private static readonly System.Linq.Expressions.Expression<Func<CertificateRequest, CertificateRequestResponse>> Project = r =>
        new(r.Id, r.WorkerId, r.Worker.FullName, r.Worker.WorkerCode, r.LetterType, r.Reason, r.Status, r.RequestedBy, r.RequestedUtc,
            r.PreparedBy, r.PreparedUtc, r.ReviewedBy, r.ReviewedUtc, r.ReviewNote, r.DetailsJson != null,
            r.IssuedLetterId, r.IssuedLetter != null ? r.IssuedLetter.RefNo : null);
}
