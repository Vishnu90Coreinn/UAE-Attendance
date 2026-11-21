using System.Globalization;
using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services.Staff;

/// <summary>Leave for office employees: types with yearly entitlements, requests, manager approval and balances.</summary>
public sealed class StaffLeaveService(
    AppDbContext db, IAuditLogger audit, TimeProvider time, IHttpContextAccessor http, StaffSettingsService settingsService, StaffAttendanceService attendance)
{
    private string Actor => http.HttpContext?.User.Identity?.Name ?? "";

    // --- leave types -------------------------------------------------------------------------------------------

    public async Task<List<StaffLeaveTypeDto>> TypesAsync(bool activeOnly, CancellationToken ct)
    {
        var query = db.StaffLeaveTypes.AsNoTracking();
        if (activeOnly) query = query.Where(t => t.IsActive);
        return (await query.OrderBy(t => t.Id).ToListAsync(ct)).Select(t => new StaffLeaveTypeDto(t.Id, t.Name, t.YearlyDays, t.IsActive)).ToList();
    }

    public async Task<StaffResult<StaffLeaveTypeDto>> SaveTypeAsync(int? id, StaffLeaveTypeRequest request, CancellationToken ct)
    {
        var name = (request.Name ?? "").Trim();
        if (name.Length == 0) return StaffResult<StaffLeaveTypeDto>.Invalid("name", "Leave type name is required.");
        if (name.Length > 60) return StaffResult<StaffLeaveTypeDto>.Invalid("name", "Name must be 60 characters or fewer.");
        if (request.YearlyDays is null or < 0 or > 366) return StaffResult<StaffLeaveTypeDto>.Invalid("yearlyDays", "Yearly days must be 0 to 366.");
        if (await db.StaffLeaveTypes.AnyAsync(t => t.Name == name && t.Id != (id ?? 0), ct))
            return StaffResult<StaffLeaveTypeDto>.Invalid("name", "A leave type with that name already exists.");

        StaffLeaveType type;
        if (id is { } existing)
        {
            type = await db.StaffLeaveTypes.SingleOrDefaultAsync(t => t.Id == existing, ct) ?? null!;
            if (type is null) return StaffResult<StaffLeaveTypeDto>.NotFound("Leave type not found.");
            audit.Write("StaffLeaveTypeUpdated", Actor, nameof(StaffLeaveType), existing.ToString(CultureInfo.InvariantCulture),
                new { before = new { type.Name, type.YearlyDays, type.IsActive }, after = new { Name = name, request.YearlyDays, IsActive = request.IsActive ?? type.IsActive } });
        }
        else
        {
            type = new StaffLeaveType();
            db.StaffLeaveTypes.Add(type);
        }

        type.Name = name;
        type.YearlyDays = request.YearlyDays.Value;
        if (request.IsActive is { } active) type.IsActive = active;
        await db.SaveChangesAsync(ct);
        if (id is null)
        {
            audit.Write("StaffLeaveTypeCreated", Actor, nameof(StaffLeaveType), type.Id.ToString(CultureInfo.InvariantCulture), new { type.Name, type.YearlyDays });
            await db.SaveChangesAsync(ct);
        }

        return StaffResult<StaffLeaveTypeDto>.Ok(new(type.Id, type.Name, type.YearlyDays, type.IsActive));
    }

    // --- balances ----------------------------------------------------------------------------------------------

    /// <summary>Days of the request that fall inside <paramref name="year"/>, counting working days only.</summary>
    private static int DaysInYear(StaffLeaveRequest r, int year, DayOfWeek weeklyOff, ISet<DateOnly> holidays)
    {
        var from = r.StartDate > new DateOnly(year, 1, 1) ? r.StartDate : new DateOnly(year, 1, 1);
        var to = r.EndDate < new DateOnly(year, 12, 31) ? r.EndDate : new DateOnly(year, 12, 31);
        return to < from ? 0 : StaffDayCalculator.WorkingDays(from, to, weeklyOff, holidays);
    }

    private async Task<List<StaffLeaveBalanceDto>> BalancesAsync(int workerId, int year, CancellationToken ct)
    {
        var settings = await settingsService.LoadAsync(ct);
        var holidays = (await db.PublicHolidays.AsNoTracking().Where(h => h.Date.Year == year).Select(h => h.Date).ToListAsync(ct)).ToHashSet();
        var types = await db.StaffLeaveTypes.AsNoTracking().Where(t => t.IsActive).OrderBy(t => t.Id).ToListAsync(ct);
        var requests = await db.StaffLeaveRequests.AsNoTracking()
            .Where(r => r.WorkerId == workerId && (r.Status == StaffLeaveStatuses.Approved || r.Status == StaffLeaveStatuses.Pending)
                && r.StartDate <= new DateOnly(year, 12, 31) && r.EndDate >= new DateOnly(year, 1, 1)).ToListAsync(ct);
        return types.Select(t =>
        {
            var mine = requests.Where(r => r.LeaveTypeId == t.Id).ToList();
            var used = mine.Where(r => r.Status == StaffLeaveStatuses.Approved).Sum(r => DaysInYear(r, year, settings.WeeklyOff, holidays));
            var pending = mine.Where(r => r.Status == StaffLeaveStatuses.Pending).Sum(r => DaysInYear(r, year, settings.WeeklyOff, holidays));
            return new StaffLeaveBalanceDto(t.Id, t.Name, t.YearlyDays, used, pending, Math.Max(0, t.YearlyDays - used));
        }).ToList();
    }

    public async Task<StaffResult<StaffMyLeaveResponse>> MineAsync(int userId, CancellationToken ct)
    {
        var worker = await attendance.EmployeeForUserAsync(userId, ct);
        if (worker is null) return StaffResult<StaffMyLeaveResponse>.NotFound("No active employee record is linked to this login.");
        var year = StaffTime.Today(time).Year;
        var requests = await QueryRequests().Where(r => r.WorkerId == worker.Id).OrderByDescending(r => r.StartDate).ThenByDescending(r => r.Id).ToListAsync(ct);
        return StaffResult<StaffMyLeaveResponse>.Ok(new(await BalancesAsync(worker.Id, year, ct), requests.Select(ToDto).ToList(), await TypesAsync(true, ct)));
    }

    public async Task<List<StaffLeaveBalanceRow>> AllBalancesAsync(int? year, string? department, CancellationToken ct)
    {
        var y = year ?? StaffTime.Today(time).Year;
        var query = db.Workers.AsNoTracking().Where(w => w.Category == WorkerCategories.Employee && w.IsActive);
        if (!string.IsNullOrWhiteSpace(department)) query = query.Where(w => w.Department == department);
        var workers = await query.OrderBy(w => w.WorkerCode).ToListAsync(ct);
        var rows = new List<StaffLeaveBalanceRow>();
        foreach (var w in workers) rows.Add(new(w.Id, w.WorkerCode, w.FullName, w.Department, await BalancesAsync(w.Id, y, ct)));
        return rows;
    }

    // --- requests ----------------------------------------------------------------------------------------------

    private IQueryable<StaffLeaveRequest> QueryRequests() =>
        db.StaffLeaveRequests.AsNoTracking().Include(r => r.Worker).Include(r => r.LeaveType);

    public async Task<List<StaffLeaveDto>> ListAsync(string? status, int? workerId, string? department, int? year, CancellationToken ct)
    {
        var query = QueryRequests();
        if (!string.IsNullOrEmpty(status)) query = query.Where(r => r.Status == status);
        if (workerId is { } id) query = query.Where(r => r.WorkerId == id);
        if (!string.IsNullOrWhiteSpace(department)) query = query.Where(r => r.Worker.Department == department);
        if (year is { } y) query = query.Where(r => r.StartDate.Year == y || r.EndDate.Year == y);
        return (await query.OrderBy(r => r.Status == StaffLeaveStatuses.Pending ? 0 : 1).ThenByDescending(r => r.StartDate).ThenByDescending(r => r.Id).ToListAsync(ct))
            .Select(ToDto).ToList();
    }

    public async Task<StaffResult<StaffLeaveDto>> CreateAsync(int userId, StaffLeaveRequestInput input, CancellationToken ct)
    {
        var worker = await attendance.EmployeeForUserAsync(userId, ct);
        if (worker is null) return StaffResult<StaffLeaveDto>.NotFound("No active employee record is linked to this login.");

        var errors = new Dictionary<string, string[]>();
        var type = input.LeaveTypeId is { } typeId ? await db.StaffLeaveTypes.AsNoTracking().SingleOrDefaultAsync(t => t.Id == typeId && t.IsActive, ct) : null;
        if (type is null) errors["leaveTypeId"] = ["Choose a leave type."];
        var okStart = DateOnly.TryParseExact(input.StartDate, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var start);
        var okEnd = DateOnly.TryParseExact(input.EndDate, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var end);
        if (!okStart) errors["startDate"] = ["Enter a valid start date."];
        if (!okEnd) errors["endDate"] = ["Enter a valid end date."];
        if (okStart && okEnd && end < start) errors["endDate"] = ["The end date must be on or after the start date."];
        if (okStart && okEnd && end.DayNumber - start.DayNumber > 365) errors["endDate"] = ["Leave cannot be longer than a year."];
        var reason = (input.Reason ?? "").Trim();
        if (reason.Length == 0) errors["reason"] = ["Give a reason for the leave."];
        else if (reason.Length > 500) errors["reason"] = ["Reason must be 500 characters or fewer."];
        if (errors.Count > 0) return new(400, Errors: errors);

        var settings = await settingsService.LoadAsync(ct);
        var holidays = (await db.PublicHolidays.AsNoTracking().Where(h => h.Date >= start && h.Date <= end).Select(h => h.Date).ToListAsync(ct)).ToHashSet();
        var days = StaffDayCalculator.WorkingDays(start, end, settings.WeeklyOff, holidays);
        if (days == 0) return StaffResult<StaffLeaveDto>.Invalid("startDate", "Those dates have no working days (weekly off or public holidays only).");

        if (await db.StaffLeaveRequests.AnyAsync(r => r.WorkerId == worker.Id
                && (r.Status == StaffLeaveStatuses.Pending || r.Status == StaffLeaveStatuses.Approved) && r.StartDate <= end && r.EndDate >= start, ct))
            return StaffResult<StaffLeaveDto>.Conflict("You already have a leave request that overlaps these dates.");

        var shortage = await ShortageAsync(worker.Id, type!, start, end, null, ct);
        if (shortage is not null) return StaffResult<StaffLeaveDto>.Invalid("leaveTypeId", shortage);

        var request = new StaffLeaveRequest
        {
            WorkerId = worker.Id, LeaveTypeId = type!.Id, StartDate = start, EndDate = end, Days = days, Reason = reason,
            Status = StaffLeaveStatuses.Pending, CreatedBy = Actor, CreatedUtc = time.GetUtcNow().UtcDateTime,
        };
        db.StaffLeaveRequests.Add(request);
        await db.SaveChangesAsync(ct);
        audit.Write("StaffLeaveRequested", Actor, nameof(StaffLeaveRequest), request.Id.ToString(CultureInfo.InvariantCulture),
            new { workerId = worker.Id, leaveType = type.Name, start = input.StartDate, end = input.EndDate, days });
        await db.SaveChangesAsync(ct);
        return StaffResult<StaffLeaveDto>.Ok(ToDto(await QueryRequests().SingleAsync(r => r.Id == request.Id, ct)));
    }

    /// <summary>A message when the request would take more days than the employee has left this year; null when it fits.</summary>
    private async Task<string?> ShortageAsync(int workerId, StaffLeaveType type, DateOnly start, DateOnly end, int? ignoreRequestId, CancellationToken ct)
    {
        var settings = await settingsService.LoadAsync(ct);
        foreach (var year in Enumerable.Range(start.Year, end.Year - start.Year + 1))
        {
            var holidays = (await db.PublicHolidays.AsNoTracking().Where(h => h.Date.Year == year).Select(h => h.Date).ToListAsync(ct)).ToHashSet();
            var first = start > new DateOnly(year, 1, 1) ? start : new DateOnly(year, 1, 1);
            var last = end < new DateOnly(year, 12, 31) ? end : new DateOnly(year, 12, 31);
            var asking = StaffDayCalculator.WorkingDays(first, last, settings.WeeklyOff, holidays);
            var existing = await db.StaffLeaveRequests.AsNoTracking()
                .Where(r => r.WorkerId == workerId && r.LeaveTypeId == type.Id && r.Id != (ignoreRequestId ?? 0)
                    && (r.Status == StaffLeaveStatuses.Approved || r.Status == StaffLeaveStatuses.Pending)
                    && r.StartDate <= new DateOnly(year, 12, 31) && r.EndDate >= new DateOnly(year, 1, 1)).ToListAsync(ct);
            var taken = existing.Sum(r => DaysInYear(r, year, settings.WeeklyOff, holidays));
            var left = type.YearlyDays - taken;
            if (asking > left)
                return $"{type.Name}: {Math.Max(0, left)} day(s) left in {year}, but this request needs {asking}.";
        }

        return null;
    }

    public async Task<StaffResult<StaffLeaveDto>> CancelAsync(int userId, int id, CancellationToken ct)
    {
        var worker = await attendance.EmployeeForUserAsync(userId, ct);
        var request = await db.StaffLeaveRequests.SingleOrDefaultAsync(r => r.Id == id, ct);
        if (worker is null || request is null || request.WorkerId != worker.Id) return StaffResult<StaffLeaveDto>.NotFound("Leave request not found.");
        if (request.Status != StaffLeaveStatuses.Pending) return StaffResult<StaffLeaveDto>.Conflict("Only a pending request can be cancelled.");
        request.Status = StaffLeaveStatuses.Cancelled;
        audit.Write("StaffLeaveCancelled", Actor, nameof(StaffLeaveRequest), id.ToString(CultureInfo.InvariantCulture));
        await db.SaveChangesAsync(ct);
        return StaffResult<StaffLeaveDto>.Ok(ToDto(await QueryRequests().SingleAsync(r => r.Id == id, ct)));
    }

    /// <summary>The manager approves or rejects a pending request. Nobody decides their own request.</summary>
    public async Task<StaffResult<StaffLeaveDto>> DecideAsync(int deciderUserId, int id, bool approve, string? note, CancellationToken ct)
    {
        var trimmed = (note ?? "").Trim();
        if (trimmed.Length > 300) return StaffResult<StaffLeaveDto>.Invalid("note", "Note must be 300 characters or fewer.");
        if (!approve && trimmed.Length == 0) return StaffResult<StaffLeaveDto>.Invalid("note", "Give a reason when rejecting.");

        var request = await db.StaffLeaveRequests.Include(r => r.Worker).Include(r => r.LeaveType).SingleOrDefaultAsync(r => r.Id == id, ct);
        if (request is null) return StaffResult<StaffLeaveDto>.NotFound("Leave request not found.");
        if (request.Worker.UserId == deciderUserId) return StaffResult<StaffLeaveDto>.Forbidden("You cannot decide your own leave request.");
        if (request.Status != StaffLeaveStatuses.Pending) return StaffResult<StaffLeaveDto>.Conflict("This request has already been decided.");

        if (approve)
        {
            var shortage = await ShortageAsync(request.WorkerId, request.LeaveType, request.StartDate, request.EndDate, request.Id, ct);
            if (shortage is not null) return StaffResult<StaffLeaveDto>.Conflict(shortage);
        }

        request.Status = approve ? StaffLeaveStatuses.Approved : StaffLeaveStatuses.Rejected;
        request.DecidedBy = Actor;
        request.DecidedUtc = time.GetUtcNow().UtcDateTime;
        request.DecisionNote = trimmed.Length == 0 ? null : trimmed;
        audit.Write(approve ? "StaffLeaveApproved" : "StaffLeaveRejected", Actor, nameof(StaffLeaveRequest), id.ToString(CultureInfo.InvariantCulture),
            new { workerId = request.WorkerId, note = request.DecisionNote });
        await db.SaveChangesAsync(ct);
        return StaffResult<StaffLeaveDto>.Ok(ToDto(request));
    }

    private static StaffLeaveDto ToDto(StaffLeaveRequest r) =>
        new(r.Id, r.WorkerId, r.Worker.WorkerCode, r.Worker.FullName, r.Worker.Department, r.LeaveTypeId, r.LeaveType.Name,
            r.StartDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), r.EndDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            r.Days, r.Reason, r.Status, r.CreatedBy, DateTime.SpecifyKind(r.CreatedUtc, DateTimeKind.Utc).ToString("o", CultureInfo.InvariantCulture),
            r.DecidedBy, r.DecidedUtc is { } d ? DateTime.SpecifyKind(d, DateTimeKind.Utc).ToString("o", CultureInfo.InvariantCulture) : null, r.DecisionNote);
}
