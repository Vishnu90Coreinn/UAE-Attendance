using System.Globalization;
using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services.Staff;

/// <summary>Payslips for office employees, built from the same figures as the Staff Payroll Summary.</summary>
public sealed class StaffPayslipService(AppDbContext db, StaffAttendanceService attendance, StaffPayslipPdf pdf, TimeProvider time)
{
    /// <param name="workerId">One employee, or null for every office employee in one PDF.</param>
    public async Task<StaffResult<(byte[] Pdf, string FileName)>> GetAsync(string? month, int? workerId, CancellationToken ct)
    {
        var summary = await attendance.PayrollSummaryAsync(month, ct);
        if (summary.Status != 200) return new(summary.Status, Errors: summary.Errors, Title: summary.Title);
        var s = summary.Value!;
        var rows = s.Rows.Where(r => workerId is null || r.WorkerId == workerId).ToList();
        if (rows.Count == 0) return StaffResult<(byte[], string)>.NotFound("No payslip for that employee and month.");

        var ids = rows.Select(r => r.WorkerId).ToArray();
        var workers = await db.Workers.AsNoTracking().Where(w => ids.Contains(w.Id)).ToDictionaryAsync(w => w.Id, ct);
        var settings = await db.PayrollSettings.AsNoTracking().SingleAsync(x => x.Id == PayrollSettings.SingletonId, ct);
        var company = new PayrollCompany(settings.CompanyName, settings.Tagline, settings.ContactEmail, settings.PreparedByLabel, settings.ApprovedByLabel);
        var current = s.Month == StaffTime.Today(time).ToString("yyyy-MM", CultureInfo.InvariantCulture);
        var slips = rows.Select(r => new StaffPayslipData(r, workers[r.WorkerId].Designation, workers[r.WorkerId].JoinDate, s.Label, s.Month, current,
            s.DeductAbsentDays, s.LateDeductionPerMinute)).ToList();
        var name = workerId is null ? $"Staff_Payslips_{s.Month}.pdf" : $"Staff_Payslip_{s.Month}_{rows[0].Code}.pdf";
        return StaffResult<(byte[], string)>.Ok((pdf.Generate(company, slips), name));
    }
}
