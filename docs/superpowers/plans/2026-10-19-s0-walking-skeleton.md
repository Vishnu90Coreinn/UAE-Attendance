# S0 — Walking Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running, tested, empty application: an ASP.NET Core API that connects to SQL Server and reports its health, and a React shell that shows the five module tabs (disabled) and a live "API / Database" status chip.

**Architecture:** One API project (`apps/api`: controllers → services → EF Core), one test project (`apps/api.tests`), one SPA (`apps/web`). Cross-cutting plumbing built now so every later slice inherits it: correlation id, centralised error handling, structured logging, environment-driven configuration, migrations, and an integration-test harness that runs against a real SQL Server database.

**Tech Stack:** net10.0 · ASP.NET Core · EF Core 10.0.13 (SQL Server) · Serilog.AspNetCore 10.0.0 · xUnit 2.9.3 + Mvc.Testing · React 19.3 · TypeScript 5.9 · Vite 8 · Vitest 5 · Tailwind CSS 4.3 · React Router 7.18.

**Master plan:** `docs/superpowers/plans/2026-10-19-hr-payroll-vertical-slices.md` (slice S0).

> **Verified.** Every code block below was built and run in a scratch copy on 2026-10-19 on this machine (.NET SDK 10.0.300, Node 24.14, LocalDB): 18 API tests pass, 15 web tests pass, `tsc` and `vite build` are clean, and the page was checked in a browser against the live API. Expected outputs below are from those runs; durations and timestamps will differ.

---

## Deviations from the master plan

| # | Master plan said | This plan does | Why |
|---|------------------|----------------|-----|
| 1 | EF Core 9 | **EF Core 10.0.13** | The SDK is 10.0.300 and `dotnet-ef` is 10.x; EF 10 is the matching release. TimeSheet's EF 9 pin was a workaround for its own InMemory test setup, which we do not use (decision D5) |
| 2 | Ports unspecified | API **5210**, web **5273** | TimeSheet uses 7012 and 5173; both apps can run side by side |
| 3 | Dev HTTPS implied | Dev runs over **HTTP**; HTTPS redirect and HSTS are added in S8 | Avoids dev-certificate friction; production TLS is a deployment concern |
| 4 | — | Direct reference to `System.Security.Cryptography.Pkcs` 10.0.13 | A transitive 9.0.11 copy triggers NU1902/NU1903 vulnerability warnings; pinning removes them |
| 5 | — | `jsdom` pinned to `^29.1.1` | jsdom 30 needs Node ≥ 24.15; this machine has 24.14 |
| 6 | Correlation id as in TimeSheet | Incoming `X-Correlation-ID` is accepted only if it matches `^[A-Za-z0-9_-]{1,64}\z` | Prevents log injection through a crafted header |
| 7 | — | `GET /api/health` is anonymous | Needed before sign-in exists. **From S1 every other endpoint must carry `[Authorize]`** |

---

## Prerequisites (verify first)

- [ ] **Step 1: Check tools**

Run:
```bash
dotnet --version
node --version
npm --version
sqllocaldb info
```
Expected: `10.0.300` (or a later 10.0.x), Node `v22.13+` or `v24.x`, npm 10+, and `MSSQLLocalDB` in the LocalDB list. If LocalDB is missing, install SQL Server Express LocalDB, or set `TEST_SQL_CONNECTION` (see Task 5).

- [ ] **Step 2: Update the EF tools** (the installed 10.0.5 works but prints a warning against runtime 10.0.13)

Run: `dotnet tool update --global dotnet-ef`
Expected: "Tool 'dotnet-ef' was successfully updated" (or "already installed").

- [ ] **Step 3: Check the repository state**

Run: `git -C D:/GitHubRepository/UAE-Attendance status --short`
Expected: only `docs/` untracked, no commits yet. All remaining commands run from `D:\GitHubRepository\UAE-Attendance` (the "repo root") unless a step says otherwise.

---

## File structure created by this plan

```
.editorconfig  .gitattributes  .gitignore  .env.example  global.json  README.md  HrPayroll.sln
.claude/launch.json
apps/
  api/
    HrPayroll.Api.csproj  Program.cs  appsettings.json  appsettings.Development.json
    Properties/launchSettings.json
    Controllers/HealthController.cs
    Dtos/HealthResponse.cs
    Data/AppDbContext.cs  Data/DesignTimeDbContextFactory.cs  Data/Migrations/*_Initial*.cs
    Middleware/CorrelationIdMiddleware.cs  Middleware/ExceptionHandlingMiddleware.cs
  api.tests/
    HrPayroll.Api.Tests.csproj
    Helpers/ApiFactory.cs  Helpers/CapturingLogger.cs  Helpers/TestDatabase.cs
    Unit/CorrelationIdMiddlewareTests.cs  Unit/ExceptionHandlingMiddlewareTests.cs
    Integration/HealthEndpointTests.cs  Integration/MigrationTests.cs
  web/
    package.json  tsconfig.json  vite.config.ts  index.html
    src/main.tsx  src/App.tsx  src/App.test.tsx  src/styles.css  src/test-setup.ts
    src/api/client.ts  client.test.ts  health.ts  health.test.ts
    src/components/Layout.tsx  Layout.test.tsx  HealthChip.tsx  HealthChip.test.tsx  navItems.ts
    src/pages/Home.tsx  NotFound.tsx
```

Responsibilities: `Middleware/*` is request plumbing only; `Controllers/HealthController` is the only endpoint; `Helpers/*` are test-only infrastructure; `web/src/api/*` is the only code that calls `fetch`.

---

## Task 1: Repository hygiene and branch

**Files:** Create `.gitignore`, `.gitattributes`, `.editorconfig`, `global.json`, `.env.example`, `README.md`.

- [ ] **Step 1: Create `.gitignore`**

```gitignore
# .NET
bin/
obj/
*.user
*.suo
.vs/
TestResults/

# Logs
logs/
*.log

# Node
node_modules/
dist/
*.tsbuildinfo
coverage/

# Environment and secrets (the .example file is the only one that is committed)
.env
.env.*
!.env.example
appsettings.Production.json
appsettings.*.local.json

# Local tooling and editors
.idea/
.vscode/
.claude/settings.local.json
.claude/worktrees/
publish/
.DS_Store
Thumbs.db
```

- [ ] **Step 2: Create `.gitattributes`**

```gitattributes
* text=auto
```

- [ ] **Step 3: Create `.editorconfig`**

```ini
root = true

[*]
charset = utf-8
insert_final_newline = true
trim_trailing_whitespace = true
indent_style = space
indent_size = 2

[*.{cs,csproj}]
indent_size = 4

[*.md]
trim_trailing_whitespace = false
```

- [ ] **Step 4: Create `global.json`** (pins the SDK so every machine builds the same way)

```json
{
  "sdk": {
    "version": "10.0.300",
    "rollForward": "latestFeature"
  }
}
```

- [ ] **Step 5: Create `.env.example`** (.NET reads real environment variables, not this file; it documents what each environment must set)

````dotenv
# Connection to the HR database. Use a dedicated SQL login with rights on this database only.
ConnectionStrings__Default=Server=<host>;Database=HrPayroll;User Id=<hr_app_login>;Password=<password>;Encrypt=True;TrustServerCertificate=False

# Logging (optional)
Observability__WriteToFile=true
Observability__LogDirectory=logs

# Apply EF migrations automatically at start-up. Leave unset in production; apply migrations with `dotnet ef` instead.
Database__MigrateOnStartup=false
````

- [ ] **Step 6: Create `README.md`**

````markdown
# HR & Payroll System

Web application for DE AKS BE GLASS & ALUMINIUM CO. L.L.C S.O.C: worker directory, daily attendance, monthly payroll,
leave management and user access.

React + TypeScript (`apps/web`) · ASP.NET Core Web API (`apps/api`) · SQL Server via EF Core · xUnit and Vitest.

Plans live in `docs/superpowers/plans/`. Start with `2026-10-19-hr-payroll-vertical-slices.md`.

## Prerequisites

- .NET SDK 10 (see `global.json`)
- Node.js 22.13+ or 24+
- SQL Server LocalDB (included with Visual Studio) for development and tests

## Run it

Terminal 1 — API on http://localhost:5210 (creates and migrates the `HrPayroll_Dev` LocalDB database on first start):

```bash
dotnet run --project apps/api --launch-profile HrPayroll.Api
```

Terminal 2 — web app on http://localhost:5273 (proxies `/api` to the API):

```bash
cd apps/web
npm install
npm run dev
```

## Test it

```bash
dotnet test                      # API unit + integration tests (needs LocalDB)
cd apps/web && npm test          # web tests
cd apps/web && npm run lint      # type check
cd apps/web && npm run build     # production build
```

Integration tests create and drop their own throw-away database. To use a different SQL Server, set
`TEST_SQL_CONNECTION` to a connection string (the database name is ignored).

## Configuration

Settings come from `appsettings*.json` and are overridden by environment variables (`__` replaces `:`).
See `.env.example`. Production must set `ConnectionStrings__Default`; the API refuses to start without it.

## Database migrations

```bash
dotnet ef migrations add <Name> --project apps/api --output-dir Data/Migrations
ConnectionStrings__Default="<connection string>" dotnet ef database update --project apps/api
```
````

- [ ] **Step 7: Commit the planning documents and hygiene files on `master`, then branch**

Run:
```bash
git add .
git commit -m "chore: repo hygiene files and planning documents"
git switch -c slice/s0-walking-skeleton
```
Expected: one commit created; `git branch --show-current` prints `slice/s0-walking-skeleton`.

---

## Task 2: Solution and project scaffolding

**Files:** Create `apps/api/HrPayroll.Api.csproj`, `apps/api/Program.cs`, `apps/api.tests/HrPayroll.Api.Tests.csproj`, `HrPayroll.sln`.

- [ ] **Step 1: Create `apps/api/HrPayroll.Api.csproj`**

```xml
<Project Sdk="Microsoft.NET.Sdk.Web">

  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <RootNamespace>HrPayroll.Api</RootNamespace>
    <AssemblyName>HrPayroll.Api</AssemblyName>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.EntityFrameworkCore.Design" Version="10.0.13">
      <IncludeAssets>runtime; build; native; contentfiles; analyzers; buildtransitive</IncludeAssets>
      <PrivateAssets>all</PrivateAssets>
    </PackageReference>
    <PackageReference Include="Microsoft.EntityFrameworkCore.SqlServer" Version="10.0.13" />
    <PackageReference Include="Serilog.AspNetCore" Version="10.0.0" />
    <PackageReference Include="System.Security.Cryptography.Pkcs" Version="10.0.13" />
  </ItemGroup>

</Project>
```

- [ ] **Step 2: Create `apps/api/Program.cs`** (placeholder; replaced in Task 6)

```csharp
var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

app.Run();

public partial class Program;
```

- [ ] **Step 3: Create `apps/api.tests/HrPayroll.Api.Tests.csproj`**

```xml
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <IsPackable>false</IsPackable>
    <RootNamespace>HrPayroll.Api.Tests</RootNamespace>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.AspNetCore.Mvc.Testing" Version="10.0.13" />
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.14.1" />
    <PackageReference Include="xunit" Version="2.9.3" />
    <PackageReference Include="xunit.runner.visualstudio" Version="3.1.4" />
  </ItemGroup>

  <ItemGroup>
    <ProjectReference Include="..\api\HrPayroll.Api.csproj" />
  </ItemGroup>

  <ItemGroup>
    <Using Include="Xunit" />
  </ItemGroup>

</Project>
```

- [ ] **Step 4: Create the solution and add both projects**

Run:
```bash
dotnet new sln -n HrPayroll --format sln
dotnet sln add apps/api/HrPayroll.Api.csproj apps/api.tests/HrPayroll.Api.Tests.csproj
dotnet build
```
Expected: `HrPayroll.sln` is created (not `.slnx`; the `--format sln` flag matters on SDK 10), both projects are added, and the build ends with `Build succeeded.` `0 Warning(s)` `0 Error(s)`. The first build restores packages and takes about a minute.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "chore: scaffold solution, API project and test project"
```

---

## Task 3: Correlation id middleware

**Files:** Create `apps/api.tests/Unit/CorrelationIdMiddlewareTests.cs`, `apps/api/Middleware/CorrelationIdMiddleware.cs`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api.tests/Unit/CorrelationIdMiddlewareTests.cs`:

```csharp
using HrPayroll.Api.Middleware;
using Microsoft.AspNetCore.Http;

namespace HrPayroll.Api.Tests.Unit;

public class CorrelationIdMiddlewareTests
{
    private static async Task<DefaultHttpContext> InvokeAsync(string? incomingId)
    {
        var context = new DefaultHttpContext();
        if (incomingId is not null)
        {
            context.Request.Headers[CorrelationIdMiddleware.HeaderName] = incomingId;
        }

        var middleware = new CorrelationIdMiddleware(_ => Task.CompletedTask);
        await middleware.InvokeAsync(context);
        return context;
    }

    [Fact]
    public async Task InvokeAsync_WithoutIncomingHeader_GeneratesIdAndReturnsItInResponse()
    {
        var context = await InvokeAsync(null);

        var responseId = context.Response.Headers[CorrelationIdMiddleware.HeaderName].ToString();
        Assert.False(string.IsNullOrWhiteSpace(responseId));
        Assert.Equal(responseId, context.Items[CorrelationIdMiddleware.HeaderName]);
    }

    [Fact]
    public async Task InvokeAsync_WithValidIncomingHeader_KeepsIt()
    {
        var context = await InvokeAsync("abc-123_XYZ");

        Assert.Equal("abc-123_XYZ", context.Response.Headers[CorrelationIdMiddleware.HeaderName].ToString());
        Assert.Equal("abc-123_XYZ", context.Items[CorrelationIdMiddleware.HeaderName]);
    }

    [Theory]
    [InlineData("")]
    [InlineData("has space")]
    [InlineData("line\r\nbreak")]
    [InlineData("<script>")]
    [InlineData("trailing-newline\n")]
    public async Task InvokeAsync_WithUnsafeIncomingHeader_ReplacesIt(string unsafeId)
    {
        var context = await InvokeAsync(unsafeId);

        var responseId = context.Response.Headers[CorrelationIdMiddleware.HeaderName].ToString();
        Assert.NotEqual(unsafeId, responseId);
        Assert.Matches(@"^[A-Za-z0-9_-]{1,64}\z", responseId);
    }

    [Fact]
    public async Task InvokeAsync_WithOverlongIncomingHeader_ReplacesIt()
    {
        var overlong = new string('a', 65);

        var context = await InvokeAsync(overlong);

        Assert.NotEqual(overlong, context.Response.Headers[CorrelationIdMiddleware.HeaderName].ToString());
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `dotnet test --filter "FullyQualifiedName~CorrelationIdMiddlewareTests"`
Expected: build FAILS with `error CS0234: The type or namespace name 'Middleware' does not exist in the namespace 'HrPayroll.Api'`.

- [ ] **Step 3: Write the minimal implementation**

Create `apps/api/Middleware/CorrelationIdMiddleware.cs`:

```csharp
using System.Text.RegularExpressions;
using Serilog.Context;

namespace HrPayroll.Api.Middleware;

/// <summary>
/// Gives every request a correlation id: reuses a safe incoming X-Correlation-ID header,
/// otherwise generates one. The id is returned in the response, stored in HttpContext.Items
/// and attached to every log event written while the request runs.
/// </summary>
public sealed partial class CorrelationIdMiddleware(RequestDelegate next)
{
    public const string HeaderName = "X-Correlation-ID";

    [GeneratedRegex(@"^[A-Za-z0-9_-]{1,64}\z")]
    private static partial Regex SafeIdPattern();

    public async Task InvokeAsync(HttpContext context)
    {
        var incoming = context.Request.Headers[HeaderName].FirstOrDefault();
        var correlationId = incoming is not null && SafeIdPattern().IsMatch(incoming)
            ? incoming
            : Guid.NewGuid().ToString("N");

        context.Items[HeaderName] = correlationId;
        context.Response.Headers[HeaderName] = correlationId;

        using (LogContext.PushProperty("CorrelationId", correlationId))
        {
            await next(context);
        }
    }
}
```

The pattern ends in `\z`, not `$`, because `$` also matches before a trailing newline.

- [ ] **Step 4: Run to verify it passes**

Run: `dotnet test --filter "FullyQualifiedName~CorrelationIdMiddlewareTests"`
Expected: `Passed!  - Failed: 0, Passed: 8, Skipped: 0, Total: 8`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/Middleware/CorrelationIdMiddleware.cs apps/api.tests/Unit/CorrelationIdMiddlewareTests.cs
git commit -m "feat(api): correlation id middleware with header sanitising"
```

---

## Task 4: Centralised exception handling

**Files:** Create `apps/api.tests/Helpers/CapturingLogger.cs`, `apps/api.tests/Unit/ExceptionHandlingMiddlewareTests.cs`, `apps/api/Middleware/ExceptionHandlingMiddleware.cs`.

- [ ] **Step 1: Write the test helper**

Create `apps/api.tests/Helpers/CapturingLogger.cs`:

```csharp
using Microsoft.Extensions.Logging;

namespace HrPayroll.Api.Tests.Helpers;

/// <summary>Minimal in-memory logger so tests can assert that something was logged.</summary>
public sealed class CapturingLogger<T> : ILogger<T>
{
    public List<(LogLevel Level, Exception? Exception, string Message)> Entries { get; } = [];

    public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

    public bool IsEnabled(LogLevel logLevel) => true;

    public void Log<TState>(
        LogLevel logLevel,
        EventId eventId,
        TState state,
        Exception? exception,
        Func<TState, Exception?, string> formatter)
    {
        Entries.Add((logLevel, exception, formatter(state, exception)));
    }
}
```

- [ ] **Step 2: Write the failing tests**

Create `apps/api.tests/Unit/ExceptionHandlingMiddlewareTests.cs`:

```csharp
using System.Text.Json;
using HrPayroll.Api.Middleware;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace HrPayroll.Api.Tests.Unit;

public class ExceptionHandlingMiddlewareTests
{
    private static DefaultHttpContext NewContext()
    {
        var context = new DefaultHttpContext();
        context.Response.Body = new MemoryStream();
        context.Items[CorrelationIdMiddleware.HeaderName] = "test-correlation-id";
        return context;
    }

    private static async Task<string> ReadBodyAsync(HttpContext context)
    {
        context.Response.Body.Seek(0, SeekOrigin.Begin);
        return await new StreamReader(context.Response.Body).ReadToEndAsync();
    }

    [Fact]
    public async Task InvokeAsync_WhenNextThrows_ReturnsProblemDetailsWithoutLeakingTheMessage()
    {
        var logger = new CapturingLogger<ExceptionHandlingMiddleware>();
        var middleware = new ExceptionHandlingMiddleware(
            _ => throw new InvalidOperationException("secret connection detail"), logger);
        var context = NewContext();

        await middleware.InvokeAsync(context);

        Assert.Equal(StatusCodes.Status500InternalServerError, context.Response.StatusCode);
        Assert.StartsWith("application/problem+json", context.Response.ContentType);

        var body = await ReadBodyAsync(context);
        Assert.DoesNotContain("secret connection detail", body);
        Assert.DoesNotContain("InvalidOperationException", body);

        using var json = JsonDocument.Parse(body);
        var propertyNames = json.RootElement.EnumerateObject().Select(property => property.Name).Order().ToArray();
        Assert.Equal(["correlationId", "status", "title", "type"], propertyNames);
        Assert.Equal(500, json.RootElement.GetProperty("status").GetInt32());
        Assert.Equal("An unexpected error occurred.", json.RootElement.GetProperty("title").GetString());
        Assert.Equal("test-correlation-id", json.RootElement.GetProperty("correlationId").GetString());
    }

    [Fact]
    public async Task InvokeAsync_WhenNextThrows_LogsTheExceptionAsAnError()
    {
        var logger = new CapturingLogger<ExceptionHandlingMiddleware>();
        var failure = new InvalidOperationException("boom");
        var middleware = new ExceptionHandlingMiddleware(_ => throw failure, logger);

        await middleware.InvokeAsync(NewContext());

        var entry = Assert.Single(logger.Entries);
        Assert.Equal(LogLevel.Error, entry.Level);
        Assert.Same(failure, entry.Exception);
    }

    [Fact]
    public async Task InvokeAsync_WhenRequestWasAborted_DoesNotReportAnError()
    {
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        var logger = new CapturingLogger<ExceptionHandlingMiddleware>();
        var middleware = new ExceptionHandlingMiddleware(
            _ => throw new OperationCanceledException(cancellation.Token), logger);
        var context = NewContext();
        context.RequestAborted = cancellation.Token;

        await middleware.InvokeAsync(context);

        Assert.Equal(StatusCodes.Status200OK, context.Response.StatusCode);
        Assert.Empty(logger.Entries);
    }

    [Fact]
    public async Task InvokeAsync_WhenNextSucceeds_LeavesTheResponseAlone()
    {
        var logger = new CapturingLogger<ExceptionHandlingMiddleware>();
        var middleware = new ExceptionHandlingMiddleware(_ => Task.CompletedTask, logger);
        var context = NewContext();

        await middleware.InvokeAsync(context);

        Assert.Equal(StatusCodes.Status200OK, context.Response.StatusCode);
        Assert.Empty(logger.Entries);
    }
}
```

- [ ] **Step 3: Run to verify it fails**

Run: `dotnet test --filter "FullyQualifiedName~ExceptionHandlingMiddlewareTests"`
Expected: build FAILS with `error CS0246: The type or namespace name 'ExceptionHandlingMiddleware' could not be found`.

- [ ] **Step 4: Write the minimal implementation**

Create `apps/api/Middleware/ExceptionHandlingMiddleware.cs`:

```csharp
using Microsoft.AspNetCore.Mvc;

namespace HrPayroll.Api.Middleware;

/// <summary>
/// Last line of defence for unexpected exceptions: logs the full exception and returns a generic
/// RFC 9457 problem document carrying only the correlation id. Nothing about the failure
/// (message, type, stack trace) is sent to the client.
/// </summary>
public sealed class ExceptionHandlingMiddleware(RequestDelegate next, ILogger<ExceptionHandlingMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await next(context);
        }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
        {
            // The client went away; there is nobody to answer and nothing to report.
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Unhandled exception for {Method} {Path}",
                context.Request.Method, context.Request.Path);

            if (context.Response.HasStarted)
            {
                throw;
            }

            var problem = new ProblemDetails
            {
                Status = StatusCodes.Status500InternalServerError,
                Title = "An unexpected error occurred.",
                Type = "https://www.rfc-editor.org/rfc/rfc9110#section-15.6.1",
            };

            if (context.Items.TryGetValue(CorrelationIdMiddleware.HeaderName, out var correlationId))
            {
                problem.Extensions["correlationId"] = correlationId;
            }

            context.Response.StatusCode = StatusCodes.Status500InternalServerError;
            await context.Response.WriteAsJsonAsync(
                problem, options: null, contentType: "application/problem+json");
        }
    }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `dotnet test`
Expected: `Passed!  - Failed: 0, Passed: 12, Skipped: 0, Total: 12` (8 correlation + 4 exception).

- [ ] **Step 6: Commit**

```bash
git add apps/api/Middleware/ExceptionHandlingMiddleware.cs apps/api.tests/Helpers/CapturingLogger.cs apps/api.tests/Unit/ExceptionHandlingMiddlewareTests.cs
git commit -m "feat(api): centralised exception handling returning problem details"
```

---

## Task 5: Database context, migration and the real-SQL-Server test harness

**Files:** Create `apps/api.tests/Helpers/TestDatabase.cs`, `apps/api.tests/Integration/MigrationTests.cs`, `apps/api/Data/AppDbContext.cs`, `apps/api/Data/DesignTimeDbContextFactory.cs`, `apps/api/appsettings.json`, `apps/api/appsettings.Development.json`, `apps/api/Data/Migrations/*` (generated).

- [ ] **Step 1: Write the test database fixture**

Create `apps/api.tests/Helpers/TestDatabase.cs`:

```csharp
using HrPayroll.Api.Data;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Helpers;

/// <summary>
/// Creates a throw-away SQL Server database, applies the real EF migrations to it, and drops it
/// afterwards. Uses LocalDB by default; set TEST_SQL_CONNECTION to point at another SQL Server
/// (the Database/Initial Catalog part is ignored).
/// </summary>
public sealed class TestDatabase : IAsyncLifetime
{
    private const string DefaultServerConnection =
        @"Server=(localdb)\MSSQLLocalDB;Integrated Security=true;TrustServerCertificate=True;Connect Timeout=30";

    private readonly string _databaseName = $"HrPayroll_Test_{Guid.NewGuid():N}";
    private string _masterConnectionString = "";

    public string ConnectionString { get; private set; } = "";

    public async Task InitializeAsync()
    {
        var serverConnection = Environment.GetEnvironmentVariable("TEST_SQL_CONNECTION") ?? DefaultServerConnection;
        _masterConnectionString = new SqlConnectionStringBuilder(serverConnection) { InitialCatalog = "master" }.ConnectionString;
        ConnectionString = new SqlConnectionStringBuilder(serverConnection) { InitialCatalog = _databaseName }.ConnectionString;

        await ExecuteOnMasterAsync($"CREATE DATABASE [{_databaseName}]");

        var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(ConnectionString).Options;
        await using var db = new AppDbContext(options);
        await db.Database.MigrateAsync();
    }

    public async Task DisposeAsync()
    {
        SqlConnection.ClearAllPools();
        await ExecuteOnMasterAsync(
            $"ALTER DATABASE [{_databaseName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{_databaseName}];");
    }

    private async Task ExecuteOnMasterAsync(string sql)
    {
        await using var connection = new SqlConnection(_masterConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync();
    }
}
```

- [ ] **Step 2: Write the failing migration test**

Create `apps/api.tests/Integration/MigrationTests.cs`:

```csharp
using HrPayroll.Api.Data;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Integration;

public class MigrationTests(TestDatabase database) : IClassFixture<TestDatabase>
{
    [Fact]
    public async Task Migrations_ApplyCleanlyToAnEmptyDatabase()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(database.ConnectionString).Options;
        await using var db = new AppDbContext(options);

        var applied = await db.Database.GetAppliedMigrationsAsync();
        var pending = await db.Database.GetPendingMigrationsAsync();

        Assert.Contains(applied, name => name.EndsWith("_Initial"));
        Assert.Empty(pending);
    }
}
```

- [ ] **Step 3: Run to verify it fails (compile)**

Run: `dotnet test --filter "FullyQualifiedName~MigrationTests"`
Expected: build FAILS with `error CS0234: The type or namespace name 'Data' does not exist in the namespace 'HrPayroll.Api'`.

- [ ] **Step 4: Create the DbContext, design-time factory and settings files**

Create `apps/api/Data/AppDbContext.cs`:

```csharp
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options);
```

Create `apps/api/Data/DesignTimeDbContextFactory.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace HrPayroll.Api.Data;

/// <summary>
/// Lets `dotnet ef` build the context without starting the web host. Reads the same
/// ConnectionStrings:Default setting as the app (appsettings files, then environment variables),
/// so `ConnectionStrings__Default=... dotnet ef database update` targets any server.
/// </summary>
public sealed class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<AppDbContext>
{
    public AppDbContext CreateDbContext(string[] args)
    {
        var configuration = new ConfigurationBuilder()
            .SetBasePath(Directory.GetCurrentDirectory())
            .AddJsonFile("appsettings.json", optional: true)
            .AddJsonFile("appsettings.Development.json", optional: true)
            .AddEnvironmentVariables()
            .Build();

        var connectionString = configuration.GetConnectionString("Default")
            ?? throw new InvalidOperationException(
                "ConnectionStrings:Default is not configured. Set the ConnectionStrings__Default environment variable.");

        var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(connectionString).Options;
        return new AppDbContext(options);
    }
}
```

Create `apps/api/appsettings.json`:

```json
{
  "AllowedHosts": "*",
  "Observability": {
    "WriteToFile": true,
    "LogDirectory": "logs"
  }
}
```

Create `apps/api/appsettings.Development.json` (write it exactly; the doubled backslash is JSON escaping for the LocalDB instance name):

```json
{
  "ConnectionStrings": {
    "Default": "Server=(localdb)\\MSSQLLocalDB;Database=HrPayroll_Dev;Integrated Security=true;TrustServerCertificate=True"
  },
  "Database": {
    "MigrateOnStartup": true
  }
}
```

- [ ] **Step 5: Run to verify it fails (assertion)**

Run: `dotnet test --filter "FullyQualifiedName~MigrationTests"`
Expected: 1 test FAILS with `Assert.Contains() Failure: Filter not matched in collection` — the database was created but there is no migration yet. (This also proves LocalDB works. If it errors on connecting, fix LocalDB or set `TEST_SQL_CONNECTION` before continuing.)

- [ ] **Step 6: Generate the empty `Initial` migration**

Run: `dotnet ef migrations add Initial --project apps/api --output-dir Data/Migrations`
Expected: `Done. To undo this action, use 'ef migrations remove'` and three new files under `apps/api/Data/Migrations/` (`<timestamp>_Initial.cs`, `<timestamp>_Initial.Designer.cs`, `AppDbContextModelSnapshot.cs`). The `Up` and `Down` methods are empty because there are no entities yet; that is intended. The timestamp differs from any other machine's.

- [ ] **Step 7: Run to verify it passes**

Run: `dotnet test`
Expected: `Passed!  - Failed: 0, Passed: 13, Skipped: 0, Total: 13`.

- [ ] **Step 8: Commit**

```bash
git add apps
git commit -m "feat(api): EF Core context, empty initial migration and SQL Server test harness"
```

---

## Task 6: Health endpoint and application wiring

**Files:** Create `apps/api.tests/Helpers/ApiFactory.cs`, `apps/api.tests/Integration/HealthEndpointTests.cs`, `apps/api/Dtos/HealthResponse.cs`, `apps/api/Controllers/HealthController.cs`, `apps/api/Properties/launchSettings.json`; replace `apps/api/Program.cs`.

- [ ] **Step 1: Write the API test factory**

Create `apps/api.tests/Helpers/ApiFactory.cs`:

```csharp
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace HrPayroll.Api.Tests.Helpers;

/// <summary>Boots the real API in-process against the given SQL Server connection string.</summary>
public sealed class ApiFactory(string connectionString) : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        // "Testing" keeps appsettings.Development.json (dev database, migrate-on-startup) out of the run.
        builder.UseEnvironment("Testing");
        builder.ConfigureAppConfiguration((_, configuration) =>
        {
            configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Default"] = connectionString,
                ["Observability:WriteToFile"] = "false",
            });
        });
    }
}
```

- [ ] **Step 2: Write the failing endpoint tests**

Create `apps/api.tests/Integration/HealthEndpointTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using HrPayroll.Api.Middleware;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.Data.SqlClient;

namespace HrPayroll.Api.Tests.Integration;

public class HealthEndpointTests(TestDatabase database) : IClassFixture<TestDatabase>
{
    [Fact]
    public async Task Get_WhenDatabaseIsReachable_ReturnsOk()
    {
        await using var factory = new ApiFactory(database.ConnectionString);
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/api/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("ok", body.GetProperty("status").GetString());
        Assert.Equal("ok", body.GetProperty("database").GetString());
    }

    [Fact]
    public async Task Get_WithoutCorrelationIdHeader_ReturnsAGeneratedOne()
    {
        await using var factory = new ApiFactory(database.ConnectionString);
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/api/health");

        Assert.True(response.Headers.TryGetValues(CorrelationIdMiddleware.HeaderName, out var values));
        Assert.False(string.IsNullOrWhiteSpace(values!.Single()));
    }

    [Fact]
    public async Task Get_WithCorrelationIdHeader_EchoesIt()
    {
        await using var factory = new ApiFactory(database.ConnectionString);
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/health");
        request.Headers.Add(CorrelationIdMiddleware.HeaderName, "from-the-client-1");

        var response = await client.SendAsync(request);

        Assert.Equal("from-the-client-1", response.Headers.GetValues(CorrelationIdMiddleware.HeaderName).Single());
    }

    [Fact]
    public async Task Get_WhenDatabaseIsUnreachable_ReturnsServiceUnavailableWithoutDetails()
    {
        var unreachable = new SqlConnectionStringBuilder(database.ConnectionString)
        {
            InitialCatalog = $"HrPayroll_DoesNotExist_{Guid.NewGuid():N}",
            ConnectTimeout = 3,
        }.ConnectionString;
        await using var factory = new ApiFactory(unreachable);
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/api/health");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        var text = await response.Content.ReadAsStringAsync();
        var body = JsonDocument.Parse(text).RootElement;
        Assert.Equal("degraded", body.GetProperty("status").GetString());
        Assert.Equal("unreachable", body.GetProperty("database").GetString());
        Assert.DoesNotContain("DoesNotExist", text);
    }

    [Fact]
    public async Task Get_UnknownRoute_ReturnsNotFound()
    {
        await using var factory = new ApiFactory(database.ConnectionString);
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/api/does-not-exist");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
```

- [ ] **Step 3: Run to verify it fails**

Run: `dotnet test --filter "FullyQualifiedName~HealthEndpointTests"`
Expected: `Failed!  - Failed: 4, Passed: 1, Total: 5`. The four health tests fail (the empty placeholder `Program` serves no `/api/health`); the unknown-route test passes already and stays as a regression guard.

- [ ] **Step 4: Create the response DTO and controller**

Create `apps/api/Dtos/HealthResponse.cs`:

```csharp
namespace HrPayroll.Api.Dtos;

public sealed record HealthResponse(string Status, string Database);
```

Create `apps/api/Controllers/HealthController.cs`:

```csharp
using HrPayroll.Api.Data;
using HrPayroll.Api.Dtos;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Controllers;

[ApiController]
[Route("api/health")]
public sealed class HealthController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<HealthResponse>> Get(CancellationToken cancellationToken)
    {
        var databaseReachable = await db.Database.CanConnectAsync(cancellationToken);

        return databaseReachable
            ? Ok(new HealthResponse("ok", "ok"))
            : StatusCode(StatusCodes.Status503ServiceUnavailable, new HealthResponse("degraded", "unreachable"));
    }
}
```

- [ ] **Step 5: Replace `apps/api/Program.cs`** with the full wiring

```csharp
using HrPayroll.Api.Data;
using HrPayroll.Api.Middleware;
using Microsoft.EntityFrameworkCore;
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

builder.Services.AddControllers();

var app = builder.Build();

if (string.IsNullOrWhiteSpace(app.Configuration.GetConnectionString("Default")))
{
    throw new InvalidOperationException(
        "ConnectionStrings:Default is not configured. Set the ConnectionStrings__Default environment variable.");
}

if (app.Configuration.GetValue<bool>("Database:MigrateOnStartup"))
{
    using var scope = app.Services.CreateScope();
    await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.MigrateAsync();
}

app.UseMiddleware<CorrelationIdMiddleware>();
app.UseSerilogRequestLogging();
app.UseMiddleware<ExceptionHandlingMiddleware>();

app.MapControllers();

app.Run();

public partial class Program;
```

Order matters: the correlation id is set first so request logs and error responses carry it; request logging wraps exception handling so a 500 is logged with its final status. `.Enrich.FromLogContext()` must come **before** the `"-"` default: Serilog keeps the first value written for a property, so the default placed first would hide the real id.

- [ ] **Step 6: Create `apps/api/Properties/launchSettings.json`**

```json
{
  "$schema": "https://json.schemastore.org/launchsettings.json",
  "profiles": {
    "HrPayroll.Api": {
      "commandName": "Project",
      "dotnetRunMessages": true,
      "launchBrowser": false,
      "applicationUrl": "http://localhost:5210",
      "environmentVariables": {
        "ASPNETCORE_ENVIRONMENT": "Development"
      }
    }
  }
}
```

- [ ] **Step 7: Run all API tests**

Run: `dotnet test`
Expected: `Passed!  - Failed: 0, Passed: 18, Skipped: 0, Total: 18`. No warnings.

- [ ] **Step 8: Commit**

```bash
git add apps
git commit -m "feat(api): health endpoint, Serilog logging and request pipeline wiring"
```

---

## Task 7: Run the API for real

No new files. This checks what the tests cannot: Kestrel, console log format and the log file.

- [ ] **Step 1: Start the API** (leave it running in its own terminal)

Run: `dotnet run --project apps/api --launch-profile HrPayroll.Api`
Expected within a few seconds: `[..] INF] [-] Now listening on: http://localhost:5210` and `Hosting environment: Development`. The first start creates the `HrPayroll_Dev` database in LocalDB and applies the migration.

- [ ] **Step 2: Call the endpoints**

Run:
```bash
curl -i http://localhost:5210/api/health
curl -i -H "X-Correlation-ID: demo-123" http://localhost:5210/api/health
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5210/api/nope
```
Expected: `HTTP/1.1 200 OK` with body `{"status":"ok","database":"ok"}` and an `X-Correlation-ID` header; the second call echoes `demo-123`; the third prints `404`.

- [ ] **Step 3: Check the logs**

Expected in the API terminal: lines like `[20:32:08 INF] [demo-123] HTTP GET /api/health responded 200 in 80.6692 ms` — the real correlation id in brackets, `[-]` only for start-up lines. Expected on disk: `apps/api/logs/hrpayroll-<yyyyMMdd>.log` with the same lines (and git does not list it, because `logs/` is ignored).

- [ ] **Step 4: Check the fail-fast configuration guard**

Stop the API, then run (this uses the Production environment, which has no connection string):
```bash
dotnet run --project apps/api --no-launch-profile --urls http://localhost:5210
```
Expected: it exits immediately with `System.InvalidOperationException: ConnectionStrings:Default is not configured. Set the ConnectionStrings__Default environment variable.`

- [ ] **Step 5: Restart the API normally** (Step 1 command) and leave it running for Task 12. No commit.

---

## Task 8: Web app scaffold

**Files:** Create `apps/web/package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/styles.css`, `src/test-setup.ts`.

- [ ] **Step 1: Create `apps/web/package.json`**

```json
{
  "name": "@hrpayroll/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^19.3.1",
    "react-dom": "^19.3.1",
    "react-router-dom": "^7.18.4"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.3.3",
    "@testing-library/dom": "^10.4.0",
    "@testing-library/jest-dom": "^7.0.1",
    "@testing-library/react": "^16.3.3",
    "@types/node": "^24.0.0",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "@vitejs/plugin-react": "^6.1.2",
    "jsdom": "^29.1.1",
    "tailwindcss": "^4.3.3",
    "typescript": "~5.9.3",
    "vite": "^8.3.4",
    "vitest": "^5.0.5"
  }
}
```

- [ ] **Step 2: Create `apps/web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vite/client", "vitest/globals"]
  },
  "include": ["src", "vite.config.ts"]
}
```

Tests are type-checked too (unlike TimeSheet, which excludes them).

- [ ] **Step 3: Create `apps/web/vite.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5273,
    strictPort: true,
    proxy: {
      // Forward /api/* to the ASP.NET Core dev server so the browser sees one origin.
      "/api": { target: "http://localhost:5210", changeOrigin: true },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
});
```

- [ ] **Step 4: Create `apps/web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>HR &amp; Payroll</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `apps/web/src/styles.css`**

```css
@import "tailwindcss";
```

- [ ] **Step 6: Create `apps/web/src/test-setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
```

- [ ] **Step 7: Install dependencies**

Run: `cd apps/web && npm install`
Expected: `added ~120 packages`, `found 0 vulnerabilities`, and **no** `EBADENGINE` warnings. This creates `package-lock.json`, which is committed.

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "chore(web): scaffold Vite, React, Tailwind and Vitest"
```

---

## Task 9: Typed API client

**Files:** Create `apps/web/src/api/client.test.ts`, `apps/web/src/api/client.ts`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/api/client.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiGet } from "./client";

function respond(body: BodyInit | null, init: ResponseInit) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, init)));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiGet", () => {
  it("returns the parsed JSON body on success", async () => {
    respond(JSON.stringify({ hello: "world" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    await expect(apiGet<{ hello: string }>("/api/thing")).resolves.toEqual({ hello: "world" });
    expect(fetch).toHaveBeenCalledWith(
      "/api/thing",
      expect.objectContaining({ headers: expect.objectContaining({ Accept: "application/json" }) }),
    );
  });

  it("throws an ApiError carrying the problem title, status and correlation id", async () => {
    respond(
      JSON.stringify({ title: "An unexpected error occurred.", status: 500, correlationId: "abc-123" }),
      { status: 500, headers: { "Content-Type": "application/problem+json" } },
    );

    const error = await apiGet("/api/thing").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 500,
      message: "An unexpected error occurred.",
      correlationId: "abc-123",
    });
  });

  it("throws a generic ApiError when the failure body is not JSON", async () => {
    respond("Bad gateway", { status: 502, headers: { "Content-Type": "text/plain" } });

    const error = await apiGet("/api/thing").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 502, message: "Request failed (502)" });
  });

  it("throws an ApiError with status 0 when the network request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const error = await apiGet("/api/thing").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 0, message: "Unable to reach the server." });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `apps/web`): `npx vitest run src/api/client.test.ts`
Expected: FAIL — `Failed to resolve import "./client" from "src/api/client.test.ts"`.

- [ ] **Step 3: Write the minimal implementation**

Create `apps/web/src/api/client.ts`:

```ts
/** Error thrown for any failed API call. `status` is 0 when the server could not be reached. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly correlationId?: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.includes("json")) {
    return undefined;
  }
  return response.json().catch(() => undefined);
}

function toApiError(response: Response, body: unknown): ApiError {
  const problem = isRecord(body) ? body : undefined;
  const message =
    typeof problem?.title === "string" ? problem.title : `Request failed (${response.status})`;
  const correlationId =
    typeof problem?.correlationId === "string"
      ? problem.correlationId
      : (response.headers.get("X-Correlation-ID") ?? undefined);

  return new ApiError(response.status, message, correlationId, body);
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { method: "GET", headers: { Accept: "application/json" }, signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw new ApiError(0, "Unable to reach the server.");
  }

  const body = await readJson(response);
  if (!response.ok) {
    throw toApiError(response, body);
  }
  return body as T;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/api/client.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  4 passed (4)`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api
git commit -m "feat(web): typed API client with problem-details errors"
```

---

## Task 10: Health call and status chip

**Files:** Create `apps/web/src/api/health.test.ts`, `apps/web/src/api/health.ts`, `apps/web/src/components/HealthChip.test.tsx`, `apps/web/src/components/HealthChip.tsx`.

- [ ] **Step 1: Write the failing health-call tests**

Create `apps/web/src/api/health.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { getHealth } from "./health";

function respond(body: unknown, status: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getHealth", () => {
  it("returns the body when the API and database are healthy", async () => {
    respond({ status: "ok", database: "ok" }, 200);

    await expect(getHealth()).resolves.toEqual({ status: "ok", database: "ok" });
  });

  it("returns the body for a degraded 503 instead of throwing", async () => {
    respond({ status: "degraded", database: "unreachable" }, 503);

    await expect(getHealth()).resolves.toEqual({ status: "degraded", database: "unreachable" });
  });

  it("throws for any other failure", async () => {
    respond({ title: "An unexpected error occurred.", status: 500 }, 500);

    await expect(getHealth()).rejects.toMatchObject({ status: 500 });
  });
});
```

- [ ] **Step 2: Write the failing chip tests**

Create `apps/web/src/components/HealthChip.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { getHealth } from "../api/health";
import { HealthChip } from "./HealthChip";

vi.mock("../api/health", () => ({ getHealth: vi.fn() }));

const getHealthMock = vi.mocked(getHealth);

beforeEach(() => {
  getHealthMock.mockReset();
});

describe("HealthChip", () => {
  it("shows a checking state while the request is pending", () => {
    getHealthMock.mockReturnValue(new Promise(() => {}));

    render(<HealthChip />);

    expect(screen.getByRole("status")).toHaveTextContent("Checking");
  });

  it("shows API and database OK when healthy", async () => {
    getHealthMock.mockResolvedValue({ status: "ok", database: "ok" });

    render(<HealthChip />);

    expect(await screen.findByText("API OK · Database OK")).toBeInTheDocument();
  });

  it("shows the database as unreachable when the API reports degraded", async () => {
    getHealthMock.mockResolvedValue({ status: "degraded", database: "unreachable" });

    render(<HealthChip />);

    expect(await screen.findByText("API OK · Database unreachable")).toBeInTheDocument();
  });

  it("shows the API as unreachable when the request fails", async () => {
    getHealthMock.mockRejectedValue(new ApiError(0, "Unable to reach the server."));

    render(<HealthChip />);

    expect(await screen.findByText("API unreachable")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run src/api/health.test.ts src/components/HealthChip.test.tsx`
Expected: both files FAIL with `Failed to resolve import "./health"` / `"./HealthChip"`.

- [ ] **Step 4: Implement the health call**

Create `apps/web/src/api/health.ts`:

```ts
import { ApiError, apiGet } from "./client";

export interface HealthResponse {
  status: "ok" | "degraded";
  database: "ok" | "unreachable";
}

function isHealthResponse(value: unknown): value is HealthResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    "database" in value
  );
}

/** The API answers 503 with a normal health body when the database is down; treat that as data, not an error. */
export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  try {
    return await apiGet<HealthResponse>("/api/health", signal);
  } catch (error) {
    if (error instanceof ApiError && error.status === 503 && isHealthResponse(error.body)) {
      return error.body;
    }
    throw error;
  }
}
```

- [ ] **Step 5: Implement the chip**

Create `apps/web/src/components/HealthChip.tsx`:

```tsx
import { useEffect, useState } from "react";
import { getHealth } from "../api/health";

type HealthState = "checking" | "ok" | "database-down" | "offline";

const LABELS: Record<HealthState, string> = {
  checking: "Checking…",
  ok: "API OK · Database OK",
  "database-down": "API OK · Database unreachable",
  offline: "API unreachable",
};

const DOT_COLOURS: Record<HealthState, string> = {
  checking: "bg-slate-400",
  ok: "bg-green-400",
  "database-down": "bg-amber-400",
  offline: "bg-red-500",
};

export function HealthChip() {
  const [state, setState] = useState<HealthState>("checking");

  useEffect(() => {
    const controller = new AbortController();

    getHealth(controller.signal)
      .then((health) => setState(health.database === "ok" ? "ok" : "database-down"))
      .catch(() => {
        if (!controller.signal.aborted) {
          setState("offline");
        }
      });

    return () => controller.abort();
  }, []);

  return (
    <span
      role="status"
      className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-300"
    >
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${DOT_COLOURS[state]}`} />
      {LABELS[state]}
    </span>
  );
}
```

- [ ] **Step 6: Run to verify they pass**

Run: `npx vitest run src/api src/components/HealthChip.test.tsx`
Expected: `Test Files  3 passed (3)`, `Tests  11 passed (11)` (4 client + 3 health + 4 chip).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): health call and API/database status chip"
```

---

## Task 11: Layout, pages and routing

**Files:** Create `apps/web/src/components/Layout.test.tsx`, `apps/web/src/App.test.tsx`, `apps/web/src/components/navItems.ts`, `apps/web/src/components/Layout.tsx`, `apps/web/src/pages/Home.tsx`, `apps/web/src/pages/NotFound.tsx`, `apps/web/src/App.tsx`, `apps/web/src/main.tsx`.

- [ ] **Step 1: Write the failing layout tests**

Create `apps/web/src/components/Layout.test.tsx`:

```tsx
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { Layout } from "./Layout";

vi.mock("./HealthChip", () => ({ HealthChip: () => <div>health chip</div> }));

function renderLayout() {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<p>page content</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("Layout", () => {
  it("shows the five module tabs in order, all disabled until their slice is built", () => {
    renderLayout();

    const nav = screen.getByRole("navigation", { name: "Main" });
    const tabs = within(nav).getAllByRole("button");

    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Worker Directory",
      "Daily Attendance",
      "Payroll Summary",
      "Leave Management",
      "User Manager",
    ]);
    tabs.forEach((tab) => expect(tab).toBeDisabled());
  });

  it("renders the routed page and the health chip", () => {
    renderLayout();

    expect(screen.getByText("page content")).toBeInTheDocument();
    expect(screen.getByText("health chip")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Write the failing app routing tests**

Create `apps/web/src/App.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import App from "./App";

vi.mock("./components/HealthChip", () => ({ HealthChip: () => <div>health chip</div> }));

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe("App", () => {
  it("shows the home page at the root", () => {
    renderAt("/");

    expect(screen.getByRole("heading", { name: "Foundation ready" })).toBeInTheDocument();
  });

  it("shows a not-found page for unknown routes", () => {
    renderAt("/nope");

    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run src/components/Layout.test.tsx src/App.test.tsx`
Expected: both FAIL with `Failed to resolve import "./Layout"` / `"./App"`.

- [ ] **Step 4: Implement the navigation list and layout**

Create `apps/web/src/components/navItems.ts`:

```ts
export interface NavItem {
  key: string;
  label: string;
}

/** The five prototype tabs, in prototype order. Each becomes a real route in its own slice. */
export const NAV_ITEMS: readonly NavItem[] = [
  { key: "workers", label: "Worker Directory" },
  { key: "attendance", label: "Daily Attendance" },
  { key: "payroll", label: "Payroll Summary" },
  { key: "leave", label: "Leave Management" },
  { key: "users", label: "User Manager" },
];
```

Create `apps/web/src/components/Layout.tsx`:

```tsx
import { Outlet } from "react-router-dom";
import { HealthChip } from "./HealthChip";
import { NAV_ITEMS } from "./navItems";

export function Layout() {
  return (
    <div className="flex min-h-screen flex-col bg-gray-100 text-gray-800">
      <header className="bg-slate-900 text-white shadow-md">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <h1 className="text-lg font-bold leading-tight">DE AKS BE GLASS &amp; ALUMINIUM CO. L.L.C S.O.C</h1>
            <p className="text-xs text-blue-300">Official HR &amp; Payroll System</p>
          </div>
          <HealthChip />
        </div>
      </header>

      <nav aria-label="Main" className="border-b border-slate-700 bg-slate-800 text-white shadow-sm">
        <div className="mx-auto flex w-full max-w-7xl overflow-x-auto px-4">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              disabled
              className="whitespace-nowrap border-b-2 border-transparent px-5 py-3 text-sm font-medium text-gray-400 disabled:cursor-not-allowed"
            >
              {item.label}
            </button>
          ))}
        </div>
      </nav>

      <main className="mx-auto w-full max-w-7xl flex-grow px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
```

The company name is a literal here for now; a later slice reads it from `PayrollSettings`.

- [ ] **Step 5: Implement the pages, app routes and entry point**

Create `apps/web/src/pages/Home.tsx`:

```tsx
export function Home() {
  return (
    <section>
      <h2 className="text-2xl font-bold text-gray-800">Foundation ready</h2>
      <p className="mt-1 text-sm text-gray-500">
        The API and database are wired up. Sign-in and the five modules arrive in the next slices.
      </p>
    </section>
  );
}
```

Create `apps/web/src/pages/NotFound.tsx`:

```tsx
export function NotFound() {
  return (
    <section>
      <h2 className="text-2xl font-bold text-gray-800">Page not found</h2>
      <p className="mt-1 text-sm text-gray-500">The page you asked for does not exist.</p>
    </section>
  );
}
```

Create `apps/web/src/App.tsx`:

```tsx
import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Home } from "./pages/Home";
import { NotFound } from "./pages/NotFound";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
```

Create `apps/web/src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
```

- [ ] **Step 6: Run the full web checks**

Run (from `apps/web`):
```bash
npm test
npm run lint
npm run build
```
Expected: `Test Files  5 passed (5)`, `Tests  15 passed (15)`; `tsc --noEmit` prints nothing; the build prints `✓ 31 modules transformed.` and writes `dist/` (ignored by git).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): application shell with module tabs, home and not-found pages"
```

---

## Task 12: End-to-end check, dev tooling and README

**Files:** Create `.claude/launch.json`.

- [ ] **Step 1: Create `.claude/launch.json`** (lets the desktop app start both servers for previews)

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "api",
      "runtimeExecutable": "dotnet",
      "runtimeArgs": ["run", "--project", "apps/api", "--launch-profile", "HrPayroll.Api"],
      "port": 5210
    },
    {
      "name": "web",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "dev"],
      "cwd": "apps/web",
      "port": 5273
    }
  ]
}
```

- [ ] **Step 2: Start both servers**

API (still running from Task 7, or `dotnet run --project apps/api --launch-profile HrPayroll.Api`) and, in `apps/web`: `npm run dev`.
Expected: Vite prints `Local: http://localhost:5273/`.

- [ ] **Step 3: Check the page in a browser**

Open http://localhost:5273.
Expected: a dark header with the company name and a green chip reading **API OK · Database OK**; below it a slate bar with five greyed-out tabs (Worker Directory, Daily Attendance, Payroll Summary, Leave Management, User Manager); the heading **Foundation ready**. The browser console shows no errors. Open http://localhost:5273/nope — the **Page not found** heading appears and the shell stays.

- [ ] **Step 4: Check the failure states**

Stop the API (Ctrl+C) and reload http://localhost:5273.
Expected: the chip reads **API unreachable** with a red dot. Restart the API, reload: back to green. (To see **Database unreachable**, stop the LocalDB instance with `sqllocaldb stop MSSQLLocalDB -i` while the API is running, reload, then `sqllocaldb start MSSQLLocalDB`.)

- [ ] **Step 5: Stop both servers and confirm the working tree is clean of build output**

Run: `git status --short`
Expected: only `.claude/launch.json` is listed. `bin/`, `obj/`, `node_modules/`, `dist/` and `logs/` must not appear.

- [ ] **Step 6: Commit**

```bash
git add .claude/launch.json
git commit -m "chore: dev server launch configuration"
```

---

## Task 13: Slice verification and hand-off

- [ ] **Step 1: Full clean verification from scratch**

Run (repo root):
```bash
git clean -fdx -e .claude -n
```
Review the dry-run list (build output only), then run it without `-n`, then:
```bash
dotnet build
dotnet test
cd apps/web && npm ci && npm test && npm run lint && npm run build
```
Expected: build `0 Warning(s) 0 Error(s)`; `Passed: 18`; web `Tests  15 passed (15)`; lint and build clean.

- [ ] **Step 2: Check each Definition-of-Done item from the master plan**

- [ ] Tests were written first and seen failing (Tasks 3, 4, 5, 6, 9, 10, 11)
- [ ] Endpoint role/anonymous tests: not applicable yet — the only endpoint is intentionally anonymous (deviation 7); S1 adds the policy tests
- [ ] The migration applies to an empty database (`MigrationTests`) and to the dev database (Task 7)
- [ ] Browser walkthrough done; console free of errors (Task 12)
- [ ] No secrets committed: `git grep -n -i "password" -- ':!*.md' ':!*.example'` returns nothing but test/config key names; `appsettings.Development.json` holds only a Windows-authentication LocalDB string
- [ ] No stack traces in responses (`ExceptionHandlingMiddlewareTests`) and nothing sensitive in logs

- [ ] **Step 3: Review the branch**

Run: `git log --oneline master..HEAD`
Expected: ten commits (`chore: scaffold…` through `chore: dev server launch configuration`; Task 1's commit is on `master`, Task 7 makes none), each building and testing green on its own.

- [ ] **Step 4: Hand off**

Push and merge are the repository owner's call; do not push without being asked. When asked: `git push -u origin slice/s0-walking-skeleton`, open a pull request into `master`, merge with a merge commit, and keep the branch.

---

## What S0 deliberately does not do

- No authentication or `[Authorize]` yet (S1). `GET /api/health` is the only endpoint and is anonymous by design.
- No tables. The first real migration arrives with `Users` and `AuditLogs` in S1.
- No HTTPS redirect, HSTS, CORS or security headers (S8).
- The navigation tabs are inert placeholders; the company name and tagline are literals until `PayrollSettings` exists (S2).
- No CI pipeline. Add one in S8 if the deployment owner wants it.

## Self-review

**Master-plan coverage (S0 task list):** solution and three projects → Tasks 2, 8 · `AppDbContext`, env-var connection string, first migration → Tasks 5, 6 · health endpoint, Serilog, correlation id, exception handling → Tasks 3, 4, 6 · web `Layout` with five disabled nav items, typed client, health chip → Tasks 9–11 · health integration test against real SQL Server, one Vitest render test (delivered as 15) → Tasks 5, 6, 9–11 · `.gitignore`, `.editorconfig`, README, `.env.example` → Task 1.

**Placeholder scan:** none; every code step contains the full file.

**Name consistency:** `CorrelationIdMiddleware.HeaderName` is used by the exception middleware, the tests and the API factory; `HealthResponse` (C#) ↔ `HealthResponse` (TypeScript) both carry `status` and `database` with the values `ok`/`degraded` and `ok`/`unreachable`; `TestDatabase.ConnectionString` feeds `ApiFactory` and `MigrationTests`; ports 5210/5273 agree across `launchSettings.json`, `vite.config.ts`, `.claude/launch.json` and the README.
