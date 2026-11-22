using System.Globalization;
using System.Security.Claims;
using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services.Staff;

/// <summary>Office attendance: signing in and out with a selfie, the worked-out day, review, correction, dashboard and reports.</summary>
public sealed class StaffAttendanceService(
    AppDbContext db, IAuditLogger audit, TimeProvider time, IHttpContextAccessor http, StaffSettingsService settingsService)
{
    public const int MaxRangeDays = 366;
    private const int MinSecondsBetweenPunches = 5;

    private string Actor => http.HttpContext?.User.Identity?.Name ?? "";

    // --- who is signing in -------------------------------------------------------------------------------------

    /// <summary>The office employee linked to this login. Any role can be linked, so the check is the link, not the role.</summary>
    public Task<Worker?> EmployeeForUserAsync(int userId, CancellationToken ct) =>
        db.Workers.AsNoTracking().SingleOrDefaultAsync(w => w.UserId == userId && w.Category == WorkerCategories.Employee && w.IsActive, ct);

    public static int? UserId(ClaimsPrincipal user) =>
        int.TryParse(user.FindFirstValue("sub") ?? user.FindFirstValue(ClaimTypes.NameIdentifier), NumberStyles.None, CultureInfo.InvariantCulture, out var id) ? id : null;

    // --- sign in / out -----------------------------------------------------------------------------------------

    public async Task<StaffResult<StaffMeResponse>> MeAsync(int userId, CancellationToken ct)
    {
        var worker = await EmployeeForUserAsync(userId, ct);
        if (worker is null) return StaffResult<StaffMeResponse>.NotFound("No active employee record is linked to this login.");
        return StaffResult<StaffMeResponse>.Ok(await BuildMeAsync(worker, ct));
    }

    private async Task<StaffMeResponse> BuildMeAsync(Worker worker, CancellationToken ct)
    {
        var settings = await settingsService.LoadAsync(ct);
        var today = StaffTime.Today(time);
        var days = await BuildDaysAsync([worker], today, today, ct);
        var punches = await db.StaffPunches.AsNoTracking()
            .Where(p => p.WorkerId == worker.Id && p.WorkDate == today && !p.IsVoided)
            .OrderBy(p => p.TimestampUtc).ToListAsync(ct);
        var withSelfie = await SelfieIdsAsync(punches.Select(p => p.Id), ct);
        var day = days[worker.Id].SingleOrDefault() ?? StaffDayCalculator.Compute(today, StaffTime.NowLocal(time), settings, null, null, [], null)!;
        var next = punches.Count > 0 && punches[^1].Kind == PunchKinds.In ? PunchKinds.Out : PunchKinds.In;
        // Today's holiday name, or "Weekly off": the app warns before a sign-in on a day nobody is expected to work.
        var holiday = await db.PublicHolidays.AsNoTracking().Where(h => h.Date == today).Select(h => h.Name).FirstOrDefaultAsync(ct);
        var dayType = holiday ?? (today.DayOfWeek == settings.WeeklyOff ? "Weekly off" : null);
        return new StaffMeResponse(worker.Id, worker.WorkerCode, worker.FullName, worker.Department,
            settings.ShiftStart.ToString("HH:mm", CultureInfo.InvariantCulture), settings.ShiftEnd.ToString("HH:mm", CultureInfo.InvariantCulture),
            settings.OfficeCheckOn, day, next, punches.Select(p => ToDto(p, withSelfie.Contains(p.Id))).ToList(), dayType);
    }

    public async Task<StaffResult<StaffProfile>> ProfileAsync(int userId, CancellationToken ct)
    {
        var w = await EmployeeForUserAsync(userId, ct);
        if (w is null) return StaffResult<StaffProfile>.NotFound("No active employee record is linked to this login.");
        var user = await db.Users.AsNoTracking().SingleAsync(u => u.Id == userId, ct);
        return StaffResult<StaffProfile>.Ok(new StaffProfile(w.Id, w.WorkerCode, w.FullName, w.Designation, w.Department,
            w.JoinDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), w.Nationality, w.EmiratesId, w.PassportNumber, w.Phone,
            w.Email, w.EmergencyContact, w.WorkLocation, user.Username, user.Role,
            await db.WorkerPhotos.AsNoTracking().AnyAsync(p => p.WorkerId == w.Id, ct)));
    }

    public async Task<StaffResult<StaffMeResponse>> PunchAsync(int userId, PunchRequest request, CancellationToken ct)
    {
        var worker = await EmployeeForUserAsync(userId, ct);
        if (worker is null) return StaffResult<StaffMeResponse>.NotFound("No active employee record is linked to this login.");

        if (string.IsNullOrEmpty(request.SelfieBase64) || !PhotoUpload.TryDecode(request.SelfieBase64, out var selfie) || selfie is null)
            return StaffResult<StaffMeResponse>.Invalid("selfie", "Take a selfie to sign in or out.");

        var hasLat = request.Latitude is not null;
        var hasLng = request.Longitude is not null;
        if (hasLat != hasLng || request.Latitude is < -90 or > 90 || request.Longitude is < -180 or > 180)
            return StaffResult<StaffMeResponse>.Invalid("location", "The location sent was not valid.");

        var settings = await settingsService.LoadAsync(ct);
        var nowUtc = time.GetUtcNow().UtcDateTime;
        var today = StaffTime.Today(time);

        var last = await db.StaffPunches.AsNoTracking()
            .Where(p => p.WorkerId == worker.Id && p.WorkDate == today && !p.IsVoided)
            .OrderByDescending(p => p.TimestampUtc).FirstOrDefaultAsync(ct);
        if (last is not null && (nowUtc - last.TimestampUtc).TotalSeconds < MinSecondsBetweenPunches)
            return StaffResult<StaffMeResponse>.Conflict("That was recorded a moment ago. Wait a few seconds before trying again.");

        double? distance = hasLat && settings.OfficeCheckOn
            ? StaffDayCalculator.DistanceMeters(request.Latitude!.Value, request.Longitude!.Value, settings.OfficeLatitude!.Value, settings.OfficeLongitude!.Value)
            : null;
        var outside = false;
        if (settings.OfficeCheckOn)
        {
            // GPS is rarely exact, so the reported accuracy (up to 50 m) is given back to the employee before flagging.
            var allowance = Math.Min(request.AccuracyMeters ?? 0, 50);
            outside = distance is null || distance.Value - allowance > settings.OfficeRadiusMeters!.Value;
        }

        var punch = new StaffPunch
        {
            WorkerId = worker.Id,
            Kind = last is not null && last.Kind == PunchKinds.In ? PunchKinds.Out : PunchKinds.In,
            TimestampUtc = nowUtc,
            WorkDate = today,
            Latitude = request.Latitude,
            Longitude = request.Longitude,
            AccuracyMeters = request.AccuracyMeters,
            DistanceMeters = distance is null ? null : Math.Round(distance.Value, 1),
            OutsideOffice = outside,
            Source = "Self",
            CreatedBy = Actor,
        };
        db.StaffPunches.Add(punch);
        db.StaffPunchSelfies.Add(new StaffPunchSelfie { Punch = punch, Data = selfie });
        await db.SaveChangesAsync(ct);
        audit.Write(punch.Kind == PunchKinds.In ? "StaffSignedIn" : "StaffSignedOut", Actor, nameof(StaffPunch),
            punch.Id.ToString(CultureInfo.InvariantCulture), new { workerId = worker.Id, outsideOffice = outside });
        await db.SaveChangesAsync(ct);
        return StaffResult<StaffMeResponse>.Ok(await BuildMeAsync(worker, ct));
    }

    public async Task<StaffResult<List<StaffDay>>> MyDaysAsync(int userId, string? from, string? to, CancellationToken ct)
    {
        var worker = await EmployeeForUserAsync(userId, ct);
        if (worker is null) return StaffResult<List<StaffDay>>.NotFound("No active employee record is linked to this login.");
        if (!TryRange(from, to, out var start, out var end, out var error)) return new(400, Errors: error);
        var days = await BuildDaysAsync([worker], start, end, ct);
        return StaffResult<List<StaffDay>>.Ok(days[worker.Id].OrderByDescending(d => d.Date).ToList());
    }

    public async Task<StaffResult<StaffDayDetail>> MyDayDetailAsync(int userId, string? date, CancellationToken ct)
    {
        var worker = await EmployeeForUserAsync(userId, ct);
        if (worker is null) return StaffResult<StaffDayDetail>.NotFound("No active employee record is linked to this login.");
        return await DetailAsync(worker.Id, date, ct);
    }

    // --- review ------------------------------------------------------------------------------------------------

    private IQueryable<Worker> Employees(string? department, int? workerId = null)
    {
        var query = db.Workers.AsNoTracking().Where(w => w.Category == WorkerCategories.Employee && w.IsActive);
        if (!string.IsNullOrWhiteSpace(department)) query = query.Where(w => w.Department == department);
        if (workerId is { } id) query = query.Where(w => w.Id == id);
        return query.OrderBy(w => w.WorkerCode);
    }

    public async Task<StaffResult<List<StaffDayRow>>> DayRowsAsync(string? date, string? department, CancellationToken ct)
    {
        if (!TryDate(date, out var day)) return StaffResult<List<StaffDayRow>>.Invalid("date", "Enter a valid date.");
        var workers = await Employees(department).ToListAsync(ct);
        return StaffResult<List<StaffDayRow>>.Ok(await RowsAsync(workers, day, day, ct));
    }

    public async Task<StaffResult<StaffDayDetail>> DetailAsync(int workerId, string? date, CancellationToken ct)
    {
        if (!TryDate(date, out var day)) return StaffResult<StaffDayDetail>.Invalid("date", "Enter a valid date.");
        var worker = await db.Workers.AsNoTracking().SingleOrDefaultAsync(w => w.Id == workerId && w.Category == WorkerCategories.Employee, ct);
        if (worker is null) return StaffResult<StaffDayDetail>.NotFound("Office employee not found.");
        var rows = await RowsAsync([worker], day, day, ct);
        var punches = await db.StaffPunches.AsNoTracking().Where(p => p.WorkerId == workerId && p.WorkDate == day)
            .OrderBy(p => p.TimestampUtc).ToListAsync(ct);
        var withSelfie = await SelfieIdsAsync(punches.Select(p => p.Id), ct);
        var row = rows.SingleOrDefault() ?? new StaffDayRow(worker.Id, worker.WorkerCode, worker.FullName, worker.Department,
            new StaffDay(day, "Not recorded", 0, 0, 0, null, null, false, false, false, false, 0, null));
        return StaffResult<StaffDayDetail>.Ok(new StaffDayDetail(row, punches.Select(p => ToDto(p, withSelfie.Contains(p.Id))).ToList()));
    }

    public async Task<(byte[] Data, int WorkerId)?> SelfieAsync(long punchId, CancellationToken ct)
    {
        var row = await db.StaffPunchSelfies.AsNoTracking().Where(s => s.PunchId == punchId)
            .Select(s => new { s.Data, s.Punch.WorkerId }).SingleOrDefaultAsync(ct);
        return row is null ? null : (row.Data, row.WorkerId);
    }

    public Task<bool> OwnsWorkerAsync(int userId, int workerId, CancellationToken ct) =>
        db.Workers.AsNoTracking().AnyAsync(w => w.Id == workerId && w.UserId == userId, ct);

    /// <summary>HR or a manager adds a missing sign-in or sign-out. A reason is required and the change is audited.</summary>
    /// <summary>Nobody corrects their own attendance: a second person must, so a record can never be edited by the one it benefits.</summary>
    private const string OwnAttendanceMessage = "You cannot add or change your own attendance. Ask a manager to correct it.";

    public async Task<StaffResult<StaffDayDetail>> AddManualPunchAsync(ManualPunchRequest request, int actingUserId, CancellationToken ct)
    {
        var reason = (request.Reason ?? "").Trim();
        if (reason.Length == 0) return StaffResult<StaffDayDetail>.Invalid("reason", "A reason is required.");
        if (reason.Length > 300) return StaffResult<StaffDayDetail>.Invalid("reason", "Reason must be 300 characters or fewer.");
        if (request.Kind is not (PunchKinds.In or PunchKinds.Out)) return StaffResult<StaffDayDetail>.Invalid("kind", "Choose Sign in or Sign out.");
        if (!TryDate(request.Date, out var day)) return StaffResult<StaffDayDetail>.Invalid("date", "Enter a valid date.");
        if (day > StaffTime.Today(time)) return StaffResult<StaffDayDetail>.Invalid("date", "The date cannot be in the future.");
        if (!TimeOnly.TryParseExact(request.Time, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var at))
            return StaffResult<StaffDayDetail>.Invalid("time", "Enter the time as HH:mm.");
        var worker = request.WorkerId is { } id
            ? await db.Workers.AsNoTracking().SingleOrDefaultAsync(w => w.Id == id && w.Category == WorkerCategories.Employee, ct)
            : null;
        if (worker is null) return StaffResult<StaffDayDetail>.Invalid("workerId", "Choose an office employee.");
        if (worker.UserId == actingUserId) return StaffResult<StaffDayDetail>.Forbidden(OwnAttendanceMessage);

        var stamp = StaffTime.ToUtc(day, at);
        if (stamp > time.GetUtcNow().UtcDateTime) return StaffResult<StaffDayDetail>.Invalid("time", "The time cannot be in the future.");

        var punch = new StaffPunch
        {
            WorkerId = worker.Id, Kind = request.Kind, TimestampUtc = stamp, WorkDate = day, Source = "Manual",
            Reason = reason, CreatedBy = Actor,
        };
        db.StaffPunches.Add(punch);
        await db.SaveChangesAsync(ct);
        audit.Write("StaffPunchAdded", Actor, nameof(StaffPunch), punch.Id.ToString(CultureInfo.InvariantCulture),
            new { workerId = worker.Id, date = request.Date, time = request.Time, kind = request.Kind, reason });
        await db.SaveChangesAsync(ct);
        return await DetailAsync(worker.Id, request.Date, ct);
    }

    public async Task<StaffResult<StaffDayDetail>> VoidPunchAsync(long punchId, VoidPunchRequest request, int actingUserId, CancellationToken ct)
    {
        var reason = (request.Reason ?? "").Trim();
        if (reason.Length == 0) return StaffResult<StaffDayDetail>.Invalid("reason", "A reason is required.");
        if (reason.Length > 300) return StaffResult<StaffDayDetail>.Invalid("reason", "Reason must be 300 characters or fewer.");
        var punch = await db.StaffPunches.SingleOrDefaultAsync(p => p.Id == punchId, ct);
        if (punch is null) return StaffResult<StaffDayDetail>.NotFound("Sign-in record not found.");
        if (punch.IsVoided) return StaffResult<StaffDayDetail>.Conflict("That record is already voided.");
        if (await db.Workers.AsNoTracking().AnyAsync(w => w.Id == punch.WorkerId && w.UserId == actingUserId, ct))
            return StaffResult<StaffDayDetail>.Forbidden(OwnAttendanceMessage);

        punch.IsVoided = true;
        punch.VoidReason = reason;
        punch.VoidedBy = Actor;
        punch.VoidedUtc = time.GetUtcNow().UtcDateTime;
        audit.Write("StaffPunchVoided", Actor, nameof(StaffPunch), punchId.ToString(CultureInfo.InvariantCulture),
            new { workerId = punch.WorkerId, kind = punch.Kind, date = punch.WorkDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), reason });
        await db.SaveChangesAsync(ct);
        return await DetailAsync(punch.WorkerId, punch.WorkDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), ct);
    }

    // --- dashboard and reports ---------------------------------------------------------------------------------

    public async Task<StaffDashboard> DashboardAsync(CancellationToken ct)
    {
        var today = StaffTime.Today(time);
        var workers = await Employees(null).ToListAsync(ct);
        var rows = await RowsAsync(workers, today, today, ct);
        var settings = await settingsService.LoadAsync(ct);
        var holiday = await db.PublicHolidays.AsNoTracking().Where(h => h.Date == today).Select(h => h.Name).FirstOrDefaultAsync(ct);
        var dayType = holiday ?? (today.DayOfWeek == settings.WeeklyOff ? "Weekly off" : null);
        var attention = rows.Where(r => r.Day.IsLate || r.Day.MissingSignOut || r.Day.OutsideOffice || r.Day.Status == StaffStatuses.Absent).ToList();
        return new StaffDashboard(today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), dayType, workers.Count,
            rows.Count(r => r.Day.PunchCount > 0), rows.Count(r => r.Day.IsLate), rows.Count(r => r.Day.Status == StaffStatuses.Absent),
            rows.Count(r => r.Day.OutsideOffice), rows.Count(r => r.Day.MissingSignOut), rows.Count(r => r.Day.Status == StaffStatuses.OnLeave),
            rows.Count(r => r.Day.Status == StaffStatuses.NotInYet), attention);
    }

    public async Task<StaffResult<StaffReport>> ReportAsync(string? from, string? to, string? department, int? workerId, CancellationToken ct)
    {
        if (!TryRange(from, to, out var start, out var end, out var errors)) return new(400, Errors: errors);
        var workers = await Employees(department, workerId).ToListAsync(ct);
        var rows = await RowsAsync(workers, start, end, ct);
        var report = rows.GroupBy(r => r.WorkerId).Select(g =>
        {
            var first = g.First();
            return new StaffReportRow(first.WorkerId, first.Code, first.Name, first.Department,
                g.Count(r => r.Day.PunchCount > 0), g.Count(r => r.Day.IsLate), g.Sum(r => r.Day.LateMinutes),
                g.Count(r => r.Day.IsEarlyLeave), g.Sum(r => r.Day.EarlyLeaveMinutes), g.Count(r => r.Day.Status == StaffStatuses.Absent),
                g.Count(r => r.Day.Status == StaffStatuses.OnLeave), g.Count(r => r.Day.Status == StaffStatuses.WeeklyOff),
                g.Count(r => r.Day.Status == StaffStatuses.PublicHoliday), g.Count(r => r.Day.MissingSignOut),
                g.Count(r => r.Day.OutsideOffice), g.Sum(r => r.Day.Hours));
        }).OrderBy(r => r.Code).ToList();
        // Employees with no worked-out day in the range (joined later) still appear with zeros.
        foreach (var w in workers.Where(w => report.All(r => r.WorkerId != w.Id)))
            report.Add(new StaffReportRow(w.Id, w.WorkerCode, w.FullName, w.Department, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0));
        return StaffResult<StaffReport>.Ok(new StaffReport(
            start.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), end.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            report.OrderBy(r => r.Code).ToList(), rows));
    }

    /// <summary>The employee payroll summary for a month (yyyy-MM): salary beside attendance. Months still running count up to today.</summary>
    public async Task<StaffResult<StaffPayrollSummary>> PayrollSummaryAsync(string? month, CancellationToken ct)
    {
        if (!DateOnly.TryParseExact((month ?? "") + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var first))
            return StaffResult<StaffPayrollSummary>.Invalid("month", "Enter a valid month in yyyy-MM format.");
        var last = first.AddMonths(1).AddDays(-1);
        var today = StaffTime.Today(time);
        if (first > today) return StaffResult<StaffPayrollSummary>.Invalid("month", "Choose this month or an earlier one.");
        if (last > today) last = today;

        var workers = await Employees(null).ToListAsync(ct);
        var rows = await RowsAsync(workers, first, last, ct);
        var settings = await settingsService.LoadAsync(ct);
        var manual = (await (from d in db.WorkerDeductions.AsNoTracking()
                             join t in db.DeductionTypes.AsNoTracking() on d.DeductionTypeId equals t.Id
                             where d.Year == first.Year && d.Month == first.Month
                             orderby t.Name
                             select new { d.WorkerId, t.Name, d.Note, d.Amount }).ToListAsync(ct))
            .ToLookup(x => x.WorkerId, x => new StaffOtherDeduction(x.Name, x.Note, x.Amount));
        var result = workers.Select(w =>
        {
            var mine = rows.Where(r => r.WorkerId == w.Id).Select(r => r.Day).ToList();
            var salary = w.EffectiveSalary;
            var absent = mine.Count(d => d.Status == StaffStatuses.Absent);
            var lateMinutes = mine.Sum(d => d.LateMinutes);
            // A month is 30 days for pay, as in site-worker payroll; each deduction is capped so pay never goes below zero.
            var absentCut = settings.DeductAbsentDays ? decimal.Round(salary / 30m * absent, 2, MidpointRounding.AwayFromZero) : 0m;
            var lateCut = decimal.Round(settings.LateDeductionPerMinute * lateMinutes, 2, MidpointRounding.AwayFromZero);
            var cut = Math.Min(salary, absentCut + lateCut);
            if (absentCut + lateCut > cut) { lateCut = Math.Max(0, cut - absentCut); absentCut = Math.Min(absentCut, cut); }
            // Advances, loans and other deductions from the Deductions page; pay still never goes below zero.
            var items = manual[w.Id].ToList();
            var other = Math.Min(items.Sum(i => i.Amount), salary - cut);
            return new StaffPayrollRow(w.Id, w.WorkerCode, w.FullName, w.Department, salary,
                mine.Count(d => d.Status is not (StaffStatuses.WeeklyOff or StaffStatuses.PublicHoliday)),
                mine.Count(d => d.PunchCount > 0), absent, mine.Count(d => d.Status == StaffStatuses.OnLeave),
                mine.Count(d => d.IsLate), lateMinutes, mine.Sum(d => d.EarlyLeaveMinutes), mine.Sum(d => d.Hours),
                absentCut, lateCut, salary - cut - other, other, items);
        }).ToList();
        return StaffResult<StaffPayrollSummary>.Ok(new StaffPayrollSummary(
            first.ToString("yyyy-MM", CultureInfo.InvariantCulture), first.ToString("MMMM yyyy", CultureInfo.InvariantCulture), result,
            result.Sum(r => r.MonthlySalary), result.Sum(r => r.AbsentDeduction + r.LateDeduction + r.OtherDeduction), result.Sum(r => r.NetSalary),
            settings.DeductAbsentDays, settings.LateDeductionPerMinute));
    }

    // --- the worked-out days -----------------------------------------------------------------------------------

    private async Task<List<StaffDayRow>> RowsAsync(List<Worker> workers, DateOnly start, DateOnly end, CancellationToken ct)
    {
        var days = await BuildDaysAsync(workers, start, end, ct);
        return workers.SelectMany(w => days[w.Id].Select(d => new StaffDayRow(w.Id, w.WorkerCode, w.FullName, w.Department, d)))
            .OrderBy(r => r.Day.Date).ThenBy(r => r.Code).ToList();
    }

    /// <summary>The days of each employee between <paramref name="start"/> and <paramref name="end"/>, oldest first.</summary>
    public async Task<Dictionary<int, List<StaffDay>>> BuildDaysAsync(IReadOnlyList<Worker> workers, DateOnly start, DateOnly end, CancellationToken ct)
    {
        var ids = workers.Select(w => w.Id).ToArray();
        var settings = await settingsService.LoadAsync(ct);
        var nowLocal = StaffTime.NowLocal(time);

        var holidays = await db.PublicHolidays.AsNoTracking().Where(h => h.Date >= start && h.Date <= end)
            .ToDictionaryAsync(h => h.Date, h => h.Name, ct);
        var punches = (await db.StaffPunches.AsNoTracking()
            .Where(p => ids.Contains(p.WorkerId) && p.WorkDate >= start && p.WorkDate <= end && !p.IsVoided)
            .Select(p => new { p.WorkerId, p.WorkDate, p.Kind, p.TimestampUtc, p.OutsideOffice }).ToListAsync(ct))
            .ToLookup(p => (p.WorkerId, p.WorkDate));
        var leaves = await db.StaffLeaveRequests.AsNoTracking()
            .Where(l => ids.Contains(l.WorkerId) && l.Status == StaffLeaveStatuses.Approved && l.StartDate <= end && l.EndDate >= start)
            .Select(l => new { l.WorkerId, l.StartDate, l.EndDate, Type = l.LeaveType.Name }).ToListAsync(ct);

        var result = new Dictionary<int, List<StaffDay>>();
        foreach (var worker in workers)
        {
            var list = new List<StaffDay>();
            var join = worker.JoinDate;
            for (var d = start; d <= end; d = d.AddDays(1))
            {
                var leave = leaves.FirstOrDefault(l => l.WorkerId == worker.Id && l.StartDate <= d && l.EndDate >= d)?.Type;
                var points = punches[(worker.Id, d)].Select(p => new PunchPoint(p.Kind, p.TimestampUtc, p.OutsideOffice)).ToList();
                var day = StaffDayCalculator.Compute(d, nowLocal, settings, holidays.GetValueOrDefault(d), leave, points, join);
                if (day is not null) list.Add(day);
            }
            result[worker.Id] = list;
        }

        return result;
    }

    // --- helpers -----------------------------------------------------------------------------------------------

    private async Task<HashSet<long>> SelfieIdsAsync(IEnumerable<long> punchIds, CancellationToken ct)
    {
        var ids = punchIds.ToArray();
        return ids.Length == 0 ? [] : (await db.StaffPunchSelfies.AsNoTracking().Where(s => ids.Contains(s.PunchId)).Select(s => s.PunchId).ToListAsync(ct)).ToHashSet();
    }

    private static PunchDto ToDto(StaffPunch p, bool hasSelfie) =>
        new(p.Id, p.Kind, p.WorkDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            StaffTime.ToLocal(p.TimestampUtc).ToString("HH:mm:ss", CultureInfo.InvariantCulture), p.OutsideOffice, p.Latitude, p.Longitude,
            p.DistanceMeters, p.Source, p.Reason, hasSelfie, p.IsVoided, p.VoidReason, p.CreatedBy);

    private static bool TryDate(string? text, out DateOnly date) =>
        DateOnly.TryParseExact(text, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out date);

    private static bool TryRange(string? from, string? to, out DateOnly start, out DateOnly end, out Dictionary<string, string[]> errors)
    {
        errors = [];
        start = end = default;
        if (!TryDate(from, out start)) errors["from"] = ["Enter a valid start date."];
        if (!TryDate(to, out end)) errors["to"] = ["Enter a valid end date."];
        if (errors.Count == 0 && end < start) errors["to"] = ["The end date must be on or after the start date."];
        if (errors.Count == 0 && end.DayNumber - start.DayNumber >= MaxRangeDays) errors["to"] = [$"Choose a range of at most {MaxRangeDays} days."];
        return errors.Count == 0;
    }
}
