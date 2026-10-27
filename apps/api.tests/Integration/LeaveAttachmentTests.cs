using System.Net;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

public sealed class LeaveAttachmentTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01];

    private Task<HttpResponseMessage> Create(int worker, string token, string? photo, string start) =>
        api.PostAsync("/api/leave", new { workerId = worker, leaveType = "Sick Leave", startDate = start, endDate = start, attachmentBase64 = photo }, token);

    [Fact]
    public async Task Photo_is_stored_flagged_in_the_list_and_downloadable()
    {
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var created = await Create(worker.Id, token, Convert.ToBase64String(Jpeg), "2031-03-03");
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var body = await TestWorkers.ReadJsonAsync(created);
        Assert.True(body.GetProperty("hasAttachment").GetBoolean());
        var id = body.GetProperty("id").GetInt32();

        var list = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/leave?workerId={worker.Id}", token));
        Assert.True(Assert.Single(list.EnumerateArray()).GetProperty("hasAttachment").GetBoolean());

        var download = await api.GetAsync($"/api/leave/{id}/attachment", token);
        Assert.Equal(HttpStatusCode.OK, download.StatusCode);
        Assert.Equal("image/jpeg", download.Content.Headers.ContentType!.MediaType);
        Assert.Equal(Jpeg, await download.Content.ReadAsByteArrayAsync());

        Assert.Equal(HttpStatusCode.NoContent, (await api.SendAsync(HttpMethod.Delete, $"/api/leave/{id}", token: token)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await api.GetAsync($"/api/leave/{id}/attachment", token)).StatusCode);
    }

    [Fact]
    public async Task Request_without_photo_has_no_attachment_and_bad_photos_are_rejected()
    {
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var plain = await Create(worker.Id, token, null, "2031-04-04");
        Assert.Equal(HttpStatusCode.Created, plain.StatusCode);
        var body = await TestWorkers.ReadJsonAsync(plain);
        Assert.False(body.GetProperty("hasAttachment").GetBoolean());
        Assert.Equal(HttpStatusCode.NotFound, (await api.GetAsync($"/api/leave/{body.GetProperty("id").GetInt32()}/attachment", token)).StatusCode);

        Assert.Equal(HttpStatusCode.BadRequest, (await Create(worker.Id, token, "not base64!", "2031-05-05")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Create(worker.Id, token, Convert.ToBase64String("<html>"u8.ToArray()), "2031-05-05")).StatusCode);
    }
}
