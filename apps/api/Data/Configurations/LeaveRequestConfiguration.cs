using HrPayroll.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace HrPayroll.Api.Data.Configurations;

public sealed class LeaveRequestConfiguration : IEntityTypeConfiguration<LeaveRequest>
{
    public void Configure(EntityTypeBuilder<LeaveRequest> b)
    {
        b.ToTable("LeaveRequests", t =>
        {
            t.HasCheckConstraint("CK_LeaveRequests_Dates", "[EndDate] >= [StartDate]");
            t.HasCheckConstraint("CK_LeaveRequests_Type", "DATALENGTH([LeaveType]) = DATALENGTH(RTRIM([LeaveType])) AND [LeaveType] COLLATE Latin1_General_100_BIN2 IN ('Annual Leave','Sick Leave','Unpaid Leave','Emergency Leave')");
            t.HasCheckConstraint("CK_LeaveRequests_Status", "DATALENGTH([Status]) = DATALENGTH(RTRIM([Status])) AND [Status] COLLATE Latin1_General_100_BIN2 IN ('Pending','Approved','Rejected')");
        });
        b.HasKey(x => x.Id);
        b.HasOne(x => x.Worker).WithMany().HasForeignKey(x => x.WorkerId).OnDelete(DeleteBehavior.Restrict);
        b.Property(x => x.LeaveType).HasMaxLength(30).IsRequired();
        b.Property(x => x.StartDate).HasColumnType("date");
        b.Property(x => x.EndDate).HasColumnType("date");
        b.Property(x => x.Days).HasComputedColumnSql("DATEDIFF(day, [StartDate], [EndDate]) + 1", stored: true);
        b.Property(x => x.Status).HasMaxLength(10).IsRequired();
        b.Property(x => x.CreatedBy).HasMaxLength(256).IsRequired();
        b.Property(x => x.DecidedBy).HasMaxLength(256);
        b.HasIndex(x => new { x.WorkerId, x.StartDate, x.EndDate });
    }
}
