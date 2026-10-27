using HrPayroll.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace HrPayroll.Api.Data.Configurations;

public sealed class LeaveAttachmentConfiguration : IEntityTypeConfiguration<LeaveAttachment>
{
    public void Configure(EntityTypeBuilder<LeaveAttachment> b)
    {
        b.ToTable("LeaveAttachments");
        b.HasKey(x => x.LeaveRequestId);
        b.HasOne(x => x.LeaveRequest).WithOne().HasForeignKey<LeaveAttachment>(x => x.LeaveRequestId).OnDelete(DeleteBehavior.Cascade);
        b.Property(x => x.ContentType).HasMaxLength(50).IsRequired();
        b.Property(x => x.Data).HasColumnType("varbinary(max)").IsRequired();
        b.Property(x => x.UploadedUtc).HasColumnType("datetime2");
    }
}
