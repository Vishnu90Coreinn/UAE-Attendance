using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options);
