using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services;

public sealed class WorkerProfileService(AppDbContext db, WorkerProfilePdf pdf)
{
    /// <summary>The worker's record as a PDF, or null when there is no such worker. File name is <c>{code}_{name}_Information.pdf</c>.</summary>
    public async Task<(byte[] Pdf, string FileName)?> GetAsync(int id, bool includeRates, CancellationToken ct)
    {
        var worker = await db.Workers.AsNoTracking().SingleOrDefaultAsync(w => w.Id == id, ct);
        if (worker is null) return null;
        var s = await db.PayrollSettings.AsNoTracking().SingleAsync(x => x.Id == PayrollSettings.SingletonId, ct);
        var company = new PayrollCompany(s.CompanyName, s.Tagline, s.ContactEmail, s.PreparedByLabel, s.ApprovedByLabel);
        return (pdf.Generate(worker, company, includeRates), FileName(worker));
    }

    /// <summary>For example <c>EMP-001_Employee1_Information.pdf</c>; anything not safe in a file name becomes an underscore.</summary>
    internal static string FileName(Worker worker)
    {
        static string Clean(string text) => System.Text.RegularExpressions.Regex.Replace(text.Trim(), @"[^A-Za-z0-9-]+", "_").Trim('_');
        var name = Clean(worker.FullName);
        return $"{Clean(worker.WorkerCode)}_{(name.Length > 0 ? name : "Worker")}_Information.pdf";
    }
}
