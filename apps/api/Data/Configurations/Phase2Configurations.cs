using HrPayroll.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace HrPayroll.Api.Data.Configurations;

public sealed class DocumentSettingsConfiguration : IEntityTypeConfiguration<DocumentSettings>
{
    public void Configure(EntityTypeBuilder<DocumentSettings> b)
    {
        b.ToTable(t =>
        {
            t.HasCheckConstraint("CK_DocumentSettings_SingleRow", $"[Id] = {DocumentSettings.SingletonId}");
            t.HasCheckConstraint("CK_DocumentSettings_NextInvoiceNumber", "[NextInvoiceNumber] >= 1");
        });
        b.Property(s => s.Id).ValueGeneratedNever();
        b.Property(s => s.CompanyName).HasMaxLength(120).IsRequired();
        b.Property(s => s.CompanySubtitle).HasMaxLength(120).IsRequired();
        b.Property(s => s.CompanyNameAr).HasMaxLength(160).IsRequired();
        b.Property(s => s.Mobile).HasMaxLength(30).IsRequired();
        b.Property(s => s.Address1).HasMaxLength(120).IsRequired();
        b.Property(s => s.Address2).HasMaxLength(120).IsRequired();
        b.Property(s => s.Email).HasMaxLength(120).IsRequired();
        b.Property(s => s.Trn).HasMaxLength(30).IsRequired();
        b.Property(s => s.BankName).HasMaxLength(80).IsRequired();
        b.Property(s => s.AccountName).HasMaxLength(120).IsRequired();
        b.Property(s => s.AccountNumber).HasMaxLength(40).IsRequired();
        b.Property(s => s.Iban).HasMaxLength(40).IsRequired();
        b.Property(s => s.DefaultPaymentTerms).HasMaxLength(40).IsRequired();
        b.Property(s => s.DefaultInvoiceNotes).HasMaxLength(300).IsRequired();
        b.Property(s => s.SignerName).HasMaxLength(80).IsRequired();
        b.Property(s => s.SignerTitle).HasMaxLength(80).IsRequired();
        b.Property(s => s.Logo).HasColumnType("varbinary(max)");
        b.Property(s => s.LogoContentType).HasMaxLength(20);
        b.Property(s => s.Seal).HasColumnType("varbinary(max)");
        b.Property(s => s.SealContentType).HasMaxLength(20);
        b.Property(s => s.Signature).HasColumnType("varbinary(max)");
        b.Property(s => s.SignatureContentType).HasMaxLength(20);
        b.Property(s => s.UpdatedUtc).HasColumnType("datetime2");

        // Starting values come from the client's prototypes; a Manager edits them under Settings. The bank details and
        // TRN are left blank on purpose: the client enters their own.
        b.HasData(new DocumentSettings
        {
            Id = DocumentSettings.SingletonId,
            CompanyName = "DE AKS BE GLASS & ALUMINIUM",
            CompanySubtitle = "INSTALLATION & MAINTENANCE CO. L.L.C S.O.C",
            CompanyNameAr = "دي اكس بي للزجاج وأعمال الألمنيوم وصيانتها ذ.م.م ش.ش.و",
            Mobile = "+971557884821",
            Address1 = "Um Hurair Second",
            Address2 = "Dubai Medical, Dubai, U.A.E.",
            Email = "hr@dxbaluminium.ae",
            Trn = "",
            BankName = "",
            AccountName = "",
            AccountNumber = "",
            Iban = "",
            DefaultPaymentTerms = "Due on Receipt",
            DefaultInvoiceNotes = "Thank you for your business!",
            NextInvoiceNumber = 185,
            SignerName = "",
            SignerTitle = "General Manager / Authorized Signatory",
            UpdatedUtc = new DateTime(2026, 11, 9, 0, 0, 0, DateTimeKind.Utc),
        });
    }
}

public sealed class InvoiceClientConfiguration : IEntityTypeConfiguration<InvoiceClient>
{
    public void Configure(EntityTypeBuilder<InvoiceClient> b)
    {
        b.Property(c => c.Name).HasMaxLength(120).UseCollation(UserConfiguration.CaseInsensitiveCollation).IsRequired();
        b.HasIndex(c => c.Name).IsUnique();
        b.Property(c => c.Trn).HasMaxLength(30).IsRequired();
        b.Property(c => c.Address).HasMaxLength(250).IsRequired();
    }
}

public sealed class InvoiceConfiguration : IEntityTypeConfiguration<Invoice>
{
    public void Configure(EntityTypeBuilder<Invoice> b)
    {
        b.ToTable(t =>
        {
            t.HasCheckConstraint("CK_Invoices_Status", "[Status] IN ('Draft','Issued','Cancelled')");
            t.HasCheckConstraint("CK_Invoices_Totals", "[SubTotal] >= 0 AND [VatTotal] >= 0 AND [Total] = [SubTotal] + [VatTotal]");
            t.HasCheckConstraint("CK_Invoices_NumberWhenIssued", "([Status] = 'Draft' AND [Number] IS NULL) OR ([Status] <> 'Draft' AND [Number] IS NOT NULL)");
        });
        b.Property(i => i.Number).HasMaxLength(30);
        b.HasIndex(i => i.Number).IsUnique().HasFilter("[Number] IS NOT NULL");
        b.Property(i => i.Status).HasMaxLength(10).IsRequired();
        b.HasOne(i => i.Client).WithMany().HasForeignKey(i => i.ClientId).OnDelete(DeleteBehavior.Restrict);
        b.Property(i => i.ClientName).HasMaxLength(120).IsRequired();
        b.Property(i => i.ClientTrn).HasMaxLength(30).IsRequired();
        b.Property(i => i.ClientAddress).HasMaxLength(250).IsRequired();
        b.Property(i => i.InvoiceDate).HasColumnType("date");
        b.Property(i => i.DueDate).HasColumnType("date");
        b.Property(i => i.PaymentTerms).HasMaxLength(40).IsRequired();
        b.Property(i => i.LpoRef).HasMaxLength(80).IsRequired();
        b.Property(i => i.Project).HasMaxLength(120).IsRequired();
        b.Property(i => i.Scope).HasMaxLength(120).IsRequired();
        b.Property(i => i.Notes).HasMaxLength(300).IsRequired();
        b.Property(i => i.SubTotal).HasPrecision(14, 2);
        b.Property(i => i.VatTotal).HasPrecision(14, 2);
        b.Property(i => i.Total).HasPrecision(14, 2);
        b.Property(i => i.CompanyJson).HasColumnType("nvarchar(max)");
        b.Property(i => i.CreatedBy).HasMaxLength(50).IsRequired();
        b.Property(i => i.IssuedBy).HasMaxLength(50);
        b.Property(i => i.CancelReason).HasMaxLength(300);
        b.Property(i => i.CreatedUtc).HasColumnType("datetime2");
        b.Property(i => i.UpdatedUtc).HasColumnType("datetime2");
        b.Property(i => i.IssuedUtc).HasColumnType("datetime2");
        b.Property(i => i.CancelledUtc).HasColumnType("datetime2");
        b.HasIndex(i => i.InvoiceDate);
    }
}

public sealed class InvoiceLineConfiguration : IEntityTypeConfiguration<InvoiceLine>
{
    public void Configure(EntityTypeBuilder<InvoiceLine> b)
    {
        b.ToTable(t => t.HasCheckConstraint("CK_InvoiceLines_Amounts", "[Quantity] >= 0 AND [Rate] >= 0"));
        b.HasOne(l => l.Invoice).WithMany(i => i.Lines).HasForeignKey(l => l.InvoiceId).OnDelete(DeleteBehavior.Cascade);
        b.HasIndex(l => new { l.InvoiceId, l.LineNo }).IsUnique();
        b.Property(l => l.Description).HasMaxLength(500).IsRequired();
        b.Property(l => l.Quantity).HasPrecision(14, 2);
        b.Property(l => l.Rate).HasPrecision(14, 2);
        b.Property(l => l.Taxable).HasPrecision(14, 2);
        b.Property(l => l.Vat).HasPrecision(14, 2);
        b.Property(l => l.Amount).HasPrecision(14, 2);
    }
}

public sealed class InvoicePaymentConfiguration : IEntityTypeConfiguration<InvoicePayment>
{
    public void Configure(EntityTypeBuilder<InvoicePayment> b)
    {
        b.ToTable(t => t.HasCheckConstraint("CK_InvoicePayments_Amount", "[Amount] > 0"));
        b.HasOne(p => p.Invoice).WithMany(i => i.Payments).HasForeignKey(p => p.InvoiceId).OnDelete(DeleteBehavior.Cascade);
        b.Property(p => p.PaidDate).HasColumnType("date");
        b.Property(p => p.Amount).HasPrecision(14, 2);
        b.Property(p => p.Method).HasMaxLength(30).IsRequired();
        b.Property(p => p.Reference).HasMaxLength(60).IsRequired();
        b.Property(p => p.RecordedBy).HasMaxLength(50).IsRequired();
        b.Property(p => p.RecordedUtc).HasColumnType("datetime2");
    }
}

public sealed class IssuedLetterConfiguration : IEntityTypeConfiguration<IssuedLetter>
{
    public void Configure(EntityTypeBuilder<IssuedLetter> b)
    {
        b.ToTable(t =>
        {
            t.HasCheckConstraint("CK_IssuedLetters_Type", "[LetterType] IN ('Salary','Service','BankTransfer','Noc')");
            t.HasCheckConstraint("CK_IssuedLetters_Sequence", "[Sequence] >= 1");
        });
        b.Property(l => l.RefNo).HasMaxLength(30).IsRequired();
        b.HasIndex(l => l.RefNo).IsUnique();
        b.HasIndex(l => new { l.Year, l.Sequence }).IsUnique();
        b.Property(l => l.LetterType).HasMaxLength(15).IsRequired();
        b.HasOne(l => l.Worker).WithMany().HasForeignKey(l => l.WorkerId).OnDelete(DeleteBehavior.Restrict);
        b.Property(l => l.IssueDate).HasColumnType("date");
        b.Property(l => l.AddressedTo).HasMaxLength(200).IsRequired();
        b.Property(l => l.ContentJson).HasColumnType("nvarchar(max)").IsRequired();
        b.Property(l => l.IssuedBy).HasMaxLength(50).IsRequired();
        b.Property(l => l.IssuedUtc).HasColumnType("datetime2");
        b.HasIndex(l => l.IssueDate);
    }
}

public sealed class CertificateRequestConfiguration : IEntityTypeConfiguration<CertificateRequest>
{
    public void Configure(EntityTypeBuilder<CertificateRequest> b)
    {
        b.ToTable(t =>
        {
            t.HasCheckConstraint("CK_CertificateRequests_Type", "[LetterType] IN ('Salary','Service','BankTransfer','Noc')");
            t.HasCheckConstraint("CK_CertificateRequests_Status", "[Status] IN ('Requested','PendingApproval','Returned','Approved')");
        });
        b.HasOne(r => r.Worker).WithMany().HasForeignKey(r => r.WorkerId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(r => r.IssuedLetter).WithMany().HasForeignKey(r => r.IssuedLetterId).OnDelete(DeleteBehavior.Restrict);
        b.Property(r => r.LetterType).HasMaxLength(15).IsRequired();
        b.Property(r => r.Reason).HasMaxLength(500).IsRequired();
        b.Property(r => r.Status).HasMaxLength(20).IsRequired();
        b.Property(r => r.RequestedBy).HasMaxLength(50).IsRequired();
        b.Property(r => r.RequestedUtc).HasColumnType("datetime2");
        b.Property(r => r.DetailsJson).HasColumnType("nvarchar(max)");
        b.Property(r => r.PreparedBy).HasMaxLength(50);
        b.Property(r => r.PreparedUtc).HasColumnType("datetime2");
        b.Property(r => r.ReviewedBy).HasMaxLength(50);
        b.Property(r => r.ReviewedUtc).HasColumnType("datetime2");
        b.Property(r => r.ReviewNote).HasMaxLength(500).IsRequired();
        b.HasIndex(r => r.Status);
        b.HasIndex(r => r.RequestedBy);
    }
}

public sealed class SiteProjectConfiguration : IEntityTypeConfiguration<SiteProject>
{
    public void Configure(EntityTypeBuilder<SiteProject> b)
    {
        b.Property(p => p.Name).HasMaxLength(120).UseCollation(UserConfiguration.CaseInsensitiveCollation).IsRequired();
        b.HasIndex(p => p.Name).IsUnique();
    }
}

public sealed class SiteProgressReportConfiguration : IEntityTypeConfiguration<SiteProgressReport>
{
    public void Configure(EntityTypeBuilder<SiteProgressReport> b)
    {
        b.HasOne(r => r.Project).WithMany().HasForeignKey(r => r.ProjectId).OnDelete(DeleteBehavior.Restrict);
        b.Property(r => r.ReportDate).HasColumnType("date");
        b.HasIndex(r => new { r.ProjectId, r.ReportDate }).IsUnique();
        b.Property(r => r.UpdatedBy).HasMaxLength(50).IsRequired();
        b.Property(r => r.UpdatedUtc).HasColumnType("datetime2");
    }
}

public sealed class SiteProgressFloorConfiguration : IEntityTypeConfiguration<SiteProgressFloor>
{
    public void Configure(EntityTypeBuilder<SiteProgressFloor> b)
    {
        b.ToTable(t =>
        {
            t.HasCheckConstraint("CK_SiteProgressFloors_Counts", "[Frames] >= 0 AND [Glass] >= 0 AND [Shutters] >= 0");
            t.HasCheckConstraint("CK_SiteProgressFloors_Alignment", "[Alignment] IN ('NotComplete','UnderProcess','Complete')");
            t.HasCheckConstraint("CK_SiteProgressFloors_Completion", "[Completion] IN ('NotStarted','InProgress','Completed')");
            t.HasCheckConstraint("CK_SiteProgressFloors_Wir", "[WirStatus] IN ('Pending','Submitted','AlignmentNotComplete','AlignmentUnderProcess','AlignmentComplete','Approved','ApprovedWithComments','Rejected')");
        });
        b.HasOne(f => f.Report).WithMany(r => r.Floors).HasForeignKey(f => f.ReportId).OnDelete(DeleteBehavior.Cascade);
        b.Property(f => f.Floor).HasMaxLength(60).UseCollation(UserConfiguration.CaseInsensitiveCollation).IsRequired();
        b.HasIndex(f => new { f.ReportId, f.Floor }).IsUnique();
        b.Property(f => f.Shutters).HasDefaultValue(0);
        b.Property(f => f.Alignment).HasMaxLength(12).HasDefaultValue(AlignmentStatuses.NotComplete).IsRequired();
        b.Property(f => f.Completion).HasMaxLength(12).IsRequired();
        b.Property(f => f.WirStatus).HasMaxLength(24).IsRequired();
        b.Property(f => f.Remarks).HasMaxLength(500).IsRequired();
        b.Property(f => f.IsLocked).HasDefaultValue(false);
    }
}
