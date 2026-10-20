using System.Data;
using System.Globalization;
using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace HrPayroll.Api.Services;

public sealed record LeaveResult(int StatusCode, object? Value = null, Dictionary<string, string[]>? Errors = null);

public sealed class LeaveService(AppDbContext db, IAuditLogger audit, TimeProvider time)
{
    private static readonly string[] Types = ["Annual Leave", "Sick Leave", "Unpaid Leave", "Emergency Leave"];
    private static readonly string[] Statuses = ["Pending", "Approved", "Rejected"];

    public async Task<LeaveResult> ListAsync(string? status, string? workerId, CancellationToken ct)
    {
        var errors = new Dictionary<string, string[]>();
        if (!string.IsNullOrEmpty(status) && !Statuses.Contains(status)) errors["status"] = ["Select a valid status."];
        int id = 0;
        if (workerId is not null && (!int.TryParse(workerId, NumberStyles.None, CultureInfo.InvariantCulture, out id) || id <= 0)) errors["workerId"] = ["Worker ID must be a positive integer."];
        if (errors.Count > 0) return new(400, Errors: errors);
        var q = db.LeaveRequests.AsNoTracking().Include(x => x.Worker).AsQueryable();
        if (!string.IsNullOrEmpty(status)) q = q.Where(x => x.Status == status);
        if (workerId is not null) q = q.Where(x => x.WorkerId == id);
        var rows = await q.OrderByDescending(x => x.StartDate).ThenByDescending(x => x.Id).ToListAsync(ct);
        return new(200, rows.Select(Response).ToList());
    }

    public async Task<LeaveResult> CreateAsync(CreateLeaveRequest input, string actor, CancellationToken ct)
    {
        var errors = new Dictionary<string, string[]>();
        if (input.WorkerId is null or <= 0) errors["workerId"] = ["Select an active worker."];
        if (!Types.Contains(input.LeaveType)) errors["leaveType"] = ["Select a valid leave type."];
        var validStart = Parse(input.StartDate, out var start);
        var validEnd = Parse(input.EndDate, out var end);
        if (!validStart) errors["startDate"] = ["Enter a valid date in yyyy-MM-dd format."];
        if (!validEnd) errors["endDate"] = ["Enter a valid date in yyyy-MM-dd format."];
        if (validStart && validEnd && end < start) errors["endDate"] = ["End date must be on or after start date."];
        if (errors.Count > 0) return new(400, Errors: errors);
        try
        {
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
            await LockAsync(input.WorkerId!.Value, ct);
            var worker = await db.Workers.SingleOrDefaultAsync(x => x.Id == input.WorkerId, ct);
            if (worker is null || !worker.IsActive) return new(400, Errors: new() { ["workerId"] = ["Select an active worker."] });
            if (await Overlaps(input.WorkerId.Value, start, end, 0, ct)) return new(409);
            var leave = new LeaveRequest { Worker = worker, WorkerId = worker.Id, LeaveType = input.LeaveType!, StartDate = start, EndDate = end, CreatedBy = actor, CreatedUtc = time.GetUtcNow().UtcDateTime };
            db.LeaveRequests.Add(leave);
            await db.SaveChangesAsync(ct);
            Audit("LeaveCreated", leave, actor);
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            return new(201, Response(leave));
        }
        catch (Exception e) when (Conflict(e)) { return new(409); }
    }

    /// <summary>
    /// Decides (<paramref name="status"/> given) or deletes (null) a request. <paramref name="canDeleteAny"/> is true for a Manager or
    /// the Administrator; anyone else (a supervisor) may delete only a Pending request they created themselves.
    /// </summary>
    public async Task<LeaveResult> ChangeAsync(int id, string? status, string actor, bool canDeleteAny, CancellationToken ct)
    {
        var workerId = await db.LeaveRequests.AsNoTracking().Where(x => x.Id == id).Select(x => (int?)x.WorkerId).SingleOrDefaultAsync(ct);
        if (workerId is null) return new(404);
        try
        {
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
            await LockAsync(workerId.Value, ct);
            // Consistent worker then request lock order with create; refresh state only after the lock.
            var worker = await db.Workers.SingleOrDefaultAsync(x => x.Id == workerId, ct);
            if (worker is null) return new(404);
            var leave = await db.LeaveRequests.SingleOrDefaultAsync(x => x.Id == id, ct);
            if (leave is null) return new(404);
            leave.Worker = worker;
            if (status is null)
            {
                if (!canDeleteAny && (leave.Status != "Pending" || !string.Equals(leave.CreatedBy, actor, StringComparison.OrdinalIgnoreCase))) return new(403);
                Audit("LeaveDeleted", leave, actor);
                db.LeaveRequests.Remove(leave);
            }
            else
            {
                if (status == "Approved" && await Overlaps(leave.WorkerId, leave.StartDate, leave.EndDate, id, ct)) return new(409);
                var previousStatus = leave.Status;
                leave.Status = status;
                leave.DecidedBy = actor;
                leave.DecidedUtc = time.GetUtcNow().UtcDateTime;
                Audit(status == "Approved" ? "LeaveApproved" : "LeaveRejected", leave, actor, previousStatus);
            }
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            return status is null ? new(204) : new(200, Response(leave));
        }
        catch (Exception e) when (Conflict(e)) { return new(409); }
    }

    private Task<bool> Overlaps(int worker, DateOnly start, DateOnly end, int exceptId, CancellationToken ct) =>
        db.LeaveRequests.AnyAsync(x => x.WorkerId == worker && x.Id != exceptId && x.Status != "Rejected" && x.StartDate <= end && x.EndDate >= start, ct);

    private async Task LockAsync(int worker, CancellationToken ct)
    {
        await using var cmd = db.Database.GetDbConnection().CreateCommand();
        cmd.Transaction = db.Database.CurrentTransaction!.GetDbTransaction();
        cmd.CommandText = "DECLARE @result int; EXEC @result = sys.sp_getapplock @Resource = @resource, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 3000; SELECT @result;";
        cmd.Parameters.Add(new SqlParameter("@resource", "LeaveWorker:" + worker.ToString(CultureInfo.InvariantCulture)));
        if (Convert.ToInt32(await cmd.ExecuteScalarAsync(ct), CultureInfo.InvariantCulture) < 0) throw new LeaveConflictException();
    }

    private void Audit(string action, LeaveRequest l, string actor, string? previousStatus = null) => audit.Write(action, actor, nameof(LeaveRequest), l.Id.ToString(CultureInfo.InvariantCulture),
        new { requestId = l.Id, actor, workerId = l.WorkerId, workerCode = l.Worker.WorkerCode, workerName = l.Worker.FullName, leaveType = l.LeaveType,
            startDate = l.StartDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), endDate = l.EndDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), days = l.Days,
            status = l.Status, previousStatus, createdBy = l.CreatedBy, createdUtc = l.CreatedUtc, decidedBy = l.DecidedBy, decidedUtc = l.DecidedUtc });
    private static bool Parse(string? s, out DateOnly d) => DateOnly.TryParseExact(s, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out d);
    private static LeaveResponse Response(LeaveRequest l) => new(l.Id, l.WorkerId, l.Worker.WorkerCode, l.Worker.FullName, l.Worker.IsActive, l.LeaveType,
        l.StartDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), l.EndDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), l.Days, l.Status, l.CreatedBy,
        DateTime.SpecifyKind(l.CreatedUtc, DateTimeKind.Utc), l.DecidedBy, l.DecidedUtc is null ? null : DateTime.SpecifyKind(l.DecidedUtc.Value, DateTimeKind.Utc));
    private static bool Conflict(Exception e)
    {
        for (Exception? current = e; current is not null; current = current.InnerException)
            if (current is LeaveConflictException or DbUpdateConcurrencyException || current is SqlException { Number: 1205 or 1222 or 547 }) return true;
        return false;
    }
    private sealed class LeaveConflictException : Exception;
}
