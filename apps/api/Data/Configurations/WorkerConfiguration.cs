using HrPayroll.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace HrPayroll.Api.Data.Configurations;

public class WorkerConfiguration : IEntityTypeConfiguration<Worker>
{
    public void Configure(EntityTypeBuilder<Worker> builder)
    {
        builder.ToTable(t =>
        {
            t.HasCheckConstraint("CK_Workers_HourlyRate", "[HourlyRate] > 0");
            t.HasCheckConstraint("CK_Workers_OvertimeRate", "[OvertimeRate] IS NULL OR [OvertimeRate] >= 0");
        });

        builder.Property(w => w.WorkerCode).HasMaxLength(20).UseCollation(UserConfiguration.CaseInsensitiveCollation).IsRequired();
        builder.HasIndex(w => w.WorkerCode).IsUnique();

        builder.Property(w => w.FullName).HasMaxLength(120).IsRequired();
        builder.Property(w => w.Designation).HasMaxLength(80).IsRequired();
        builder.Property(w => w.HourlyRate).HasPrecision(9, 2);
        builder.Property(w => w.OvertimeRate).HasPrecision(9, 2);
        builder.Property(w => w.IsActive).HasDefaultValue(true);
        builder.Property(w => w.JoinDate).HasColumnType("date");
        builder.Property(w => w.Department).HasMaxLength(80);
        builder.Property(w => w.EmiratesId).HasMaxLength(25);
        builder.Property(w => w.PassportNumber).HasMaxLength(20);
        builder.Property(w => w.Phone).HasMaxLength(25);
        builder.Property(w => w.Email).HasMaxLength(120);
        builder.Property(w => w.EmergencyContact).HasMaxLength(150);
        builder.Property(w => w.WorkLocation).HasMaxLength(120);
        builder.Property(w => w.Notes).HasMaxLength(1000);
        builder.Property(w => w.ContractSigned).HasDefaultValue(false);
        builder.Property(w => w.VisaMedicalCleared).HasDefaultValue(false);
        builder.Property(w => w.SafetyGearIssued).HasDefaultValue(false);
        builder.Property(w => w.SiteOrientationDone).HasDefaultValue(false);
        builder.Property(w => w.WpsRegistered).HasDefaultValue(false);
        builder.Property(w => w.BadgeIssued).HasDefaultValue(false);
        builder.Property(w => w.CreatedUtc).HasColumnType("datetime2");
        builder.Property(w => w.UpdatedUtc).HasColumnType("datetime2");
    }
}
