namespace HrPayroll.Api.Services;

/// <summary>Validation of a photo sent as base64 JSON. Only JPEG is accepted: the browser re-encodes every photo to JPEG before upload.</summary>
public static class PhotoUpload
{
    public const int MaxBytes = 3 * 1024 * 1024;

    /// <summary>True when <paramref name="base64"/> is empty (no photo, <paramref name="data"/> null) or a JPEG of at most 3 MB.</summary>
    public static bool TryDecode(string? base64, out byte[]? data)
    {
        data = null;
        if (string.IsNullOrEmpty(base64)) return true;
        if (base64.Length > MaxBytes * 4 / 3 + 8) return false;
        var buffer = new byte[base64.Length * 3 / 4 + 3];
        if (!Convert.TryFromBase64String(base64, buffer, out var written) || written < 3 || written > MaxBytes) return false;
        if (buffer[0] != 0xFF || buffer[1] != 0xD8 || buffer[2] != 0xFF) return false;
        data = buffer[..written];
        return true;
    }
}
