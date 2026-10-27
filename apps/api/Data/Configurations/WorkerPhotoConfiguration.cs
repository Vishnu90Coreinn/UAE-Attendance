using HrPayroll.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace HrPayroll.Api.Data.Configurations;

public sealed class WorkerPhotoConfiguration : IEntityTypeConfiguration<WorkerPhoto>
{
    public void Configure(EntityTypeBuilder<WorkerPhoto> b)
    {
        b.ToTable("WorkerPhotos");
        b.HasKey(x => x.WorkerId);
        b.HasOne(x => x.Worker).WithOne().HasForeignKey<WorkerPhoto>(x => x.WorkerId).OnDelete(DeleteBehavior.Cascade);
        b.Property(x => x.Data).HasColumnType("varbinary(max)").IsRequired();
        b.Property(x => x.UpdatedUtc).HasColumnType("datetime2");
    }
}
