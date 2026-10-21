using HrPayroll.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services;

public sealed record PayslipResult(int StatusCode, byte[]? Pdf = null, string? FileName = null, string? Message = null);

/// <summary>Payslips come only from a finalised month's snapshot, so they always match the payroll report.</summary>
public sealed class PayslipService(PayrollService payroll, AppDbContext db, PayslipPdf pdf)
{
    public async Task<PayslipResult> GetAsync(DateOnly start, int? workerId, CancellationToken ct)
    {
        var report = await payroll.ReadAsync(start, ct);
        if (report.Status != "Finalised") return new(409, Message: "Finalise the month before creating payslips.");
        var lines = report.Lines.Where(l => workerId is null || l.WorkerId == workerId).ToList();
        if (lines.Count == 0) return new(404);
        var ids = lines.Select(l => l.WorkerId).ToArray();
        var joinDates = await db.Workers.AsNoTracking().Where(w => ids.Contains(w.Id))
            .ToDictionaryAsync(w => w.Id, w => w.JoinDate, ct);
        var bytes = pdf.Generate(report, lines, joinDates);
        var name = workerId is null ? $"Payslips_{report.Period}.pdf" : $"Payslip_{report.Period}_{lines[0].WorkerCode}.pdf";
        return new(200, bytes, name);
    }
}
