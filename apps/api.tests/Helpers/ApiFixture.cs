using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace HrPayroll.Api.Tests.Helpers;

/// <summary>
/// One throw-away database and one API host shared by all tests in a class. Tests stay independent
/// by creating their own uniquely named users.
/// </summary>
public class ApiFixture : IAsyncLifetime
{
    private readonly TestDatabase _database = new();
    private ApiFactory? _factory;
    private WebApplicationFactory<Program>? _derived;

    /// <summary>A fixture subclass adds settings here (for example push keys) before the host starts.</summary>
    protected virtual IReadOnlyDictionary<string, string?> ExtraConfig => new Dictionary<string, string?>();

    /// <summary>A fixture subclass replaces services here (for example a recording push sender).</summary>
    protected virtual void ConfigureTestServices(IServiceCollection services) { }

    public string ConnectionString => _database.ConnectionString;
    public HttpClient Client { get; private set; } = null!;

    public async Task InitializeAsync()
    {
        await _database.InitializeAsync();
        // The shared host sees far more sign-ins than one real client would in a minute, so the per-IP login
        // limit is raised well out of the way; LoginRateLimitTests covers the limiter itself.
        var config = new Dictionary<string, string?> { ["RateLimiting:LoginPerMinute"] = "100000" };
        foreach (var (key, value) in ExtraConfig) config[key] = value;
        _factory = new ApiFactory(_database.ConnectionString, config);
        _derived = _factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(ConfigureTestServices));
        Client = _derived.CreateClient();
    }

    public async Task DisposeAsync()
    {
        Client.Dispose();
        if (_derived is not null) await _derived.DisposeAsync();
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

    /// <summary>Sends any verb; <paramref name="body"/> (when given) is serialised as JSON.</summary>
    public Task<HttpResponseMessage> SendAsync(HttpMethod method, string path, object? body = null, string? token = null)
    {
        var request = new HttpRequestMessage(method, path);
        if (body is not null)
        {
            request.Content = JsonContent.Create(body);
        }

        if (token is not null)
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }

        return Client.SendAsync(request);
    }

    /// <summary>Sends a hand-written JSON body, for cases an anonymous object cannot express (missing or odd fields).</summary>
    public Task<HttpResponseMessage> SendJsonAsync(HttpMethod method, string path, string json, string? token = null)
    {
        var request = new HttpRequestMessage(method, path)
        {
            Content = new StringContent(json, System.Text.Encoding.UTF8, "application/json"),
        };
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
