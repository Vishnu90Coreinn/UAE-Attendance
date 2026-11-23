using System.Collections.Concurrent;
using System.Net;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Services.Push;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>Records what would have been pushed instead of calling a browser vendor's push service.</summary>
public sealed class RecordingPushSender : IPushSender
{
    public static readonly ConcurrentQueue<(string Endpoint, PushMessage Message)> Sent = new();
    public bool IsConfigured => true;
    public void Send(PushDevice device, PushMessage message) => Sent.Enqueue((device.Endpoint, message));
}

public sealed class PushApiFixture : ApiFixture
{
    protected override IReadOnlyDictionary<string, string?> ExtraConfig => new Dictionary<string, string?>
    {
        ["Push:PublicKey"] = "test-public-key", ["Push:PrivateKey"] = "test-private-key", ["Push:Subject"] = "mailto:test@example.com",
    };

    protected override void ConfigureTestServices(IServiceCollection services) =>
        services.Replace(ServiceDescriptor.Singleton<IPushSender, RecordingPushSender>());
}

public class PushNotificationTests(PushApiFixture api) : IClassFixture<PushApiFixture>
{
    private static object Subscription(string endpoint) => new { endpoint, keys = new { p256dh = "BPublicKeyData", auth = "AuthData" } };

    private async Task<(User User, string Token, string Endpoint)> SubscribedAsync(string role)
    {
        var user = await TestUsers.CreateAsync(api.ConnectionString, role: role);
        var token = await TestUsers.LoginAsync(api.Client, user.Username);
        var endpoint = $"https://push.example.com/{Guid.NewGuid():N}";
        Assert.Equal(HttpStatusCode.NoContent, (await api.SendAsync(HttpMethod.Post, "/api/push/subscribe", Subscription(endpoint), token)).StatusCode);
        return (user, token, endpoint);
    }

    private static List<PushMessage> SentTo(string endpoint) => RecordingPushSender.Sent.Where(s => s.Endpoint == endpoint).Select(s => s.Message).ToList();

    [Fact]
    public async Task Subscribe_NeedsSignIn_ValidatesTheSubscription_AndUnsubscribeRemovesIt()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await api.Client.GetAsync("/api/push/config")).StatusCode);
        var (user, token, endpoint) = await SubscribedAsync(Roles.Employee);

        var config = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/push/config", token));
        Assert.True(config.GetProperty("enabled").GetBoolean());
        Assert.Equal("test-public-key", config.GetProperty("publicKey").GetString());

        Assert.Equal(HttpStatusCode.BadRequest, (await api.SendAsync(HttpMethod.Post, "/api/push/subscribe", Subscription("http://not-https.example.com/x"), token)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await api.SendAsync(HttpMethod.Post, "/api/push/subscribe", new { endpoint = "https://push.example.com/x" }, token)).StatusCode);

        // The same phone signing in as someone else takes the subscription over rather than duplicating it.
        var other = await TestUsers.CreateAsync(api.ConnectionString, role: Roles.Supervisor);
        var otherToken = await TestUsers.LoginAsync(api.Client, other.Username);
        Assert.Equal(HttpStatusCode.NoContent, (await api.SendAsync(HttpMethod.Post, "/api/push/subscribe", Subscription(endpoint), otherToken)).StatusCode);
        await using (var db = TestUsers.NewContext(api.ConnectionString))
            Assert.Equal(other.Id, (await db.PushDevices.SingleAsync(d => d.Endpoint == endpoint)).UserId);

        // Only the owner can remove it.
        await api.SendAsync(HttpMethod.Post, "/api/push/unsubscribe", new { endpoint }, token);
        await using (var db = TestUsers.NewContext(api.ConnectionString)) Assert.True(await db.PushDevices.AnyAsync(d => d.Endpoint == endpoint));
        await api.SendAsync(HttpMethod.Post, "/api/push/unsubscribe", new { endpoint }, otherToken);
        await using (var db = TestUsers.NewContext(api.ConnectionString)) Assert.False(await db.PushDevices.AnyAsync(d => d.Endpoint == endpoint));
        _ = user;
    }

    [Fact]
    public async Task OfficeLeave_NotifiesApprovers_ThenTheEmployee_AndNobodyElse()
    {
        var manager = await SubscribedAsync(Roles.Manager);
        var admin = await SubscribedAsync(Roles.Administrator);
        var hr = await SubscribedAsync(Roles.HR);
        var supervisor = await SubscribedAsync(Roles.Supervisor);
        var employee = await SubscribedAsync(Roles.Employee);
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, fullName: "Push Person");
        await using (var db = TestUsers.NewContext(api.ConnectionString))
        {
            var row = await db.Workers.SingleAsync(w => w.Id == worker.Id);
            row.Category = WorkerCategories.Employee;
            row.UserId = employee.User.Id;
            row.JoinDate = new DateOnly(2020, 1, 1);
            await db.SaveChangesAsync();
        }

        var mine = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/staff/me/leave", employee.Token));
        var typeId = mine.GetProperty("types")[0].GetProperty("id").GetInt32();
        var day = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(90));
        while (day.DayOfWeek == DayOfWeek.Sunday) day = day.AddDays(1);
        var created = await api.SendAsync(HttpMethod.Post, "/api/staff/me/leave",
            new { leaveTypeId = typeId, startDate = day.ToString("yyyy-MM-dd"), endDate = day.ToString("yyyy-MM-dd"), reason = "Appointment" }, employee.Token);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var id = (await TestWorkers.ReadJsonAsync(created)).GetProperty("id").GetInt32();

        Assert.Equal("New leave request", Assert.Single(SentTo(manager.Endpoint)).Title);
        Assert.Equal("/staff-leave", SentTo(manager.Endpoint)[0].Url);
        Assert.Single(SentTo(admin.Endpoint));
        Assert.Empty(SentTo(hr.Endpoint));
        Assert.Empty(SentTo(supervisor.Endpoint));
        Assert.Empty(SentTo(employee.Endpoint));

        var decider = await TestUsers.LoginAsync(api.Client, manager.User.Username);
        Assert.Equal(HttpStatusCode.OK, (await api.SendAsync(HttpMethod.Post, $"/api/staff/leave/{id}/reject", new { note = "Busy week" }, decider)).StatusCode);
        var told = Assert.Single(SentTo(employee.Endpoint));
        Assert.Equal("Leave rejected", told.Title);
        Assert.Contains("Busy week", told.Body);
        Assert.Equal("/my-leave", told.Url);
        Assert.Single(SentTo(manager.Endpoint)); // deciding does not notify the manager again
    }

    [Fact]
    public async Task SupervisorSubmittingAttendance_NotifiesManagers_ButAManagersOwnSaveDoesNot()
    {
        var manager = await SubscribedAsync(Roles.Manager);
        var hr = await SubscribedAsync(Roles.HR);
        var supervisor = await SubscribedAsync(Roles.Supervisor);
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        var rows = new[] { new { workerId = worker.Id, status = "Present", basicHours = 8m, overtimeHours = 0m } };

        Assert.Equal(HttpStatusCode.OK, (await api.SendAsync(HttpMethod.Put, "/api/attendance/2025-03-12", rows, supervisor.Token)).StatusCode);
        var told = Assert.Single(SentTo(manager.Endpoint));
        Assert.Equal("Attendance submitted", told.Title);
        Assert.Contains("2025-03-12", told.Body);
        Assert.Equal("/attendance", told.Url);
        Assert.Empty(SentTo(hr.Endpoint));
        Assert.Empty(SentTo(supervisor.Endpoint)); // submitting does not notify the submitter

        // Saving the same values again changes nothing, so nobody is bothered twice.
        await api.SendAsync(HttpMethod.Put, "/api/attendance/2025-03-12", rows, supervisor.Token);
        Assert.Single(SentTo(manager.Endpoint));

        // Rejecting sends the reason back to the supervisor who submitted it, and only to them.
        var managerLogin = await TestUsers.LoginAsync(api.Client, manager.User.Username);
        Assert.Equal(HttpStatusCode.OK, (await api.SendAsync(HttpMethod.Post, "/api/attendance/2025-03-12/reject", new { workerIds = new[] { worker.Id }, reason = "Wrong hours" }, managerLogin)).StatusCode);
        var sentBack = Assert.Single(SentTo(supervisor.Endpoint));
        Assert.Equal("Attendance sent back", sentBack.Title);
        Assert.Contains("Wrong hours", sentBack.Body);
        Assert.Equal("/attendance", sentBack.Url);
        Assert.Single(SentTo(manager.Endpoint));

        // A manager's own edit is approved at once: nothing to notify.
        var other = await TestWorkers.CreateAsync(api.ConnectionString);
        var managerToken = await TestUsers.LoginAsync(api.Client, manager.User.Username);
        await api.SendAsync(HttpMethod.Put, "/api/attendance/2025-03-12", new[] { new { workerId = other.Id, status = "Present", basicHours = 8m, overtimeHours = 0m } }, managerToken);
        Assert.Single(SentTo(manager.Endpoint));
    }
}
