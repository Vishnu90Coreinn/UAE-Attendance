using HrPayroll.Api.Auth;
using HrPayroll.Api.Dtos;
using HrPayroll.Api.Services;
using HrPayroll.Api.Services.Staff;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace HrPayroll.Api.Controllers;

/// <summary>Office employees: sign-in and sign-out with a selfie, attendance review and reports, settings, and leave.</summary>
[ApiController]
[Route("api/staff")]
public sealed class StaffController(
    StaffAttendanceService attendance, StaffLeaveService leave, StaffSettingsService settings, StaffExportService exports,
    EmployeeLoginService logins, StaffPayslipService payslips,
    CertificateRequestService letterRequests, LetterService letters, LetterPdf letterPdf) : ControllerBase
{
    private int UserId => StaffAttendanceService.UserId(User) ?? 0;

    private IActionResult Map<T>(StaffResult<T> r) => r.Status switch
    {
        200 => Ok(r.Value),
        400 => ValidationProblem(new ValidationProblemDetails(r.Errors!)),
        403 => Problem(statusCode: 403, title: r.Title),
        404 => Problem(statusCode: 404, title: r.Title ?? "Not found."),
        _ => Problem(statusCode: r.Status, title: r.Title),
    };

    // --- the signed-in employee's own pages --------------------------------------------------------------------

    [HttpGet("me")]
    [Authorize(Policy = Policies.AnyUser)]
    public async Task<IActionResult> Me(CancellationToken ct) => Map(await attendance.MeAsync(UserId, ct));

    [HttpGet("me/profile")]
    [Authorize(Policy = Policies.AnyUser)]
    public async Task<IActionResult> MyProfile(CancellationToken ct) => Map(await attendance.ProfileAsync(UserId, ct));

    [HttpPost("me/punch")]
    [Authorize(Policy = Policies.AnyUser)]
    public async Task<IActionResult> Punch(PunchRequest request, CancellationToken ct) => Map(await attendance.PunchAsync(UserId, request, ct));

    [HttpGet("me/days")]
    [Authorize(Policy = Policies.AnyUser)]
    public async Task<IActionResult> MyDays([FromQuery] string? from, [FromQuery] string? to, CancellationToken ct) =>
        Map(await attendance.MyDaysAsync(UserId, from, to, ct));

    [HttpGet("me/day")]
    [Authorize(Policy = Policies.AnyUser)]
    public async Task<IActionResult> MyDay([FromQuery] string? date, CancellationToken ct) => Map(await attendance.MyDayDetailAsync(UserId, date, ct));

    [HttpGet("me/leave")]
    [Authorize(Policy = Policies.AnyUser)]
    public async Task<IActionResult> MyLeave(CancellationToken ct) => Map(await leave.MineAsync(UserId, ct));

    [HttpPost("me/leave")]
    [Authorize(Policy = Policies.AnyUser)]
    public async Task<IActionResult> RequestLeave(StaffLeaveRequestInput input, CancellationToken ct)
    {
        var result = await leave.CreateAsync(UserId, input, ct);
        return result.Status == 200 ? StatusCode(201, result.Value) : Map(result);
    }

    /// <summary>The employee's own leave document (a medical certificate, for example).</summary>
    [HttpGet("me/leave/{id:int}/attachment")]
    [Authorize(Policy = Policies.AnyUser)]
    public async Task<IActionResult> MyLeaveDocument(int id, CancellationToken ct) => await Document(id, UserId, ct);

    [HttpGet("leave/{id:int}/attachment")]
    [Authorize(Policy = Policies.ManagerAdminOrHr)]
    public async Task<IActionResult> LeaveDocument(int id, CancellationToken ct) => await Document(id, null, ct);

    private async Task<IActionResult> Document(int id, int? ownerUserId, CancellationToken ct)
    {
        var data = await leave.AttachmentAsync(id, ownerUserId, ct);
        if (data is null) return Problem(statusCode: 404, title: "No document is attached to this leave request.");
        Response.Headers.CacheControl = "private, no-store";
        return File(data, "image/jpeg");
    }

    // --- HR letters: an employee raises a request; only a Manager prepares it --------------------------------------

    [HttpGet("me/letters")]
    [Authorize(Policy = Policies.AnyUser)]
    public async Task<IActionResult> MyLetters(CancellationToken ct)
    {
        var worker = await attendance.EmployeeForUserAsync(UserId, ct);
        return worker is null ? Problem(statusCode: 404, title: "No active employee record is linked to this login.") : Ok(await letterRequests.ListForWorkerAsync(worker.Id, ct));
    }

    [HttpPost("me/letters")]
    [Authorize(Policy = Policies.AnyUser)]
    public async Task<IActionResult> RequestLetter(MyLetterRequest request, CancellationToken ct)
    {
        var worker = await attendance.EmployeeForUserAsync(UserId, ct);
        if (worker is null) return Problem(statusCode: 404, title: "No active employee record is linked to this login.");
        var result = await letterRequests.CreateAsync(new CertificateRequestCreate(worker.Id, request.LetterType, request.Reason), ct);
        return result.StatusCode switch
        {
            201 => StatusCode(201, result.Body),
            400 => ValidationProblem(new ValidationProblemDetails(result.Errors!)),
            _ => Problem(statusCode: result.StatusCode, title: result.Message),
        };
    }

    /// <summary>The employee's own approved letter as a PDF.</summary>
    [HttpGet("me/letters/{id:int}/pdf")]
    [Authorize(Policy = Policies.AnyUser)]
    public async Task<IActionResult> MyLetterPdf(int id, CancellationToken ct)
    {
        var worker = await attendance.EmployeeForUserAsync(UserId, ct);
        if (worker is null) return Problem(statusCode: 404, title: "No active employee record is linked to this login.");
        var letterId = await letterRequests.IssuedLetterIdAsync(worker.Id, id, ct);
        var loaded = letterId is { } lid ? await letters.LoadForPdfAsync(lid, ct) : null;
        if (loaded is null) return Problem(statusCode: 404, title: "This letter has not been issued yet.");
        try
        {
            Response.Headers.CacheControl = "private, no-store";
            return File(letterPdf.Generate(loaded.Value.Content, loaded.Value.Settings), "application/pdf", loaded.Value.RefNo.Replace('/', '-') + ".pdf");
        }
        catch (PdfTextNotSupportedException)
        {
            return Problem(statusCode: 422, title: "The PDF supports English text. Ask HR to update your details.");
        }
    }

    [HttpPost("me/leave/{id:int}/cancel")]
    [Authorize(Policy = Policies.AnyUser)]
    public async Task<IActionResult> CancelLeave(int id, CancellationToken ct) => Map(await leave.CancelAsync(UserId, id, ct));

    /// <summary>A selfie: HR, managers and the Partner see any; an employee sees only their own.</summary>
    [HttpGet("punches/{id:long}/selfie")]
    [Authorize(Policy = Policies.AnyUser)]
    public async Task<IActionResult> Selfie(long id, CancellationToken ct)
    {
        var selfie = await attendance.SelfieAsync(id, ct);
        if (selfie is null) return Problem(statusCode: 404, title: "No selfie is stored for this record.");
        var sees = User.IsInRole(Roles.Administrator) || User.IsInRole(Roles.Manager) || User.IsInRole(Roles.HR) || User.IsInRole(Roles.Viewer)
            || await attendance.OwnsWorkerAsync(UserId, selfie.Value.WorkerId, ct);
        if (!sees) return Forbid();
        Response.Headers.CacheControl = "private, no-store";
        return File(selfie.Value.Data, "image/jpeg");
    }

    // --- settings and holidays ---------------------------------------------------------------------------------

    [HttpGet("settings")]
    [Authorize(Policy = Policies.ManagerAdminOrHr)]
    public async Task<IActionResult> GetSettings(CancellationToken ct) => Ok(await settings.GetAsync(ct));

    [HttpPut("settings")]
    [Authorize(Policy = Policies.ManagerOrAdmin)]
    public async Task<IActionResult> SaveSettings(StaffSettingsDto request, CancellationToken ct) => Map(await settings.SaveAsync(request, ct));

    [HttpGet("holidays")]
    [Authorize(Policy = Policies.ManagerAdminOrHr)]
    public async Task<IActionResult> Holidays([FromQuery] int? year, CancellationToken ct) => Ok(await settings.HolidaysAsync(year, ct));

    [HttpPost("holidays")]
    [Authorize(Policy = Policies.ManagerOrAdmin)]
    public async Task<IActionResult> AddHoliday(HolidayRequest request, CancellationToken ct)
    {
        var result = await settings.AddHolidayAsync(request, ct);
        return result.Status == 200 ? StatusCode(201, result.Value) : Map(result);
    }

    [HttpDelete("holidays/{id:int}")]
    [Authorize(Policy = Policies.ManagerOrAdmin)]
    public async Task<IActionResult> DeleteHoliday(int id, CancellationToken ct) =>
        await settings.DeleteHolidayAsync(id, ct) ? NoContent() : Problem(statusCode: 404, title: "Holiday not found.");

    // --- logins ------------------------------------------------------------------------------------------------

    [HttpGet("linkable-users")]
    [Authorize(Policy = Policies.ManagerAdminOrHr)]
    public async Task<IActionResult> LinkableUsers(CancellationToken ct) => Ok(await logins.LinkableAsync(ct));

    /// <summary>Only a Manager or Administrator creates logins, as in User Manager; HR can link an existing account.</summary>
    [HttpPost("employees/{workerId:int}/login")]
    [Authorize(Policy = Policies.ManagerAdminOrHr)]
    public async Task<IActionResult> SetLogin(int workerId, EmployeeLoginRequest request, CancellationToken ct)
    {
        if (request.LinkUserId is null && !User.IsInRole(Roles.Manager) && !User.IsInRole(Roles.Administrator))
            return Problem(statusCode: 403, title: "Only a Manager can create a new login. Link an existing account instead.");
        return Map(await logins.SetLoginAsync(workerId, request, ct));
    }

    [HttpDelete("employees/{workerId:int}/login")]
    [Authorize(Policy = Policies.ManagerOrAdmin)]
    public async Task<IActionResult> RemoveLogin(int workerId, CancellationToken ct) =>
        await logins.RemoveLoginAsync(workerId, ct) ? NoContent() : Problem(statusCode: 404, title: "This employee has no login.");

    // --- attendance review -------------------------------------------------------------------------------------

    [HttpGet("dashboard")]
    [Authorize(Policy = Policies.ManagerAdminOrHr)]
    public async Task<IActionResult> Dashboard(CancellationToken ct) => Ok(await attendance.DashboardAsync(ct));

    [HttpGet("attendance")]
    [Authorize(Policy = Policies.ManagerAdminOrHr)]
    public async Task<IActionResult> Attendance([FromQuery] string? date, [FromQuery] string? department, CancellationToken ct) =>
        Map(await attendance.DayRowsAsync(date, department, ct));

    [HttpGet("attendance/{workerId:int}")]
    [Authorize(Policy = Policies.ManagerAdminOrHr)]
    public async Task<IActionResult> AttendanceDetail(int workerId, [FromQuery] string? date, CancellationToken ct) =>
        Map(await attendance.DetailAsync(workerId, date, ct));

    [HttpPost("punches")]
    [Authorize(Policy = Policies.ManagerAdminOrHr)]
    public async Task<IActionResult> AddPunch(ManualPunchRequest request, CancellationToken ct) => Map(await attendance.AddManualPunchAsync(request, ct));

    [HttpPost("punches/{id:long}/void")]
    [Authorize(Policy = Policies.ManagerAdminOrHr)]
    public async Task<IActionResult> VoidPunch(long id, VoidPunchRequest request, CancellationToken ct) => Map(await attendance.VoidPunchAsync(id, request, ct));

    [HttpGet("report")]
    [Authorize(Policy = Policies.ManagerAdminOrHr)]
    public async Task<IActionResult> Report([FromQuery] string? from, [FromQuery] string? to, [FromQuery] string? department, [FromQuery] int? workerId, CancellationToken ct) =>
        Map(await attendance.ReportAsync(from, to, department, workerId, ct));

    [HttpGet("report/export/{format:regex(^(pdf|excel)$)}")]
    [Authorize(Policy = Policies.ManagerAdminOrHr)]
    public Task<IActionResult> ExportReport(string format, [FromQuery] string? from, [FromQuery] string? to, [FromQuery] string? department, [FromQuery] int? workerId, CancellationToken ct) =>
        Export(() => exports.AttendanceAsync(from, to, department, workerId, Format(format), ct));

    /// <summary>The office employees' own payroll summary, kept apart from the site workers' payroll.</summary>
    [HttpGet("payroll")]
    [Authorize(Policy = Policies.ManagerAdminOrHr)]
    public async Task<IActionResult> Payroll([FromQuery] string? month, CancellationToken ct) => Map(await attendance.PayrollSummaryAsync(month, ct));

    /// <summary>A payslip for one office employee (or every one, without <c>workerId</c>). Only a Manager or Administrator issues them.</summary>
    [HttpGet("payroll/payslip")]
    [Authorize(Policy = Policies.ManagerOrAdmin)]
    public async Task<IActionResult> Payslip([FromQuery] string? month, [FromQuery] int? workerId, CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        try
        {
            var result = await payslips.GetAsync(month, workerId, ct);
            if (result.Status != 200) return Map(result);
            return File(result.Value.Pdf, "application/pdf", result.Value.FileName);
        }
        catch (PdfTextNotSupportedException)
        {
            return Problem(statusCode: 422, title: "The PDF supports English text. Update names that use other scripts.");
        }
    }

    [HttpGet("payroll/export/{format:regex(^(pdf|excel)$)}")]
    [Authorize(Policy = Policies.ManagerAdminOrHr)]
    public Task<IActionResult> ExportPayroll(string format, [FromQuery] string? month, CancellationToken ct) =>
        Export(() => exports.PayrollAsync(month, Format(format), ct));

    // --- leave -------------------------------------------------------------------------------------------------

    [HttpGet("leave-types")]
    [Authorize(Policy = Policies.ManagerAdminOrHr)]
    public async Task<IActionResult> LeaveTypes(CancellationToken ct) => Ok(await leave.TypesAsync(false, ct));

    [HttpPost("leave-types")]
    [Authorize(Policy = Policies.ManagerOrAdmin)]
    public async Task<IActionResult> AddLeaveType(StaffLeaveTypeRequest request, CancellationToken ct)
    {
        var result = await leave.SaveTypeAsync(null, request, ct);
        return result.Status == 200 ? StatusCode(201, result.Value) : Map(result);
    }

    [HttpPut("leave-types/{id:int}")]
    [Authorize(Policy = Policies.ManagerOrAdmin)]
    public async Task<IActionResult> UpdateLeaveType(int id, StaffLeaveTypeRequest request, CancellationToken ct) => Map(await leave.SaveTypeAsync(id, request, ct));

    [HttpGet("leave")]
    [Authorize(Policy = Policies.ManagerAdminOrHr)]
    public async Task<IActionResult> Leave([FromQuery] string? status, [FromQuery] int? workerId, [FromQuery] string? department, [FromQuery] int? year, CancellationToken ct) =>
        Ok(await leave.ListAsync(status, workerId, department, year, ct));

    [HttpGet("leave/balances")]
    [Authorize(Policy = Policies.ManagerAdminOrHr)]
    public async Task<IActionResult> LeaveBalances([FromQuery] int? year, [FromQuery] string? department, CancellationToken ct) =>
        Ok(await leave.AllBalancesAsync(year, department, ct));

    [HttpPost("leave/{id:int}/approve")]
    [Authorize(Policy = Policies.ManagerOrAdmin)]
    public async Task<IActionResult> Approve(int id, StaffLeaveDecision request, CancellationToken ct) => Map(await leave.DecideAsync(UserId, id, true, request.Note, ct));

    [HttpPost("leave/{id:int}/reject")]
    [Authorize(Policy = Policies.ManagerOrAdmin)]
    public async Task<IActionResult> Reject(int id, StaffLeaveDecision request, CancellationToken ct) => Map(await leave.DecideAsync(UserId, id, false, request.Note, ct));

    [HttpGet("leave/export/{format:regex(^(pdf|excel)$)}")]
    [Authorize(Policy = Policies.ManagerAdminOrHr)]
    public Task<IActionResult> ExportLeave(string format, [FromQuery] int? year, [FromQuery] string? department, CancellationToken ct) =>
        Export(() => exports.LeaveBalancesAsync(year, department, Format(format), ct));

    private static AttendanceExportFormat Format(string format) => format == "pdf" ? AttendanceExportFormat.Pdf : AttendanceExportFormat.Excel;

    private async Task<IActionResult> Export(Func<Task<LeaveExportResult>> build)
    {
        Response.Headers.CacheControl = "no-store";
        try
        {
            var result = await build();
            return result.StatusCode == 200
                ? File(result.File!, result.ContentType!, result.FileName)
                : ValidationProblem(new ValidationProblemDetails(result.Errors!));
        }
        catch (PdfTextNotSupportedException)
        {
            return Problem(statusCode: 422, title: "The PDF supports English text. Update names that use other scripts.");
        }
    }
}
