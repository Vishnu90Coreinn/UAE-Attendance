using HrPayroll.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services;

public sealed record PayslipResult(int StatusCode, byte[]? Pdf = null, string? FileName = null, string? Message = null);

/// <summary>Payslips come from the same report as the payroll screen: the frozen snapshot once finalised, the live draft before that.</summary>
public sealed class PayslipService(PayrollService payroll, AppDbContext db, PayslipPdf pdf)
{
    public async Task<PayslipResult> GetAsync(DateOnly start, int? workerId, CancellationToken ct)
    {
        var report = await payroll.ReadAsync(start, ct);
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
