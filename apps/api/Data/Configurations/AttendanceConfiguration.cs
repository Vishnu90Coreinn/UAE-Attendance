using HrPayroll.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace HrPayroll.Api.Data.Configurations;

public sealed class AttendanceConfiguration : IEntityTypeConfiguration<Attendance>
{
    public void Configure(EntityTypeBuilder<Attendance> builder)
    {
        builder.ToTable("Attendance", t =>
        {
            t.HasCheckConstraint("CK_Attendance_Status", "[Status] COLLATE Latin1_General_100_BIN2 IN ('Present', 'Absent')");
            t.HasCheckConstraint("CK_Attendance_Hours", "[BasicHours] >= 0 AND [OvertimeHours] >= 0 AND [BasicHours] + [OvertimeHours] <= 24");
            t.HasCheckConstraint("CK_Attendance_StatusHours", "([Status] = 'Absent' AND [BasicHours] = 0 AND [OvertimeHours] = 0) OR ([Status] = 'Present' AND [BasicHours] > 0)");
        });
        builder.HasIndex(a => new { a.WorkerId, a.WorkDate }).IsUnique();
        builder.HasIndex(a => a.WorkDate);
        builder.HasOne(a => a.Worker).WithMany().HasForeignKey(a => a.WorkerId).OnDelete(DeleteBehavior.Restrict);
        builder.Property(a => a.WorkDate).HasColumnType("date");
        builder.Property(a => a.Status).HasMaxLength(10).IsRequired();
        builder.Property(a => a.BasicHours).HasPrecision(4, 2);
        builder.Property(a => a.OvertimeHours).HasPrecision(4, 2);
        builder.Property(a => a.UpdatedBy).HasMaxLength(50).IsRequired();
    }
}
