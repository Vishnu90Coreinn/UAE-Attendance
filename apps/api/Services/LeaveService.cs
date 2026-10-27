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

public sealed class LeaveService(AppDbContext db, IAuditLogger audit, TimeProvider time, LeaveAttendanceSync attendance)
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
        var ids = rows.Select(x => x.Id).ToList();
        var withPhoto = (await db.LeaveAttachments.AsNoTracking().Where(a => ids.Contains(a.LeaveRequestId)).Select(a => a.LeaveRequestId).ToListAsync(ct)).ToHashSet();
        return new(200, rows.Select(x => Response(x, withPhoto.Contains(x.Id))).ToList());
    }

    /// <summary>The stored photo of a request, or null when it has none.</summary>
    public async Task<LeaveAttachment?> GetAttachmentAsync(int id, CancellationToken ct) =>
        await db.LeaveAttachments.AsNoTracking().SingleOrDefaultAsync(x => x.LeaveRequestId == id, ct);


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
        if (!PhotoUpload.TryDecode(input.AttachmentBase64, out var photo)) errors["attachment"] = ["The photo must be a JPEG image of at most 3 MB."];
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
            if (photo is not null) db.LeaveAttachments.Add(new LeaveAttachment { LeaveRequest = leave, Data = photo, UploadedUtc = leave.CreatedUtc });
            await db.SaveChangesAsync(ct);
            Audit("LeaveCreated", leave, actor, hasAttachment: photo is not null);
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            return new(201, Response(leave, photo is not null));
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
                if (leave.Status == "Approved" && !await attendance.ClearAsync(leave, ct)) return Finalised();
                Audit("LeaveDeleted", leave, actor);
                db.LeaveRequests.Remove(leave);
            }
            else
            {
                if (status == "Approved" && await Overlaps(leave.WorkerId, leave.StartDate, leave.EndDate, id, ct)) return new(409);
                var previousStatus = leave.Status;
                var now = time.GetUtcNow().UtcDateTime;
                // Approved leave fills Daily Attendance for every day of the request; losing the approval clears those days.
                if (status == "Approved" && previousStatus != "Approved" && !await attendance.ApplyAsync(leave, actor, now, ct)) return Finalised();
                if (status != "Approved" && previousStatus == "Approved" && !await attendance.ClearAsync(leave, ct)) return Finalised();
                leave.Status = status;
                leave.DecidedBy = actor;
                leave.DecidedUtc = time.GetUtcNow().UtcDateTime;
                Audit(status == "Approved" ? "LeaveApproved" : "LeaveRejected", leave, actor, previousStatus);
            }
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            return status is null ? new(204) : new(200, Response(leave, await db.LeaveAttachments.AnyAsync(a => a.LeaveRequestId == id, ct)));
        }
        catch (Exception e) when (Conflict(e)) { return new(409); }
    }

    private static LeaveResult Finalised() => new(409, "Part of this leave falls in a finalised payroll month. Reopen that month first.");

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

    private void Audit(string action, LeaveRequest l, string actor, string? previousStatus = null, bool hasAttachment = false) => audit.Write(action, actor, nameof(LeaveRequest), l.Id.ToString(CultureInfo.InvariantCulture),
        new { requestId = l.Id, actor, workerId = l.WorkerId, workerCode = l.Worker.WorkerCode, workerName = l.Worker.FullName, leaveType = l.LeaveType,
            startDate = l.StartDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), endDate = l.EndDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), days = l.Days,
            status = l.Status, previousStatus, createdBy = l.CreatedBy, createdUtc = l.CreatedUtc, decidedBy = l.DecidedBy, decidedUtc = l.DecidedUtc, hasAttachment });
    private static bool Parse(string? s, out DateOnly d) => DateOnly.TryParseExact(s, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out d);
    private static LeaveResponse Response(LeaveRequest l, bool hasAttachment) => new(l.Id, l.WorkerId, l.Worker.WorkerCode, l.Worker.FullName, l.Worker.IsActive, l.LeaveType,
        l.StartDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), l.EndDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), l.Days, l.Status, l.CreatedBy,
        DateTime.SpecifyKind(l.CreatedUtc, DateTimeKind.Utc), l.DecidedBy, l.DecidedUtc is null ? null : DateTime.SpecifyKind(l.DecidedUtc.Value, DateTimeKind.Utc), hasAttachment);
    private static bool Conflict(Exception e)
    {
        for (Exception? current = e; current is not null; current = current.InnerException)
            if (current is LeaveConflictException or DbUpdateConcurrencyException || current is SqlException { Number: 1205 or 1222 or 547 }) return true;
        return false;
    }
    private sealed class LeaveConflictException : Exception;
}
