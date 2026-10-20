using System.Net.Http.Headers;
using System.Net.Http.Json;

namespace HrPayroll.Api.Tests.Helpers;

/// <summary>
/// One throw-away database and one API host shared by all tests in a class. Tests stay independent
/// by creating their own uniquely named users.
/// </summary>
public sealed class ApiFixture : IAsyncLifetime
{
    private readonly TestDatabase _database = new();
    private ApiFactory? _factory;

    public string ConnectionString => _database.ConnectionString;
    public HttpClient Client { get; private set; } = null!;

    public async Task InitializeAsync()
    {
        await _database.InitializeAsync();
        // The shared host sees far more sign-ins than one real client would in a minute, so the per-IP login
        // limit is raised well out of the way; LoginRateLimitTests covers the limiter itself.
        _factory = new ApiFactory(
            _database.ConnectionString,
            new Dictionary<string, string?> { ["RateLimiting:LoginPerMinute"] = "100000" });
        Client = _factory.CreateClient();
    }

    public async Task DisposeAsync()
    {
        Client.Dispose();
        if (_factory is not null)
        {
            await _factory.DisposeAsync();
        }

        await _database.DisposeAsync();
    }

    public Task<HttpResponseMessage> PostAsync(string path, object body, string? token = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = JsonContent.Create(body) };
        if (token is not null)
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }

        return Client.SendAsync(request);
    }

    public Task<HttpResponseMessage> GetAsync(string path, string? token = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, path);
        if (token is not null)
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }

        return Client.SendAsync(request);
    }
}
