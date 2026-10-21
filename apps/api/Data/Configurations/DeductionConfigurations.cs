using HrPayroll.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace HrPayroll.Api.Data.Configurations;

public sealed class DeductionTypeConfiguration : IEntityTypeConfiguration<DeductionType>
{
    public void Configure(EntityTypeBuilder<DeductionType> builder)
    {
        builder.Property(t => t.Name).HasMaxLength(40).UseCollation(UserConfiguration.CaseInsensitiveCollation).IsRequired();
        builder.HasIndex(t => t.Name).IsUnique();
        // The two deductions on the client's payslip template; the company can rename or add more in Settings.
        builder.HasData(
            new DeductionType { Id = 1, Name = "Advance / Loan", IsActive = true },
            new DeductionType { Id = 2, Name = "Other Deductions", IsActive = true });
    }
}

public sealed class WorkerDeductionConfiguration : IEntityTypeConfiguration<WorkerDeduction>
{
    public void Configure(EntityTypeBuilder<WorkerDeduction> builder)
    {
        builder.ToTable(t =>
        {
            t.HasCheckConstraint("CK_WorkerDeductions_Amount", "[Amount] > 0");
            t.HasCheckConstraint("CK_WorkerDeductions_Month", "[Month] BETWEEN 1 AND 12");
        });
        builder.HasIndex(d => new { d.WorkerId, d.Year, d.Month, d.DeductionTypeId }).IsUnique();
        builder.HasOne(d => d.Worker).WithMany().HasForeignKey(d => d.WorkerId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne(d => d.DeductionType).WithMany().HasForeignKey(d => d.DeductionTypeId).OnDelete(DeleteBehavior.Restrict);
        builder.Property(d => d.Amount).HasPrecision(9, 2);
        builder.Property(d => d.Note).HasMaxLength(200).IsRequired();
        builder.Property(d => d.UpdatedBy).HasMaxLength(50).IsRequired();
        builder.Property(d => d.UpdatedUtc).HasColumnType("datetime2");
    }
}

public sealed class PayrollDeductionLineConfiguration : IEntityTypeConfiguration<PayrollDeductionLine>
{
    public void Configure(EntityTypeBuilder<PayrollDeductionLine> builder)
    {
        builder.HasOne(l => l.Detail).WithMany(d => d.Deductions).HasForeignKey(l => l.PayrollDetailId).OnDelete(DeleteBehavior.Cascade);
        builder.Property(l => l.DeductionTypeName).HasMaxLength(40).IsRequired();
        builder.Property(l => l.Note).HasMaxLength(200).IsRequired();
        builder.Property(l => l.Amount).HasPrecision(9, 2);
    }
}

/// <summary>Total deductions stored with each snapshot row, alongside the other frozen amounts.</summary>
public sealed class PayrollDetailDeductionsConfiguration : IEntityTypeConfiguration<PayrollDetail>
{
    public void Configure(EntityTypeBuilder<PayrollDetail> builder) =>
        builder.Property(d => d.TotalDeductions).HasPrecision(18, 2).HasDefaultValue(0m);
}
