using HrPayroll.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace HrPayroll.Api.Data.Configurations;

public class PayrollSettingsConfiguration : IEntityTypeConfiguration<PayrollSettings>
{
    public void Configure(EntityTypeBuilder<PayrollSettings> builder)
    {
        builder.ToTable(t => t.HasCheckConstraint(
            "CK_PayrollSettings_SingleRow", $"[Id] = {PayrollSettings.SingletonId}"));

        builder.Property(s => s.Id).ValueGeneratedNever();
        builder.Property(s => s.CompanyName).HasMaxLength(120).IsRequired();
        builder.Property(s => s.Tagline).HasMaxLength(200).IsRequired();
        builder.Property(s => s.ContactEmail).HasMaxLength(120).IsRequired();
        builder.Property(s => s.OvertimeRatePerHour).HasPrecision(9, 2);
        builder.Property(s => s.MaxBasicHoursPerDay).HasPrecision(4, 2);
        builder.Property(s => s.ShiftDescription).HasMaxLength(60).IsRequired();
        builder.Property(s => s.PreparedByLabel).HasMaxLength(60).IsRequired();
        builder.Property(s => s.ApprovedByLabel).HasMaxLength(60).IsRequired();

        // Inserted by the migration. The quote treats rule changes as change requests, so there is no write endpoint.
        builder.HasData(new PayrollSettings
        {
            Id = PayrollSettings.SingletonId,
            CompanyName = "DE AKS BE GLASS & ALUMINIUM CO. L.L.C S.O.C",
            Tagline = "Glass & Aluminum Installation & Maintenance Services",
            ContactEmail = "hr@dxbaluminium.ae",
            OvertimeRatePerHour = 2.22m,
            MaxBasicHoursPerDay = 8m,
            ShiftDescription = "06:00 AM - 05:30 PM",
            PreparedByLabel = "HR Department",
            ApprovedByLabel = "General Manager",
        });
    }
}
