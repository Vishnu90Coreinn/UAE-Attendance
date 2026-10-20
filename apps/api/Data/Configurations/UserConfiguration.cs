using HrPayroll.Api.Auth;
using HrPayroll.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace HrPayroll.Api.Data.Configurations;

public class UserConfiguration : IEntityTypeConfiguration<User>
{
    public const string CaseInsensitiveCollation = "SQL_Latin1_General_CP1_CI_AS";

    public void Configure(EntityTypeBuilder<User> builder)
    {
        var allowedRoles = string.Join(", ", Roles.All.Select(r => $"'{r}'"));
        builder.ToTable(t => t.HasCheckConstraint("CK_Users_Role", $"[Role] IN ({allowedRoles})"));

        builder.Property(u => u.Username).HasMaxLength(50).UseCollation(CaseInsensitiveCollation).IsRequired();
        builder.HasIndex(u => u.Username).IsUnique();

        builder.Property(u => u.PasswordHash).HasMaxLength(256).IsRequired();
        builder.Property(u => u.Role).HasMaxLength(20).IsRequired();
        builder.Property(u => u.IsActive).HasDefaultValue(true);
        builder.Property(u => u.FailedLoginCount).HasDefaultValue(0);
        builder.Property(u => u.CreatedUtc).HasColumnType("datetime2");
        builder.Property(u => u.LockoutEndUtc).HasColumnType("datetime2");
    }
}
