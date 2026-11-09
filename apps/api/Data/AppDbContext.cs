using HrPayroll.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<LeaveRequest> LeaveRequests => Set<LeaveRequest>();
    public DbSet<LeaveAttachment> LeaveAttachments => Set<LeaveAttachment>();
    public DbSet<WorkerPhoto> WorkerPhotos => Set<WorkerPhoto>();
    public DbSet<Worker> Workers => Set<Worker>();
    public DbSet<Attendance> Attendance => Set<Attendance>();
    public DbSet<PayrollSettings> PayrollSettings => Set<PayrollSettings>();

    public DbSet<PayrollPeriod> PayrollPeriods => Set<PayrollPeriod>();
    public DbSet<PayrollDetail> PayrollDetails => Set<PayrollDetail>();
    public DbSet<DeductionType> DeductionTypes => Set<DeductionType>();
    public DbSet<WorkerDeduction> WorkerDeductions => Set<WorkerDeduction>();
    public DbSet<PayrollDeductionLine> PayrollDeductionLines => Set<PayrollDeductionLine>();

    public DbSet<DocumentSettings> DocumentSettings => Set<DocumentSettings>();
    public DbSet<InvoiceClient> InvoiceClients => Set<InvoiceClient>();
    public DbSet<Invoice> Invoices => Set<Invoice>();
    public DbSet<InvoiceLine> InvoiceLines => Set<InvoiceLine>();
    public DbSet<InvoicePayment> InvoicePayments => Set<InvoicePayment>();
    public DbSet<IssuedLetter> IssuedLetters => Set<IssuedLetter>();
    public DbSet<SiteProject> SiteProjects => Set<SiteProject>();
    public DbSet<SiteProgressReport> SiteProgressReports => Set<SiteProgressReport>();
    public DbSet<SiteProgressFloor> SiteProgressFloors => Set<SiteProgressFloor>();

    protected override void OnModelCreating(ModelBuilder modelBuilder) =>
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);
}
