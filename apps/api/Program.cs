using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Threading.RateLimiting;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Middleware;
using HrPayroll.Api.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Infrastructure;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using Serilog;
using Serilog.Events;

const string LogTemplate = "[{Timestamp:HH:mm:ss} {Level:u3}] [{CorrelationId}] {Message:lj}{NewLine}{Exception}";

var builder = WebApplication.CreateBuilder(args);

builder.Host.UseSerilog((context, logger) =>
{
    logger
        .MinimumLevel.Information()
        .MinimumLevel.Override("Microsoft.AspNetCore", LogEventLevel.Warning)
        .MinimumLevel.Override("Microsoft.EntityFrameworkCore", LogEventLevel.Warning)
        .Enrich.FromLogContext()
        .Enrich.WithProperty("CorrelationId", "-") // default for events outside a request; never overrides the real id
        .WriteTo.Console(outputTemplate: LogTemplate);

    if (context.Configuration.GetValue("Observability:WriteToFile", true))
    {
        var directory = context.Configuration["Observability:LogDirectory"] ?? "logs";
        logger.WriteTo.File(
            Path.Combine(directory, "hrpayroll-.log"),
            rollingInterval: RollingInterval.Day,
            retainedFileCountLimit: 30,
            outputTemplate: LogTemplate);
    }
});

// The connection string is read lazily so test hosts and environment variables can override it.
builder.Services.AddDbContext<AppDbContext>((services, options) =>
    options.UseSqlServer(services.GetRequiredService<IConfiguration>().GetConnectionString("Default")));

builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<IAuditLogger, AuditLogger>();

// Authentication. Jwt settings are read lazily (when first needed) so test hosts and environment variables can
// override them; the startup check below refuses to run without a usable key.
builder.Services.AddOptions<JwtOptions>().Configure<IConfiguration>(
    (options, configuration) => configuration.GetSection(JwtOptions.SectionName).Bind(options));
builder.Services.AddSingleton<JwtTokenService>();
builder.Services.AddSingleton<IPasswordHasher<User>, PasswordHasher<User>>();
builder.Services.AddScoped<AuthService>();
builder.Services.AddScoped<UserService>();
builder.Services.AddScoped<AdminSeeder>();
builder.Services.AddScoped<WorkerService>();
builder.Services.AddScoped<SettingsService>();
builder.Services.AddScoped<WageRedactor>();
builder.Services.AddScoped<AttendanceService>();
builder.Services.AddScoped<LeaveService>();
builder.Services.AddScoped<LeaveBalanceService>();
builder.Services.AddScoped<LeaveAttendanceSync>();
builder.Services.AddScoped<PayrollService>();
builder.Services.AddSingleton<PayrollPdf>();
builder.Services.AddSingleton<PayslipPdf>();
builder.Services.AddSingleton<WorkerProfilePdf>();
builder.Services.AddScoped<WorkerProfileService>();
builder.Services.AddScoped<AttendanceExportService>();
builder.Services.AddScoped<PayslipService>();
builder.Services.AddScoped<DeductionService>();
builder.Services.AddScoped<IPayrollPeriodLock, PayrollPeriodLock>();

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer();
builder.Services.AddOptions<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme)
    .Configure<IOptions<JwtOptions>>((bearer, jwtOptions) =>
    {
        var jwt = jwtOptions.Value;
        bearer.MapInboundClaims = false; // keep "sub" as "sub"; name and role are already the long ClaimTypes URIs
        bearer.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = jwt.Issuer,
            ValidateAudience = true,
            ValidAudience = jwt.Audience,
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromMinutes(1),
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.Key)),
            ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
            NameClaimType = ClaimTypes.Name,
            RoleClaimType = ClaimTypes.Role,
        };
        bearer.Events = new JwtBearerEvents
        {
            OnTokenValidated = async context =>
            {
                var subject = context.Principal?.FindFirstValue("sub");
                var tokenName = context.Principal?.Identity?.Name;
                if (!int.TryParse(subject, out var userId) || string.IsNullOrWhiteSpace(tokenName))
                {
                    context.Fail("Invalid account.");
                    return;
                }

                var db = context.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
                var current = await db.Users.AsNoTracking()
                    .Where(user => user.Id == userId)
                    .Select(user => new { user.Username, user.Role, user.IsActive })
                    .SingleOrDefaultAsync(context.HttpContext.RequestAborted);
                if (current is null || !current.IsActive || !string.Equals(current.Username, tokenName, StringComparison.OrdinalIgnoreCase))
                {
                    context.Fail("Invalid account.");
                    return;
                }

                var identity = new ClaimsIdentity(context.Scheme.Name, ClaimTypes.Name, ClaimTypes.Role);
                identity.AddClaim(new Claim("sub", userId.ToString(System.Globalization.CultureInfo.InvariantCulture)));
                identity.AddClaim(new Claim(ClaimTypes.Name, current.Username));
                identity.AddClaim(new Claim(ClaimTypes.Role, current.Role));
                context.Principal = new ClaimsPrincipal(identity);
            },
        };
    });

builder.Services.AddSingleton<IAuthorizationMiddlewareResultHandler, UnmatchedRouteFriendlyAuthorizationResultHandler>();
builder.Services.AddAuthorizationBuilder()
    .AddPolicy(Policies.AnyUser, policy => policy.RequireAuthenticatedUser())
    .AddPolicy(Policies.ManagerOrAdmin, policy => policy.RequireAuthenticatedUser().RequireRole(Roles.Administrator, Roles.Manager))
    .AddPolicy(Policies.ManagerAdminOrHr, policy => policy.RequireAuthenticatedUser().RequireRole(Roles.Administrator, Roles.Manager, Roles.HR))
    .AddPolicy(Policies.SupervisorOrAbove, policy => policy.RequireAuthenticatedUser().RequireRole(Roles.Administrator, Roles.Manager, Roles.Supervisor))
    .AddPolicy(Policies.AdminOnly, policy => policy.RequireAuthenticatedUser().RequireRole(Roles.Administrator))
    // Secure by default: any endpoint without its own authorization metadata needs a signed-in user.
    .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());

// Login is limited per client IP (A10). The limit is read lazily so test hosts and environment variables can override
// it. Behind a reverse proxy the real client IP needs forwarded-headers support (S8).
const int DefaultLoginPerMinute = 10;
builder.Services.AddRateLimiter(_ => { });
builder.Services.AddOptions<RateLimiterOptions>().Configure<IConfiguration>((options, configuration) =>
{
    var permitLimit = configuration.GetValue("RateLimiting:LoginPerMinute", DefaultLoginPerMinute);
    if (permitLimit < 1)
    {
        permitLimit = DefaultLoginPerMinute;
    }

    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy(RateLimitPolicies.Login, httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = permitLimit,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
                AutoReplenishment = true,
            }));
    options.OnRejected = async (context, cancellationToken) =>
    {
        if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter))
        {
            context.HttpContext.Response.Headers.RetryAfter =
                ((int)Math.Ceiling(retryAfter.TotalSeconds)).ToString(System.Globalization.CultureInfo.InvariantCulture);
        }

        var problem = new ProblemDetails
        {
            Status = StatusCodes.Status429TooManyRequests,
            Title = "Too many attempts. Try again later.",
        };
        await context.HttpContext.Response.WriteAsJsonAsync(
            problem, options: null, contentType: "application/problem+json", cancellationToken);
    };
});

builder.Services.AddControllers()
    .ConfigureApiBehaviorOptions(options =>
        // Automatic 400s keep the C# property names ("CurrentPassword") as error keys; the web client matches
        // them to form fields by the JSON names, so re-key them in camelCase.
        options.InvalidModelStateResponseFactory = context =>
        {
            var factory = context.HttpContext.RequestServices.GetRequiredService<ProblemDetailsFactory>();
            var details = factory.CreateValidationProblemDetails(context.HttpContext, context.ModelState);
            details.Errors = details.Errors.ToDictionary(
                error => string.Join('.', error.Key.Split('.').Select(JsonNamingPolicy.CamelCase.ConvertName)),
                error => error.Value);
            return new BadRequestObjectResult(details) { ContentTypes = { "application/problem+json" } };
        });

var app = builder.Build();

if (string.IsNullOrWhiteSpace(app.Configuration.GetConnectionString("Default")))
{
    throw new InvalidOperationException(
        "ConnectionStrings:Default is not configured. Set the ConnectionStrings__Default environment variable.");
}

var jwtKey = app.Configuration["Jwt:Key"];
if (string.IsNullOrWhiteSpace(jwtKey) || jwtKey.Length < JwtOptions.MinimumKeyLength)
{
    throw new InvalidOperationException(
        $"Jwt:Key must be at least {JwtOptions.MinimumKeyLength} characters. Set the Jwt__Key environment variable.");
}

if (app.Configuration.GetValue<bool>("Database:MigrateOnStartup"))
{
    using var scope = app.Services.CreateScope();
    await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.MigrateAsync();
}

// First run (A12): create the initial administrator once the database is reachable and migrated.
using (var scope = app.Services.CreateScope())
{
    await scope.ServiceProvider.GetRequiredService<AdminSeeder>().SeedWhenReadyAsync();
}

// Behind a load balancer (for example an AWS ALB that terminates HTTPS) the real client IP and scheme arrive in
// X-Forwarded-* headers. Off by default: enable it only when the server is reachable solely through that proxy,
// because it trusts those headers from any caller.
if (app.Configuration.GetValue<bool>("Hosting:BehindProxy"))
{
    var forwarded = new ForwardedHeadersOptions
    {
        ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
    };
    forwarded.KnownIPNetworks.Clear();
    forwarded.KnownProxies.Clear();
    app.UseForwardedHeaders(forwarded);
}

// A published build carries the web app in wwwroot, so one site serves both the API and the UI (no CORS needed).
// Hashed files under /assets never change and cache for a year; the entry page, manifest and service worker must
// always revalidate so a new release (and a changed service worker) reaches users promptly.
var webRoot = app.Environment.WebRootPath;
var hasWebApp = webRoot is not null && File.Exists(Path.Combine(webRoot, "index.html"));
var webFileOptions = new StaticFileOptions
{
    OnPrepareResponse = context =>
    {
        context.Context.Response.Headers.CacheControl = context.Context.Request.Path.StartsWithSegments("/assets")
            ? "public,max-age=31536000,immutable"
            : "no-cache";
    },
};
if (hasWebApp)
{
    app.UseDefaultFiles();
    app.UseStaticFiles(webFileOptions);
}

// Routing is placed explicitly, after the static files: the host would otherwise add it first, and an already-matched
// fallback endpoint would shadow the files above.
app.UseRouting();

app.UseMiddleware<CorrelationIdMiddleware>();
app.UseSerilogRequestLogging();
app.UseMiddleware<ExceptionHandlingMiddleware>();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

if (hasWebApp)
{
    // Client-side routes (/payroll, /leave, ...) load the app shell; unknown /api paths stay a plain 404.
    app.MapFallbackToFile("{*path:regex(^(?!api(/|$)).*$)}", "index.html", webFileOptions).AllowAnonymous();
}

app.Run();

public partial class Program;
