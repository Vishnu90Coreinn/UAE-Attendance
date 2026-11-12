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
            t.HasCheckConstraint("CK_Attendance_Status", "[Status] COLLATE Latin1_General_100_BIN2 IN ('Present', 'Absent', 'Annual Leave', 'Sick Leave', 'Emergency Leave')");
            t.HasCheckConstraint("CK_Attendance_Approval", "[ApprovalStatus] COLLATE Latin1_General_100_BIN2 IN ('Submitted', 'Approved', 'Rejected')");
            t.HasCheckConstraint("CK_Attendance_Hours", "[BasicHours] >= 0 AND [OvertimeHours] >= 0 AND [BasicHours] + [OvertimeHours] <= 24");
            t.HasCheckConstraint("CK_Attendance_StatusHours", "([Status] = 'Absent' AND [BasicHours] = 0 AND [OvertimeHours] = 0) OR ([Status] = 'Present' AND [BasicHours] > 0) OR ([Status] IN ('Annual Leave', 'Sick Leave', 'Emergency Leave') AND [OvertimeHours] = 0)");
        });
        builder.HasIndex(a => new { a.WorkerId, a.WorkDate }).IsUnique();
        builder.HasIndex(a => a.WorkDate);
        // Entries still waiting on a manager (or sent back): the alerts, dashboard and approval banners count these on every page
        // load. Nearly every row is Approved, so this index stays tiny however long the history grows.
        builder.HasIndex(a => a.WorkDate, "IX_Attendance_WorkDate_NotApproved")
            .IncludeProperties(a => a.ApprovalStatus)
            .HasFilter("[ApprovalStatus] <> 'Approved'");
        builder.HasOne(a => a.Worker).WithMany().HasForeignKey(a => a.WorkerId).OnDelete(DeleteBehavior.Restrict);
        builder.Property(a => a.WorkDate).HasColumnType("date");
        builder.Property(a => a.Status).HasMaxLength(20).IsRequired();
        builder.Property(a => a.BasicHours).HasPrecision(4, 2);
        builder.Property(a => a.OvertimeHours).HasPrecision(4, 2);
        builder.Property(a => a.UpdatedBy).HasMaxLength(50).IsRequired();
        // Rows that existed before the approval flow keep counting in payroll, so the column default is Approved.
        builder.Property(a => a.ApprovalStatus).HasMaxLength(10).IsRequired().HasDefaultValue(ApprovalStatuses.Approved);
        builder.Property(a => a.RejectionReason).HasMaxLength(200);
        builder.Property(a => a.DecidedBy).HasMaxLength(50);
    }
}
