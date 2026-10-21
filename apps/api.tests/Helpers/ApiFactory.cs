using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace HrPayroll.Api.Tests.Helpers;

/// <summary>
/// Boots the real API in-process against the given SQL Server connection string.
/// <paramref name="configOverrides"/> are applied last, so a test can change or remove (null value) any setting,
/// including the test <c>Jwt:Key</c>.
/// </summary>
public sealed class ApiFactory(
    string connectionString,
    IReadOnlyDictionary<string, string?>? configOverrides = null) : WebApplicationFactory<Program>
{
    /// <summary>Signing key used by every test host (32+ characters, never used outside tests).</summary>
    public const string TestJwtKey = "test-only-signing-key-0123456789-abcdefghij";

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        // "Testing" keeps appsettings.Development.json (dev database, migrate-on-startup, dev key) out of the run.
        builder.UseEnvironment("Testing");
        builder.ConfigureAppConfiguration((_, configuration) =>
        {
            var values = new Dictionary<string, string?>
            {
                ["ConnectionStrings:Default"] = connectionString,
                ["Observability:WriteToFile"] = "false",
                ["Jwt:Key"] = TestJwtKey,
            };

            if (configOverrides is not null)
            {
                foreach (var (key, value) in configOverrides)
                {
                    values[key] = value;
                }
            }

            configuration.AddInMemoryCollection(values);
        });

        // The probe controller lives in the test assembly; register it so the role matrix can be tested
        // before real endpoints exist.
        builder.ConfigureTestServices(services =>
            services.AddControllers().AddApplicationPart(typeof(ProbeController).Assembly));
    }
}
