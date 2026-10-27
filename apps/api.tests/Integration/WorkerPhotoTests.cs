using System.Net;
using System.Text;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Tests.Helpers;

namespace HrPayroll.Api.Tests.Integration;

public sealed class WorkerPhotoTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    // A valid 1x1 JPEG; enough for the PDF writer to read its dimensions and embed it.
    private static readonly byte[] Jpeg = Convert.FromBase64String(
        "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=");

    private static object Body(string code, string? photo = null, bool? remove = null) => new
    {
        workerCode = code, fullName = "Photo Tester", designation = "Glazier", hourlyRate = 9.5m,
        photoBase64 = photo, removePhoto = remove,
    };

    /// <summary>Images embedded in the PDF: the company logo is always one, so a worker photo makes two.</summary>
    private static async Task<int> PdfImages(HttpResponseMessage pdf) =>
        System.Text.RegularExpressions.Regex.Matches(Encoding.Latin1.GetString(await pdf.Content.ReadAsByteArrayAsync()), @"/Subtype\s*/Image").Count;

    [Fact]
    public async Task Photo_is_stored_served_printed_in_the_pdf_and_can_be_removed()
    {
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var created = await api.SendAsync(HttpMethod.Post, "/api/workers", Body(TestWorkers.UniqueCode(), Convert.ToBase64String(Jpeg)), token);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var json = await TestWorkers.ReadJsonAsync(created);
        Assert.True(json.GetProperty("hasPhoto").GetBoolean());
        var id = json.GetProperty("id").GetInt32();

        var photo = await api.GetAsync($"/api/workers/{id}/photo", token);
        Assert.Equal(HttpStatusCode.OK, photo.StatusCode);
        Assert.Equal("image/jpeg", photo.Content.Headers.ContentType!.MediaType);
        Assert.Equal(Jpeg, await photo.Content.ReadAsByteArrayAsync());

        var list = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/workers", token));
        Assert.Contains(list.EnumerateArray(), w => w.GetProperty("id").GetInt32() == id && w.GetProperty("hasPhoto").GetBoolean());

        var withPhoto = await PdfImages(await api.GetAsync($"/api/workers/{id}/profile/pdf", token));

        // An update without a photo field keeps it; RemovePhoto clears it and the PDF loses the image.
        var kept = await api.SendAsync(HttpMethod.Put, $"/api/workers/{id}", Body((await TestWorkers.ReadJsonAsync(created)).GetProperty("workerCode").GetString()!), token);
        Assert.True((await TestWorkers.ReadJsonAsync(kept)).GetProperty("hasPhoto").GetBoolean());
        var removed = await api.SendAsync(HttpMethod.Put, $"/api/workers/{id}", Body(json.GetProperty("workerCode").GetString()!, remove: true), token);
        Assert.False((await TestWorkers.ReadJsonAsync(removed)).GetProperty("hasPhoto").GetBoolean());
        Assert.Equal(HttpStatusCode.NotFound, (await api.GetAsync($"/api/workers/{id}/photo", token)).StatusCode);
        Assert.Equal(withPhoto - 1, await PdfImages(await api.GetAsync($"/api/workers/{id}/profile/pdf", token)));
    }

    [Fact]
    public async Task Non_jpeg_photo_is_rejected()
    {
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Manager);
        var response = await api.SendAsync(HttpMethod.Post, "/api/workers", Body(TestWorkers.UniqueCode(), Convert.ToBase64String("<html>"u8.ToArray())), token);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
