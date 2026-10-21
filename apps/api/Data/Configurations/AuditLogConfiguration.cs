using HrPayroll.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace HrPayroll.Api.Data.Configurations;

public class AuditLogConfiguration : IEntityTypeConfiguration<AuditLog>
{
    public void Configure(EntityTypeBuilder<AuditLog> builder)
    {
        builder.Property(a => a.TimestampUtc).HasColumnType("datetime2");
        builder.Property(a => a.ActorUsername).HasMaxLength(50);
        builder.Property(a => a.Action).HasMaxLength(50).IsRequired();
        builder.Property(a => a.EntityType).HasMaxLength(50);
        builder.Property(a => a.EntityId).HasMaxLength(50);
        builder.Property(a => a.DetailsJson).HasColumnType("nvarchar(max)");

        builder.HasIndex(a => a.TimestampUtc);
    }
}
