using HrPayroll.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace HrPayroll.Api.Data.Configurations;

public sealed class FinAccountConfiguration : IEntityTypeConfiguration<FinAccount>
{
    public void Configure(EntityTypeBuilder<FinAccount> builder)
    {
        builder.ToTable(t => t.HasCheckConstraint("CK_FinAccounts_Kind", "[Kind] IN ('Bank', 'Cash', 'Custody')"));
        builder.Property(a => a.Name).HasMaxLength(120).UseCollation(UserConfiguration.CaseInsensitiveCollation).IsRequired();
        builder.Property(a => a.Kind).HasMaxLength(10).IsRequired();
        builder.Property(a => a.BankName).HasMaxLength(80);
        builder.Property(a => a.AccountNumber).HasMaxLength(40);
        builder.Property(a => a.Iban).HasMaxLength(40);
        builder.Property(a => a.OpeningBalance).HasPrecision(12, 2);
        builder.Property(a => a.OpeningDate).HasColumnType("date");
        builder.Property(a => a.IsActive).HasDefaultValue(true);
        builder.Property(a => a.StaffCanUse).HasDefaultValue(false);
        builder.Property(a => a.CreatedUtc).HasColumnType("datetime2");
        builder.Property(a => a.UpdatedUtc).HasColumnType("datetime2");
        builder.HasIndex(a => a.Name).IsUnique();
        builder.HasOne<HrPayroll.Api.Data.Entities.User>().WithMany().HasForeignKey(a => a.HolderUserId).OnDelete(DeleteBehavior.Restrict);
        // One petty-cash account per person.
        builder.HasIndex(a => a.HolderUserId).IsUnique().HasFilter("[HolderUserId] IS NOT NULL");
        builder.HasOne<LedgerAccount>().WithMany().HasForeignKey(a => a.LedgerAccountId).OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class FinCategoryConfiguration : IEntityTypeConfiguration<FinCategory>
{
    public void Configure(EntityTypeBuilder<FinCategory> builder)
    {
        builder.ToTable(t => t.HasCheckConstraint("CK_FinCategories_Kind", "[Kind] IN ('Expense', 'Income', 'Capital', 'CapitalOut')"));
        builder.Property(c => c.Kind).HasMaxLength(10).IsRequired();
        builder.Property(c => c.Name).HasMaxLength(80).UseCollation(UserConfiguration.CaseInsensitiveCollation).IsRequired();
        builder.Property(c => c.IsActive).HasDefaultValue(true);
        builder.HasIndex(c => new { c.Kind, c.Name }).IsUnique();
        builder.HasOne<LedgerAccount>().WithMany().HasForeignKey(c => c.LedgerAccountId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<FinTaxType>().WithMany().HasForeignKey(c => c.DefaultTaxTypeId).OnDelete(DeleteBehavior.Restrict);

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
            new FinCategory { Id = 10, Kind = FinEntryKinds.Income, Name = "Other income" },
            // Capital entries need a category row like every entry; these two are fixed and never offered in Settings or on the entry forms.
            new FinCategory { Id = 11, Kind = FinEntryKinds.Capital, Name = "Capital contribution" },
            new FinCategory { Id = 12, Kind = FinEntryKinds.CapitalOut, Name = "Capital returned" });
    }
}

public sealed class FinEntryConfiguration : IEntityTypeConfiguration<FinEntry>
{
    public void Configure(EntityTypeBuilder<FinEntry> builder)
    {
        builder.ToTable(t =>
        {
            t.HasCheckConstraint("CK_FinEntries_Kind", "[Kind] IN ('Expense', 'Income', 'Capital', 'CapitalOut')");
            t.HasCheckConstraint("CK_FinEntries_Partner", "([Kind] IN ('Capital', 'CapitalOut') AND [PartnerId] IS NOT NULL) OR ([Kind] IN ('Expense', 'Income') AND [PartnerId] IS NULL)");
            t.HasCheckConstraint("CK_FinEntries_Status", "[Status] IN ('Active', 'Voided', 'Pending')");
            t.HasCheckConstraint("CK_FinEntries_Amount", "[Amount] > 0");
            t.HasCheckConstraint("CK_FinEntries_Tax", "[TaxAmount] >= 0");
            t.HasCheckConstraint("CK_FinEntries_Voided", "[Status] IN ('Active', 'Pending') OR [VoidedUtc] IS NOT NULL");
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
        builder.HasOne<FinPartner>().WithMany().HasForeignKey(e => e.PartnerId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(e => e.PartnerId);
        builder.HasOne<FinPayee>().WithMany().HasForeignKey(e => e.PayeeId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(e => e.PayeeId);
        builder.Property(e => e.TaxRate).HasPrecision(5, 2);
        builder.Property(e => e.TaxAmount).HasPrecision(12, 2);
        builder.Property(e => e.TaxInclusive).HasDefaultValue(true);
        builder.HasOne<FinTaxType>().WithMany().HasForeignKey(e => e.TaxTypeId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(e => e.TaxTypeId);
        builder.HasIndex(e => e.EntryNo).IsUnique();
        builder.HasIndex(e => new { e.AccountId, e.EntryDate });
        builder.HasIndex(e => e.EntryDate);
        builder.HasIndex(e => e.CategoryId);
        builder.HasIndex(e => new { e.ExternalSource, e.ExternalId }).IsUnique().HasFilter("[ExternalId] IS NOT NULL");
        builder.HasIndex(e => e.InvoiceId).HasFilter("[InvoiceId] IS NOT NULL");
        builder.HasIndex(e => e.BillId).HasFilter("[BillId] IS NOT NULL");
    }
}

public sealed class FinEntryLineConfiguration : IEntityTypeConfiguration<FinEntryLine>
{
    public void Configure(EntityTypeBuilder<FinEntryLine> builder)
    {
        builder.ToTable(t => t.HasCheckConstraint("CK_FinEntryLines_Amount", "[Amount] > 0"));
        builder.Property(l => l.Amount).HasPrecision(12, 2);
        builder.Property(l => l.Note).HasMaxLength(200);
        builder.HasOne(l => l.Entry).WithMany(e => e.Lines).HasForeignKey(l => l.EntryId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne(l => l.Category).WithMany().HasForeignKey(l => l.CategoryId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(l => l.EntryId);
        builder.HasIndex(l => l.CategoryId);
    }
}

public sealed class FinChequeConfiguration : IEntityTypeConfiguration<FinCheque>
{
    public void Configure(EntityTypeBuilder<FinCheque> builder)
    {
        builder.ToTable(t =>
        {
            t.HasCheckConstraint("CK_FinCheques_Direction", "[Direction] IN ('Issued', 'Received')");
            t.HasCheckConstraint("CK_FinCheques_Status", "[Status] IN ('Issued', 'Delivered', 'Received', 'Deposited', 'Cleared', 'Bounced', 'Cancelled')");
            t.HasCheckConstraint("CK_FinCheques_Amount", "[Amount] > 0");
        });
        builder.Property(c => c.Direction).HasMaxLength(10).IsRequired();
        builder.Property(c => c.Serial).HasMaxLength(30).UseCollation(UserConfiguration.CaseInsensitiveCollation).IsRequired();
        builder.Property(c => c.Amount).HasPrecision(12, 2);
        builder.Property(c => c.PartyName).HasMaxLength(120).IsRequired();
        builder.Property(c => c.IssueDate).HasColumnType("date");
        builder.Property(c => c.DueDate).HasColumnType("date");
        builder.Property(c => c.Status).HasMaxLength(10).IsRequired();
        builder.Property(c => c.StatusDate).HasColumnType("date");
        builder.Property(c => c.StatusNote).HasMaxLength(300);
        builder.Property(c => c.Notes).HasMaxLength(2000);
        builder.Property(c => c.CreatedBy).HasMaxLength(50).IsRequired();
        builder.Property(c => c.CreatedUtc).HasColumnType("datetime2");
        builder.Property(c => c.UpdatedUtc).HasColumnType("datetime2");
        builder.HasOne(c => c.Account).WithMany().HasForeignKey(c => c.AccountId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<FinEntry>().WithMany().HasForeignKey(c => c.EntryId).OnDelete(DeleteBehavior.Restrict);
        // One issued cheque number per account: a cheque book never repeats a serial.
        builder.HasIndex(c => new { c.AccountId, c.Serial }).IsUnique().HasFilter("[Direction] = 'Issued'");
        builder.HasIndex(c => c.DueDate);
        builder.HasIndex(c => c.Status);
        builder.HasIndex(c => c.EntryId);
    }
}

public sealed class LedgerAccountConfiguration : IEntityTypeConfiguration<LedgerAccount>
{
    public void Configure(EntityTypeBuilder<LedgerAccount> builder)
    {
        builder.ToTable(t => t.HasCheckConstraint("CK_LedgerAccounts_Type", "[Type] IN ('Asset', 'Liability', 'Equity', 'Revenue', 'Expense')"));
        builder.Property(a => a.Code).HasMaxLength(20).UseCollation(UserConfiguration.CaseInsensitiveCollation).IsRequired();
        builder.Property(a => a.Name).HasMaxLength(120).IsRequired();
        builder.Property(a => a.Type).HasMaxLength(10).IsRequired();
        builder.Property(a => a.IsActive).HasDefaultValue(true);
        builder.Property(a => a.CreatedUtc).HasColumnType("datetime2");
        builder.HasIndex(a => a.Code).IsUnique();
    }
}

public sealed class JournalConfiguration : IEntityTypeConfiguration<Journal>
{
    public void Configure(EntityTypeBuilder<Journal> builder)
    {
        builder.ToTable(t => t.HasCheckConstraint("CK_Journals_Part", "[Part] IN ('Post', 'Reversal', 'Clear')"));
        builder.Property(j => j.Number).HasMaxLength(20).IsRequired();
        builder.Property(j => j.Date).HasColumnType("date");
        builder.Property(j => j.SourceType).HasMaxLength(12).IsRequired();
        builder.Property(j => j.Part).HasMaxLength(10).IsRequired();
        builder.Property(j => j.Description).HasMaxLength(300).IsRequired();
        builder.Property(j => j.CreatedBy).HasMaxLength(50);
        builder.Property(j => j.CreatedUtc).HasColumnType("datetime2");
        builder.HasOne<Journal>().WithMany().HasForeignKey(j => j.ReversesJournalId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(j => j.Number).IsUnique();
        // A source is posted once per revision, and reversed once: the backstop against two syncs racing.
        builder.HasIndex(j => new { j.SourceType, j.SourceId, j.Revision, j.Part }).IsUnique();
        builder.HasIndex(j => j.Date);
    }
}

public sealed class JournalLineConfiguration : IEntityTypeConfiguration<JournalLine>
{
    public void Configure(EntityTypeBuilder<JournalLine> builder)
    {
        builder.ToTable(t => t.HasCheckConstraint("CK_JournalLines_Side", "([Debit] > 0 AND [Credit] = 0) OR ([Credit] > 0 AND [Debit] = 0)"));
        builder.Property(l => l.Debit).HasPrecision(12, 2);
        builder.Property(l => l.Credit).HasPrecision(12, 2);
        builder.Property(l => l.Memo).HasMaxLength(200);
        builder.HasOne(l => l.Journal).WithMany(j => j.Lines).HasForeignKey(l => l.JournalId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne(l => l.LedgerAccount).WithMany().HasForeignKey(l => l.LedgerAccountId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(l => l.JournalId);
        builder.HasIndex(l => l.LedgerAccountId);
    }
}

public sealed class FinTaxTypeConfiguration : IEntityTypeConfiguration<FinTaxType>
{
    public void Configure(EntityTypeBuilder<FinTaxType> builder)
    {
        builder.ToTable(t =>
        {
            t.HasCheckConstraint("CK_FinTaxTypes_Treatment", "[Treatment] IN ('Standard', 'ZeroRated', 'Exempt', 'ReverseCharge', 'IntraGcc')");
            t.HasCheckConstraint("CK_FinTaxTypes_Rate", "[Rate] >= 0 AND [Rate] <= 100");
        });
        builder.Property(x => x.Name).HasMaxLength(80).UseCollation(UserConfiguration.CaseInsensitiveCollation).IsRequired();
        builder.Property(x => x.Treatment).HasMaxLength(13).IsRequired();
        builder.Property(x => x.Rate).HasPrecision(5, 2);
        builder.Property(x => x.IsActive).HasDefaultValue(true);
        builder.HasIndex(x => x.Name).IsUnique();

        // The list the accountant already uses in Daftra (without excise and amendments). Rates are 5% for standard and for reverse charge.
        builder.HasData(
            new FinTaxType { Id = 1, Name = "Standard Rated (VAT)", Treatment = FinTaxTreatments.Standard, Rate = 5m, SortOrder = 1 },
            new FinTaxType { Id = 2, Name = "Zero Rated", Treatment = FinTaxTreatments.ZeroRated, Rate = 0m, SortOrder = 2 },
            new FinTaxType { Id = 3, Name = "Exempt", Treatment = FinTaxTreatments.Exempt, Rate = 0m, SortOrder = 3 },
            new FinTaxType { Id = 4, Name = "Reverse Charges (VAT)", Treatment = FinTaxTreatments.ReverseCharge, Rate = 5m, SortOrder = 4 },
            new FinTaxType { Id = 5, Name = "Intra GCC", Treatment = FinTaxTreatments.IntraGcc, Rate = 0m, SortOrder = 5 });
    }
}

public sealed class FinPayeeConfiguration : IEntityTypeConfiguration<FinPayee>
{
    public void Configure(EntityTypeBuilder<FinPayee> builder)
    {
        builder.ToTable(t => t.HasCheckConstraint("CK_FinPayees_Kind", "[Kind] IN ('Expense', 'Income')"));
        builder.Property(p => p.Kind).HasMaxLength(10).IsRequired();
        builder.Property(p => p.Name).HasMaxLength(120).UseCollation(UserConfiguration.CaseInsensitiveCollation).IsRequired();
        builder.Property(p => p.Phone).HasMaxLength(40);
        builder.Property(p => p.TaxNumber).HasMaxLength(40);
        builder.Property(p => p.Notes).HasMaxLength(500);
        builder.Property(p => p.IsActive).HasDefaultValue(true);
        builder.Property(p => p.CreatedUtc).HasColumnType("datetime2");
        builder.HasOne<FinCategory>().WithMany().HasForeignKey(p => p.DefaultCategoryId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(p => new { p.Kind, p.Name }).IsUnique();
    }
}

public sealed class FinPartnerConfiguration : IEntityTypeConfiguration<FinPartner>
{
    public void Configure(EntityTypeBuilder<FinPartner> builder)
    {
        builder.ToTable(t => t.HasCheckConstraint("CK_FinPartners_OpeningCapital", "[OpeningCapital] >= 0"));
        builder.Property(p => p.Name).HasMaxLength(120).UseCollation(UserConfiguration.CaseInsensitiveCollation).IsRequired();
        builder.Property(p => p.OpeningCapital).HasPrecision(12, 2);
        builder.HasOne<LedgerAccount>().WithMany().HasForeignKey(p => p.LedgerAccountId).OnDelete(DeleteBehavior.Restrict);
        builder.Property(p => p.IsActive).HasDefaultValue(true);
        builder.Property(p => p.CreatedUtc).HasColumnType("datetime2");
        builder.Property(p => p.UpdatedUtc).HasColumnType("datetime2");
        builder.HasIndex(p => p.Name).IsUnique();
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

public sealed class FinAttachmentConfiguration : IEntityTypeConfiguration<FinAttachment>
{
    public void Configure(EntityTypeBuilder<FinAttachment> builder)
    {
        builder.Property(a => a.FileName).HasMaxLength(120).IsRequired();
        builder.Property(a => a.ContentType).HasMaxLength(40).IsRequired();
        builder.Property(a => a.StoredName).HasMaxLength(80).IsRequired();
        builder.Property(a => a.Sha256).HasMaxLength(64).IsRequired();
        builder.Property(a => a.UploadedBy).HasMaxLength(50).IsRequired();
        builder.Property(a => a.UploadedUtc).HasColumnType("datetime2");
        builder.HasOne(a => a.Entry).WithMany().HasForeignKey(a => a.EntryId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(a => a.EntryId);
        // A corrected entry points at the same stored file as the entry it replaces, so a file may be named by several rows.
        builder.HasIndex(a => a.StoredName);
    }
}

public sealed class FinMonthLockConfiguration : IEntityTypeConfiguration<FinMonthLock>
{
    public void Configure(EntityTypeBuilder<FinMonthLock> builder)
    {
        builder.ToTable(t => t.HasCheckConstraint("CK_FinMonthLocks_Month", "[Month] BETWEEN 1 AND 12"));
        builder.Property(l => l.LockedBy).HasMaxLength(50).IsRequired();
        builder.Property(l => l.LockedUtc).HasColumnType("datetime2");
        builder.Property(l => l.UnlockedBy).HasMaxLength(50);
        builder.Property(l => l.UnlockedUtc).HasColumnType("datetime2");
        builder.Property(l => l.UnlockReason).HasMaxLength(300);
        builder.HasIndex(l => new { l.Year, l.Month }).IsUnique();
    }
}

public sealed class FinBillConfiguration : IEntityTypeConfiguration<FinBill>
{
    public void Configure(EntityTypeBuilder<FinBill> builder)
    {
        builder.ToTable(t =>
        {
            t.HasCheckConstraint("CK_FinBills_Status", "[Status] IN ('Open', 'Voided')");
            t.HasCheckConstraint("CK_FinBills_Amounts", "[Net] > 0 AND [Total] >= [Net] AND [TaxAmount] >= 0");
        });
        builder.Property(b => b.BillNo).HasMaxLength(20).IsRequired();
        builder.HasIndex(b => b.BillNo).IsUnique();
        builder.Property(b => b.SupplierName).HasMaxLength(120).IsRequired();
        builder.Property(b => b.SupplierRef).HasMaxLength(60);
        builder.Property(b => b.BillDate).HasColumnType("date");
        builder.Property(b => b.DueDate).HasColumnType("date");
        builder.Property(b => b.Notes).HasMaxLength(2000);
        builder.Property(b => b.Status).HasMaxLength(10).IsRequired();
        builder.Property(b => b.TaxRate).HasPrecision(5, 2);
        builder.Property(b => b.TaxAmount).HasPrecision(12, 2);
        builder.Property(b => b.Net).HasPrecision(12, 2);
        builder.Property(b => b.Total).HasPrecision(12, 2);
        builder.Property(b => b.VoidReason).HasMaxLength(300);
        builder.Property(b => b.VoidedBy).HasMaxLength(50);
        builder.Property(b => b.VoidedUtc).HasColumnType("datetime2");
        builder.Property(b => b.CreatedBy).HasMaxLength(50).IsRequired();
        builder.Property(b => b.CreatedUtc).HasColumnType("datetime2");
        builder.HasOne<FinPayee>().WithMany().HasForeignKey(b => b.PayeeId).OnDelete(DeleteBehavior.Restrict);
        builder.HasMany(b => b.Lines).WithOne(l => l.Bill).HasForeignKey(l => l.BillId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(b => b.BillDate);
        builder.HasIndex(b => b.Status);
    }
}

public sealed class FinBillLineConfiguration : IEntityTypeConfiguration<FinBillLine>
{
    public void Configure(EntityTypeBuilder<FinBillLine> builder)
    {
        builder.ToTable(t => t.HasCheckConstraint("CK_FinBillLines_Amount", "[Amount] > 0"));
        builder.Property(l => l.Amount).HasPrecision(12, 2);
        builder.Property(l => l.Note).HasMaxLength(200);
        builder.HasOne(l => l.Category).WithMany().HasForeignKey(l => l.CategoryId).OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class RecurringJournalConfiguration : IEntityTypeConfiguration<RecurringJournal>
{
    public void Configure(EntityTypeBuilder<RecurringJournal> builder)
    {
        builder.ToTable(t => t.HasCheckConstraint("CK_RecurringJournals_Day", "[DayOfMonth] BETWEEN 1 AND 31"));
        builder.Property(r => r.Description).HasMaxLength(250).IsRequired();
        builder.Property(r => r.StartMonth).HasColumnType("date");
        builder.Property(r => r.EndMonth).HasColumnType("date");
        builder.Property(r => r.CreatedBy).HasMaxLength(50).IsRequired();
        builder.Property(r => r.CreatedUtc).HasColumnType("datetime2");
        builder.Property(r => r.StoppedBy).HasMaxLength(50);
        builder.Property(r => r.StoppedUtc).HasColumnType("datetime2");
        builder.HasMany(r => r.Lines).WithOne(l => l.RecurringJournal).HasForeignKey(l => l.RecurringJournalId).OnDelete(DeleteBehavior.Cascade);
    }
}

public sealed class RecurringJournalLineConfiguration : IEntityTypeConfiguration<RecurringJournalLine>
{
    public void Configure(EntityTypeBuilder<RecurringJournalLine> builder)
    {
        builder.ToTable(t => t.HasCheckConstraint("CK_RecurringJournalLines_Side", "[Debit] >= 0 AND [Credit] >= 0 AND (([Debit] > 0 AND [Credit] = 0) OR ([Debit] = 0 AND [Credit] > 0))"));
        builder.Property(l => l.Debit).HasPrecision(12, 2);
        builder.Property(l => l.Credit).HasPrecision(12, 2);
        builder.Property(l => l.Memo).HasMaxLength(200);
        builder.HasOne(l => l.LedgerAccount).WithMany().HasForeignKey(l => l.LedgerAccountId).OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class RecurringJournalRunConfiguration : IEntityTypeConfiguration<RecurringJournalRun>
{
    public void Configure(EntityTypeBuilder<RecurringJournalRun> builder)
    {
        builder.Property(r => r.Month).HasColumnType("date");
        builder.Property(r => r.PostedUtc).HasColumnType("datetime2");
        builder.HasOne<RecurringJournal>().WithMany().HasForeignKey(r => r.RecurringJournalId).OnDelete(DeleteBehavior.Restrict);
        // A month is posted once: the backstop against two requests racing.
        builder.HasIndex(r => new { r.RecurringJournalId, r.Month }).IsUnique();
    }
}
