using System.Security.Cryptography;

namespace HrPayroll.Api.Services.Finance;

/// <summary>Where receipt files live. Only the folder is known to this class; the database keeps names and details.</summary>
public interface IReceiptStore
{
    /// <summary>Writes the file under a new random name and returns that name.</summary>
    Task<string> SaveAsync(byte[] content, string extension, CancellationToken ct);
    Stream? Open(string storedName);
    void Delete(string storedName);
}

public sealed class FolderReceiptStore(IConfiguration configuration, IWebHostEnvironment environment) : IReceiptStore
{
    private readonly string _root = Path.GetFullPath(
        configuration["Finance:ReceiptsPath"] is { Length: > 0 } path ? path : Path.Combine(environment.ContentRootPath, "App_Data", "receipts"));

    // Stored names are 32 hex characters plus a fixed extension, so a name can never point outside the folder.
    private string? PathFor(string storedName) =>
        storedName.Length is > 4 and <= 40 && storedName.All(c => char.IsAsciiLetterOrDigit(c) || c == '.') && !storedName.Contains("..")
            ? Path.Combine(_root, storedName) : null;

    public async Task<string> SaveAsync(byte[] content, string extension, CancellationToken ct)
    {
        Directory.CreateDirectory(_root);
        var name = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant() + extension;
        await File.WriteAllBytesAsync(PathFor(name)!, content, ct);
        return name;
    }

    public Stream? Open(string storedName) =>
        PathFor(storedName) is { } path && File.Exists(path) ? new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read) : null;

    public void Delete(string storedName)
    {
        if (PathFor(storedName) is { } path && File.Exists(path)) File.Delete(path);
    }
}

/// <summary>Accepts PDF, JPEG and PNG up to 5 MB, judged by the file's own first bytes, never by its name or the browser's claim.</summary>
public static class ReceiptFile
{
    public const int MaxBytes = 5 * 1024 * 1024;
    public const int MaxFiles = 5;

    public static (string ContentType, string Extension)? Detect(byte[] b)
    {
        if (b.Length >= 5 && b[0] == 0x25 && b[1] == 0x50 && b[2] == 0x44 && b[3] == 0x46 && b[4] == 0x2D) return ("application/pdf", ".pdf");
        if (b.Length >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF) return ("image/jpeg", ".jpg");
        if (b.Length >= 8 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47 && b[4] == 0x0D && b[5] == 0x0A && b[6] == 0x1A && b[7] == 0x0A) return ("image/png", ".png");
        return null;
    }

    public static string CleanName(string? name, string extension)
    {
        // Windows paths use "\\", Linux only "/": treat both as separators so the result is the same on every host.
        var file = Path.GetFileName((name ?? "").Replace('\\', '/'));
        var cleaned = new string(file.Where(c => !char.IsControl(c) && c is not ('<' or '>' or '"' or '|' or '?' or '*' or ':' or '\\' or '/')).ToArray()).Trim();
        if (cleaned.Length == 0) cleaned = "receipt" + extension;
        return cleaned.Length > 120 ? cleaned[..120] : cleaned;
    }
}
