using System.Globalization;
using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services.Staff;

/// <summary>Shift, weekly off, office location and the public holiday list for office attendance.</summary>
public sealed class StaffSettingsService(AppDbContext db, IAuditLogger audit)
{
    public async Task<StaffSettings> LoadAsync(CancellationToken ct) =>
        await db.StaffSettings.AsNoTracking().SingleAsync(s => s.Id == StaffSettings.SingletonId, ct);

    public static StaffSettingsDto ToDto(StaffSettings s) =>
        new(s.ShiftStart.ToString("HH:mm", CultureInfo.InvariantCulture), s.ShiftEnd.ToString("HH:mm", CultureInfo.InvariantCulture),
            s.LateGraceMinutes, s.EarlyGraceMinutes, (int)s.WeeklyOff, s.OfficeLatitude, s.OfficeLongitude, s.OfficeRadiusMeters,
            s.DeductAbsentDays, s.LateDeductionPerMinute);

    public async Task<StaffSettingsDto> GetAsync(CancellationToken ct) => ToDto(await LoadAsync(ct));

    public async Task<StaffResult<StaffSettingsDto>> SaveAsync(StaffSettingsDto request, CancellationToken ct)
    {
        var errors = new Dictionary<string, string[]>();
        if (!TimeOnly.TryParseExact(request.ShiftStart, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var start))
            errors["shiftStart"] = ["Enter the shift start as HH:mm."];
        if (!TimeOnly.TryParseExact(request.ShiftEnd, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var end))
            errors["shiftEnd"] = ["Enter the shift end as HH:mm."];
        if (errors.Count == 0 && end <= start) errors["shiftEnd"] = ["The shift must end after it starts."];
        if (request.LateGraceMinutes is null or < 0 or > 180) errors["lateGraceMinutes"] = ["Grace must be 0 to 180 minutes."];
        if (request.EarlyGraceMinutes is null or < 0 or > 180) errors["earlyGraceMinutes"] = ["Grace must be 0 to 180 minutes."];
        if (request.WeeklyOff is null or < 0 or > 6) errors["weeklyOff"] = ["Choose the weekly off day."];

        var hasLat = request.OfficeLatitude is not null;
        var hasLng = request.OfficeLongitude is not null;
        if (hasLat != hasLng) errors["officeLatitude"] = ["Enter both latitude and longitude, or leave both empty."];
        if (request.OfficeLatitude is < -90 or > 90) errors["officeLatitude"] = ["Latitude must be between -90 and 90."];
        if (request.OfficeLongitude is < -180 or > 180) errors["officeLongitude"] = ["Longitude must be between -180 and 180."];
        if (request.OfficeRadiusMeters is < 10 or > 50000) errors["officeRadiusMeters"] = ["Radius must be 10 to 50000 metres."];
        if (hasLat && request.OfficeRadiusMeters is null) errors["officeRadiusMeters"] = ["Enter the allowed radius in metres."];
        if (request.LateDeductionPerMinute is < 0 or > 1000) errors["lateDeductionPerMinute"] = ["Enter 0 to 1000 AED per minute."];
        if (request.LateDeductionPerMinute is { } rate && decimal.Round(rate, 2) != rate) errors["lateDeductionPerMinute"] = ["Use at most 2 decimal places."];
        if (errors.Count > 0) return new(400, Errors: errors);

        var s = await db.StaffSettings.SingleAsync(x => x.Id == StaffSettings.SingletonId, ct);
        var before = ToDto(s);
        s.ShiftStart = start;
        s.ShiftEnd = end;
        s.LateGraceMinutes = request.LateGraceMinutes!.Value;
        s.EarlyGraceMinutes = request.EarlyGraceMinutes!.Value;
        s.WeeklyOff = (DayOfWeek)request.WeeklyOff!.Value;
        s.OfficeLatitude = request.OfficeLatitude;
        s.OfficeLongitude = request.OfficeLongitude;
        s.OfficeRadiusMeters = hasLat ? request.OfficeRadiusMeters : null;
        if (request.DeductAbsentDays is { } absent) s.DeductAbsentDays = absent;      // not sent = left as it is
        if (request.LateDeductionPerMinute is { } late) s.LateDeductionPerMinute = late;
        var after = ToDto(s);
        if (before != after)
        {
            audit.Write("StaffSettingsUpdated", entityType: nameof(StaffSettings), entityId: "1", details: new { before, after });
            await db.SaveChangesAsync(ct);
        }

        return StaffResult<StaffSettingsDto>.Ok(after);
    }

    public async Task<List<HolidayDto>> HolidaysAsync(int? year, CancellationToken ct)
    {
        var query = db.PublicHolidays.AsNoTracking();
        if (year is { } y) query = query.Where(h => h.Date.Year == y);
        return (await query.OrderBy(h => h.Date).ToListAsync(ct)).Select(Dto).ToList();
    }

    public async Task<StaffResult<HolidayDto>> AddHolidayAsync(HolidayRequest request, CancellationToken ct)
    {
        if (!DateOnly.TryParseExact(request.Date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
            return StaffResult<HolidayDto>.Invalid("date", "Enter a valid date.");
        var name = (request.Name ?? "").Trim();
        if (name.Length == 0) return StaffResult<HolidayDto>.Invalid("name", "Holiday name is required.");
        if (name.Length > 100) return StaffResult<HolidayDto>.Invalid("name", "Holiday name must be 100 characters or fewer.");
        if (await db.PublicHolidays.AnyAsync(h => h.Date == date, ct))
            return StaffResult<HolidayDto>.Invalid("date", "That date is already a public holiday.");

        var holiday = new PublicHoliday { Date = date, Name = name };
        db.PublicHolidays.Add(holiday);
        await db.SaveChangesAsync(ct);
        audit.Write("PublicHolidayAdded", entityType: nameof(PublicHoliday), entityId: holiday.Id.ToString(CultureInfo.InvariantCulture), details: new { date = request.Date, name });
        await db.SaveChangesAsync(ct);
        return StaffResult<HolidayDto>.Ok(Dto(holiday));
    }

    public async Task<bool> DeleteHolidayAsync(int id, CancellationToken ct)
    {
        var holiday = await db.PublicHolidays.SingleOrDefaultAsync(h => h.Id == id, ct);
        if (holiday is null) return false;
        db.PublicHolidays.Remove(holiday);
        audit.Write("PublicHolidayRemoved", entityType: nameof(PublicHoliday), entityId: id.ToString(CultureInfo.InvariantCulture),
            details: new { date = holiday.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), holiday.Name });
        await db.SaveChangesAsync(ct);
        return true;
    }

    private static HolidayDto Dto(PublicHoliday h) => new(h.Id, h.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), h.Name);
}
