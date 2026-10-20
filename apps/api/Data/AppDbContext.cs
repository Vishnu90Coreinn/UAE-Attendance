using HrPayroll.Api.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<LeaveRequest> LeaveRequests => Set<LeaveRequest>();
    public DbSet<Worker> Workers => Set<Worker>();
    public DbSet<Attendance> Attendance => Set<Attendance>();
    public DbSet<PayrollSettings> PayrollSettings => Set<PayrollSettings>();

    public DbSet<PayrollPeriod> PayrollPeriods => Set<PayrollPeriod>();
    public DbSet<PayrollDetail> PayrollDetails => Set<PayrollDetail>();

    protected override void OnModelCreating(ModelBuilder modelBuilder) =>
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);
}
