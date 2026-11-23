using HrPayroll.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace HrPayroll.Api.Data.Configurations;

public sealed class PushDeviceConfiguration : IEntityTypeConfiguration<PushDevice>
{
    public void Configure(EntityTypeBuilder<PushDevice> builder)
    {
        builder.ToTable("PushDevices");
        builder.Property(d => d.Endpoint).HasMaxLength(800).IsRequired();
        builder.Property(d => d.P256dh).HasMaxLength(200).IsRequired();
        builder.Property(d => d.Auth).HasMaxLength(100).IsRequired();
        builder.Property(d => d.CreatedUtc).HasColumnType("datetime2");
        builder.HasOne(d => d.User).WithMany().HasForeignKey(d => d.UserId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(d => d.Endpoint).IsUnique();
        builder.HasIndex(d => d.UserId);
    }
}
