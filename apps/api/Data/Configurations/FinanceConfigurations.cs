using HrPayroll.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace HrPayroll.Api.Data.Configurations;

public sealed class FinAccountConfiguration : IEntityTypeConfiguration<FinAccount>
{
    public void Configure(EntityTypeBuilder<FinAccount> builder)
    {
        builder.ToTable(t => t.HasCheckConstraint("CK_FinAccounts_Kind", "[Kind] IN ('Bank', 'Cash')"));
        builder.Property(a => a.Name).HasMaxLength(120).UseCollation(UserConfiguration.CaseInsensitiveCollation).IsRequired();
        builder.Property(a => a.Kind).HasMaxLength(10).IsRequired();
        builder.Property(a => a.BankName).HasMaxLength(80);
        builder.Property(a => a.AccountNumber).HasMaxLength(40);
        builder.Property(a => a.Iban).HasMaxLength(40);
        builder.Property(a => a.OpeningBalance).HasPrecision(12, 2);
        builder.Property(a => a.OpeningDate).HasColumnType("date");
        builder.Property(a => a.IsActive).HasDefaultValue(true);
        builder.Property(a => a.CreatedUtc).HasColumnType("datetime2");
        builder.Property(a => a.UpdatedUtc).HasColumnType("datetime2");
        builder.HasIndex(a => a.Name).IsUnique();
    }
}

public sealed class FinCategoryConfiguration : IEntityTypeConfiguration<FinCategory>
{
    public void Configure(EntityTypeBuilder<FinCategory> builder)
    {
        builder.ToTable(t => t.HasCheckConstraint("CK_FinCategories_Kind", "[Kind] IN ('Expense', 'Income')"));
        builder.Property(c => c.Kind).HasMaxLength(10).IsRequired();
        builder.Property(c => c.Name).HasMaxLength(80).UseCollation(UserConfiguration.CaseInsensitiveCollation).IsRequired();
        builder.Property(c => c.IsActive).HasDefaultValue(true);
        builder.HasIndex(c => new { c.Kind, c.Name }).IsUnique();

        // The starting lists, from the accountant's Daftra account. The client renames or switches them off in Settings.
        builder.HasData(
            new FinCategory { Id = 1, Kind = FinEntryKinds.Expense, Name = "Company expenses" },
            new FinCategory { Id = 2, Kind = FinEntryKinds.Expense, Name = "Government-related procedures for workers" },
            new FinCategory { Id = 3, Kind = FinEntryKinds.Expense, Name = "Salary Advance" },
            new FinCategory { Id = 4, Kind = FinEntryKinds.Expense, Name = "Monthly Salary" },
            new FinCategory { Id = 5, Kind = FinEntryKinds.Expense, Name = "Worker Accommodation Rent" },
            new FinCategory { Id = 6, Kind = FinEntryKinds.Expense, Name = "Worker Transportation" },
            new FinCategory { Id = 7, Kind = FinEntryKinds.Expense, Name = "Office Rent" },
            new FinCategory { Id = 8, Kind = FinEntryKinds.Expense, Name = "Dubai Insurance" },
            new FinCategory { Id = 9, Kind = FinEntryKinds.Expense, Name = "Commission for Labor" },
            new FinCategory { Id = 10, Kind = FinEntryKinds.Income, Name = "Other income" });
    }
}

public sealed class FinEntryConfiguration : IEntityTypeConfiguration<FinEntry>
{
    public void Configure(EntityTypeBuilder<FinEntry> builder)
    {
        builder.ToTable(t =>
        {
            t.HasCheckConstraint("CK_FinEntries_Kind", "[Kind] IN ('Expense', 'Income')");
            t.HasCheckConstraint("CK_FinEntries_Status", "[Status] IN ('Active', 'Voided')");
            t.HasCheckConstraint("CK_FinEntries_Amount", "[Amount] > 0");
            t.HasCheckConstraint("CK_FinEntries_Voided", "[Status] = 'Active' OR [VoidedUtc] IS NOT NULL");
        });
        builder.Property(e => e.Kind).HasMaxLength(10).IsRequired();
        builder.Property(e => e.EntryNo).HasMaxLength(20).IsRequired();
        builder.Property(e => e.EntryDate).HasColumnType("date");
        builder.Property(e => e.Party).HasMaxLength(120).IsRequired();
        builder.Property(e => e.Amount).HasPrecision(12, 2);
        builder.Property(e => e.Reference).HasMaxLength(60);
        builder.Property(e => e.Notes).HasMaxLength(2000);
        builder.Property(e => e.Status).HasMaxLength(10).IsRequired();
        builder.Property(e => e.VoidReason).HasMaxLength(300);
        builder.Property(e => e.VoidedBy).HasMaxLength(50);
        builder.Property(e => e.VoidedUtc).HasColumnType("datetime2");
        builder.Property(e => e.CreatedBy).HasMaxLength(50).IsRequired();
        builder.Property(e => e.CreatedUtc).HasColumnType("datetime2");
        builder.Property(e => e.ExternalSource).HasMaxLength(20);
        builder.Property(e => e.ExternalId).HasMaxLength(40);
        builder.HasOne(e => e.Category).WithMany().HasForeignKey(e => e.CategoryId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne(e => e.Account).WithMany().HasForeignKey(e => e.AccountId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<FinEntry>().WithMany().HasForeignKey(e => e.ReplacesEntryId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(e => e.EntryNo).IsUnique();
        builder.HasIndex(e => new { e.AccountId, e.EntryDate });
        builder.HasIndex(e => e.EntryDate);
        builder.HasIndex(e => e.CategoryId);
        builder.HasIndex(e => new { e.ExternalSource, e.ExternalId }).IsUnique().HasFilter("[ExternalId] IS NOT NULL");
    }
}

public sealed class FinTransferConfiguration : IEntityTypeConfiguration<FinTransfer>
{
    public void Configure(EntityTypeBuilder<FinTransfer> builder)
    {
        builder.ToTable(t =>
        {
            t.HasCheckConstraint("CK_FinTransfers_Status", "[Status] IN ('Active', 'Voided')");
            t.HasCheckConstraint("CK_FinTransfers_Amount", "[Amount] > 0");
            t.HasCheckConstraint("CK_FinTransfers_Accounts", "[FromAccountId] <> [ToAccountId]");
            t.HasCheckConstraint("CK_FinTransfers_Voided", "[Status] = 'Active' OR [VoidedUtc] IS NOT NULL");
        });
        builder.Property(x => x.TransferNo).HasMaxLength(20).IsRequired();
        builder.Property(x => x.TransferDate).HasColumnType("date");
        builder.Property(x => x.Amount).HasPrecision(12, 2);
        builder.Property(x => x.Reference).HasMaxLength(60);
        builder.Property(x => x.Notes).HasMaxLength(2000);
        builder.Property(x => x.Status).HasMaxLength(10).IsRequired();
        builder.Property(x => x.VoidReason).HasMaxLength(300);
        builder.Property(x => x.VoidedBy).HasMaxLength(50);
        builder.Property(x => x.VoidedUtc).HasColumnType("datetime2");
        builder.Property(x => x.CreatedBy).HasMaxLength(50).IsRequired();
        builder.Property(x => x.CreatedUtc).HasColumnType("datetime2");
        builder.HasOne(x => x.FromAccount).WithMany().HasForeignKey(x => x.FromAccountId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne(x => x.ToAccount).WithMany().HasForeignKey(x => x.ToAccountId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<FinTransfer>().WithMany().HasForeignKey(x => x.ReplacesTransferId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(x => x.TransferNo).IsUnique();
        builder.HasIndex(x => x.TransferDate);
        builder.HasIndex(x => x.FromAccountId);
        builder.HasIndex(x => x.ToAccountId);
    }
}
