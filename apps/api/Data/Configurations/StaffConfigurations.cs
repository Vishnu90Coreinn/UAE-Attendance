using HrPayroll.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace HrPayroll.Api.Data.Configurations;

public sealed class StaffPunchConfiguration : IEntityTypeConfiguration<StaffPunch>
{
    public void Configure(EntityTypeBuilder<StaffPunch> builder)
    {
        builder.ToTable(t => t.HasCheckConstraint("CK_StaffPunches_Kind", "[Kind] IN ('In', 'Out')"));
        builder.Property(p => p.Kind).HasMaxLength(3).IsRequired();
        builder.Property(p => p.TimestampUtc).HasColumnType("datetime2");
        builder.Property(p => p.WorkDate).HasColumnType("date");
        builder.Property(p => p.Source).HasMaxLength(10).IsRequired();
        builder.Property(p => p.Reason).HasMaxLength(300);
        builder.Property(p => p.CreatedBy).HasMaxLength(50).IsRequired();
        builder.Property(p => p.VoidReason).HasMaxLength(300);
        builder.Property(p => p.VoidedBy).HasMaxLength(50);
        builder.Property(p => p.VoidedUtc).HasColumnType("datetime2");
        builder.HasOne(p => p.Worker).WithMany().HasForeignKey(p => p.WorkerId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(p => new { p.WorkerId, p.WorkDate });
        builder.HasIndex(p => p.TimestampUtc);
    }
}

public sealed class StaffPunchSelfieConfiguration : IEntityTypeConfiguration<StaffPunchSelfie>
{
    public void Configure(EntityTypeBuilder<StaffPunchSelfie> builder)
    {
        builder.HasKey(s => s.PunchId);
        builder.HasOne(s => s.Punch).WithOne().HasForeignKey<StaffPunchSelfie>(s => s.PunchId).OnDelete(DeleteBehavior.Cascade);
    }
}

public sealed class PublicHolidayConfiguration : IEntityTypeConfiguration<PublicHoliday>
{
    public void Configure(EntityTypeBuilder<PublicHoliday> builder)
    {
        builder.Property(h => h.Date).HasColumnType("date");
        builder.Property(h => h.Name).HasMaxLength(100).IsRequired();
        builder.HasIndex(h => h.Date).IsUnique();
    }
}

public sealed class StaffSettingsConfiguration : IEntityTypeConfiguration<StaffSettings>
{
    public void Configure(EntityTypeBuilder<StaffSettings> builder)
    {
        builder.ToTable(t => t.HasCheckConstraint("CK_StaffSettings_Singleton", "[Id] = 1"));
        builder.Property(s => s.Id).ValueGeneratedNever();
        builder.Property(s => s.ShiftStart).HasColumnType("time(0)");
        builder.Property(s => s.ShiftEnd).HasColumnType("time(0)");
        builder.Property(s => s.LateDeductionPerMinute).HasPrecision(9, 2).HasDefaultValue(0m);
        builder.Property(s => s.DeductAbsentDays).HasDefaultValue(false);
        builder.HasData(new StaffSettings());
    }
}

public sealed class StaffLeaveTypeConfiguration : IEntityTypeConfiguration<StaffLeaveType>
{
    public void Configure(EntityTypeBuilder<StaffLeaveType> builder)
    {
        builder.Property(t => t.Name).HasMaxLength(60).UseCollation(UserConfiguration.CaseInsensitiveCollation).IsRequired();
        builder.HasIndex(t => t.Name).IsUnique();
        builder.Property(t => t.IsActive).HasDefaultValue(true);
        builder.HasData(
            new StaffLeaveType { Id = 1, Name = "Annual Leave", YearlyDays = 30 },
            new StaffLeaveType { Id = 2, Name = "Sick Leave", YearlyDays = 15 },
            new StaffLeaveType { Id = 3, Name = "Emergency Leave", YearlyDays = 5 },
            new StaffLeaveType { Id = 4, Name = "Unpaid Leave", YearlyDays = 365 });
    }
}

public sealed class StaffLeaveRequestConfiguration : IEntityTypeConfiguration<StaffLeaveRequest>
{
    public void Configure(EntityTypeBuilder<StaffLeaveRequest> builder)
    {
        builder.ToTable(t => t.HasCheckConstraint("CK_StaffLeaveRequests_Dates", "[EndDate] >= [StartDate]"));
        builder.Property(r => r.StartDate).HasColumnType("date");
        builder.Property(r => r.EndDate).HasColumnType("date");
        builder.Property(r => r.Reason).HasMaxLength(500).IsRequired();
        builder.Property(r => r.Status).HasMaxLength(12).IsRequired();
        builder.Property(r => r.CreatedBy).HasMaxLength(50).IsRequired();
        builder.Property(r => r.CreatedUtc).HasColumnType("datetime2");
        builder.Property(r => r.DecidedBy).HasMaxLength(50);
        builder.Property(r => r.DecidedUtc).HasColumnType("datetime2");
        builder.Property(r => r.DecisionNote).HasMaxLength(300);
        builder.HasOne(r => r.Worker).WithMany().HasForeignKey(r => r.WorkerId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne(r => r.LeaveType).WithMany().HasForeignKey(r => r.LeaveTypeId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(r => new { r.WorkerId, r.StartDate });
        builder.HasIndex(r => r.Status);
    }
}
