using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

public class JwtKeyStartupTests(TestDatabase database) : IClassFixture<TestDatabase>
{
    // The key check runs before the database is touched, so this connection string never has to work.
    private const string UnusedConnection = "Server=(localdb)\\MSSQLLocalDB;Database=HrPayroll_NeverCreated;Integrated Security=true;TrustServerCertificate=True;Connect Timeout=1";

    /// <summary>WebApplicationFactory may wrap what Program throws, so look through the whole chain.</summary>
    private static InvalidOperationException FindStartupFailure(Exception exception)
    {
        for (var current = exception; current is not null; current = current.InnerException)
        {
            if (current is InvalidOperationException invalid && invalid.Message.Contains("Jwt:Key", StringComparison.Ordinal))
            {
                return invalid;
            }
        }

        throw new Xunit.Sdk.XunitException($"No Jwt:Key startup failure found. Got: {exception}");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("short-key")]
    [InlineData("0123456789012345678901234567890")] // 31 characters
    public async Task Startup_WithMissingOrShortJwtKey_Fails(string? key)
    {
        await using var factory = new ApiFactory(
            UnusedConnection, new Dictionary<string, string?> { ["Jwt:Key"] = key });

        var exception = Record.Exception(() => factory.CreateClient());

        Assert.NotNull(exception);
        var failure = FindStartupFailure(exception!);
        Assert.Contains("32", failure.Message);
    }

    [Fact]
    public async Task Startup_WithA32CharacterKey_Succeeds()
    {
        await using var factory = new ApiFactory(
            database.ConnectionString, new Dictionary<string, string?> { ["Jwt:Key"] = "01234567890123456789012345678901" });

        using var client = factory.CreateClient();
        var response = await client.GetAsync("/api/health");

        Assert.True(response.IsSuccessStatusCode);
    }
}
