using HrPayroll.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace HrPayroll.Api.Data.Configurations;

public sealed class PayrollPeriodConfiguration : IEntityTypeConfiguration<PayrollPeriod>
{
    public void Configure(EntityTypeBuilder<PayrollPeriod> b)
    {
        b.ToTable("PayrollPeriods", t => t.HasCheckConstraint("CK_PayrollPeriods_Month", "[Year] BETWEEN 1 AND 9999 AND [Month] BETWEEN 1 AND 12"));
        b.HasIndex(p => new { p.Year, p.Month }).IsUnique();
        b.Property(p => p.OvertimeRateApplied).HasPrecision(9, 2);
        b.Property(p => p.FinalisedUtc).HasColumnType("datetime2");
        b.Property(p => p.FinalisedBy).HasMaxLength(60).IsRequired();
        b.Property(p => p.CompanyName).HasMaxLength(120).IsRequired();
        b.Property(p => p.Tagline).HasMaxLength(200).IsRequired();
        b.Property(p => p.ContactEmail).HasMaxLength(120).IsRequired();
        b.Property(p => p.PreparedByLabel).HasMaxLength(60).IsRequired();
        b.Property(p => p.ApprovedByLabel).HasMaxLength(60).IsRequired();
    }
}

public sealed class PayrollDetailConfiguration : IEntityTypeConfiguration<PayrollDetail>
{
    public void Configure(EntityTypeBuilder<PayrollDetail> b)
    {
        b.ToTable("PayrollDetails");
        b.HasOne(d => d.Period).WithMany(p => p.Details).HasForeignKey(d => d.PeriodId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne<Worker>().WithMany().HasForeignKey(d => d.WorkerId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(d => new { d.PeriodId, d.WorkerId }).IsUnique();
        b.Property(d => d.WorkerCode).HasMaxLength(20).IsRequired();
        b.Property(d => d.WorkerName).HasMaxLength(120).IsRequired();
        b.Property(d => d.Designation).HasMaxLength(80).IsRequired();
        b.Property(d => d.HourlyRate).HasPrecision(9, 2);
        b.Property(d => d.OvertimeRate).HasPrecision(9, 2);
        b.Property(d => d.BasicHours).HasPrecision(18, 2);
        b.Property(d => d.OvertimeHours).HasPrecision(18, 2);
        b.Property(d => d.BasicPay).HasPrecision(18, 2);
        b.Property(d => d.OvertimePay).HasPrecision(18, 2);
        b.Property(d => d.TotalPay).HasPrecision(18, 2);
    }
}
