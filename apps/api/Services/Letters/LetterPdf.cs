using System.Globalization;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using UglyToad.PdfPig.Content;
using UglyToad.PdfPig.Writer;

namespace HrPayroll.Api.Services;

/// <summary>One A4 certificate or letter, built only from the stored content of an issued letter plus the current artwork.</summary>
public sealed class LetterPdf
{
    private const double Left = 56;
    private const double Right = 539;
    private const double BodySize = 10.5;
    private const double Leading = 15;

    public byte[] Generate(LetterContent content, DocumentSettings settings)
    {
        foreach (var text in Printed(content)) PdfText.EnsurePrintable(text);
        try
        {
            using var document = new PdfDocumentBuilder();
            var regular = document.AddTrueTypeFont(PdfText.Font("Regular"));
            var bold = document.AddTrueTypeFont(PdfText.Font("Bold"));
            var page = document.AddPage(PageSize.A4);
            Draw(new PdfCanvas(page, regular, bold), content, settings);
            return document.Build();
        }
        catch (InvalidOperationException ex) when (ex.Message.StartsWith("The font does not contain a character:", StringComparison.Ordinal))
        {
            throw new PdfTextNotSupportedException(ex);
        }
    }

    private static IEnumerable<string> Printed(LetterContent c)
    {
        yield return c.AddressedTo; yield return c.CompanyName; yield return c.Address1; yield return c.Address2; yield return c.Mobile;
        yield return c.Email; yield return c.PurposeNote; yield return c.SignerName; yield return c.SignerTitle; yield return c.RefNo;
        foreach (var run in c.Paragraphs.SelectMany(p => p)) yield return run.Text;
    }

    private static void Draw(PdfCanvas cv, LetterContent c, DocumentSettings settings)
    {
        // Letterhead: company name and contact details on the left, optional logo on the right.
        var y = 800.0;
        foreach (var line in cv.Wrap(c.CompanyName.ToUpperInvariant(), 340, 12.5, true))
        {
            cv.Text(line, Left, y, 12.5, true, PdfStyle.Teal);
            y -= 15;
        }
        y -= 2;
        foreach (var line in new[] { JoinNonEmpty(", ", c.Address1, c.Address2), JoinNonEmpty("  |  ", string.IsNullOrWhiteSpace(c.Mobile) ? "" : "Mobile: " + c.Mobile, string.IsNullOrWhiteSpace(c.Email) ? "" : "Email: " + c.Email) })
        {
            if (line.Length == 0) continue;
            cv.Text(cv.Fit(line, 380, 8.5), Left, y, 8.5, false, PdfStyle.Muted);
            y -= 11;
        }
        if (settings.Logo is { Length: > 0 }) DrawImage(cv, settings.Logo, settings.LogoContentType, Right - 90, 760, 90, 50);
        y = Math.Min(y, 770) - 6;
        cv.Rule(Left, Right, y, 1.6, PdfStyle.Ink);

        // Reference and date.
        y -= 24;
        cv.Text("Ref No: " + (c.RefNo.Length > 0 ? c.RefNo : "(assigned on issue)"), Left, y, 9.5, true);
        cv.RightText("Date: " + c.IssueDate.ToString("dd MMM yyyy", CultureInfo.InvariantCulture), Right, y, 9.5, true);
        y -= 8;
        cv.Rule(Left, Right, y, 0.4, PdfStyle.Hairline);

        // Addressee and title.
        y -= 26;
        cv.Text("To:", Left, y, 8, true, PdfStyle.Muted);
        y -= 14;
        foreach (var line in cv.Wrap(c.AddressedTo, Right - Left, 11, true))
        {
            cv.Text(line, Left, y, 11, true);
            y -= 14;
        }
        y -= 14;
        var titleWidth = cv.Width(c.Title, 14, true);
        cv.Text(c.Title, (Left + Right - titleWidth) / 2, y, 14, true, PdfStyle.Teal);
        cv.Rule((Left + Right - titleWidth) / 2, (Left + Right + titleWidth) / 2, y - 5, 1.2, PdfStyle.Amber);
        y -= 30;

        // Body paragraphs.
        foreach (var paragraph in c.Paragraphs)
        {
            y = Runs(cv, paragraph, Left, y, Right - Left);
            y -= 9;
        }

        if (c.Salary is { } s)
        {
            y -= 2;
            var rows = new[]
            {
                ("Basic Monthly Salary", s.Basic), ("Housing Allowance", s.Housing),
                ("Transportation Allowance", s.Transport), ("Other Fixed Allowances", s.Other),
            };
            cv.Fill(Left, y - 20, Right - Left, 20, PdfStyle.Panel);
            cv.Text("SALARY COMPONENT", Left + 8, y - 14, 8, true);
            cv.RightText("AMOUNT (AED)", Right - 8, y - 14, 8, true);
            y -= 20;
            foreach (var (label, amount) in rows)
            {
                cv.Text(label, Left + 8, y - 15, 9.5);
                cv.RightText(PdfText.Number(amount), Right - 8, y - 15, 9.5);
                y -= 22;
                cv.Rule(Left, Right, y, 0.4, PdfStyle.Hairline);
            }
            cv.Fill(Left, y - 22, Right - Left, 22, PdfStyle.Panel);
            cv.Text("TOTAL GROSS MONTHLY SALARY", Left + 8, y - 15, 9.5, true);
            cv.RightText(PdfText.Number(s.Total) + " AED", Right - 8, y - 15, 10.5, true);
            cv.Rule(Left, Right, y - 22, 0.8, PdfStyle.Teal);
            y -= 22 + 16;
        }

        // Purpose note.
        var noteLines = cv.Wrap(c.PurposeNote, Right - Left - 24, 9);
        var noteHeight = noteLines.Count * 12 + 14;
        cv.Fill(Left, y - noteHeight, Right - Left, noteHeight, PdfStyle.Stripe);
        cv.VRule(Left + 1, y - noteHeight, y, 2, PdfStyle.Muted);
        for (var i = 0; i < noteLines.Count; i++) cv.Text(noteLines[i], Left + 12, y - 16 - i * 12, 9, false, PdfStyle.Muted);
        y -= noteHeight + 30;

        // Authorisation, signature and seal.
        cv.Text("For " + c.CompanyName.ToUpperInvariant(), Left, y, 9.5, true);
        y -= 8;
        var signatureTop = y;
        if (c.ShowSeal && settings.Signature is { Length: > 0 }) DrawImage(cv, settings.Signature, settings.SignatureContentType, Left, y - 52, 130, 46);
        y -= 66;
        cv.Rule(Left, Left + 170, y, 0.6, PdfStyle.Ink);
        cv.Text(c.SignerName, Left, y - 13, 10, true);
        cv.Text(c.SignerTitle, Left, y - 25, 9, false, PdfStyle.Muted);
        if (c.ShowSeal) DrawSeal(cv, c, settings, Right - 110, signatureTop - 100);

        cv.Rule(Left, Right, 52, 0.4, PdfStyle.Hairline);
        var footer = "Official Company Document - " + c.CompanyName;
        cv.Text(cv.Fit(footer, Right - Left, 7.2), Left, 40, 7.2, false, PdfStyle.Muted);
    }

    private static void DrawSeal(PdfCanvas cv, LetterContent c, DocumentSettings settings, double x, double bottom)
    {
        if (settings.Seal is { Length: > 0 } && DrawImage(cv, settings.Seal, settings.SealContentType, x, bottom, 100, 100)) return;
        // No artwork uploaded: a plain stamp frame so the position is clear.
        cv.Outline(x, bottom + 10, 100, 80, 1.4, PdfStyle.Teal);
        cv.Outline(x + 4, bottom + 14, 92, 72, 0.5, PdfStyle.Teal);
        var lines = cv.Wrap(c.CompanyName.ToUpperInvariant(), 80, 6.2, true).Take(3).ToList();
        var top = bottom + 74;
        foreach (var line in lines)
        {
            cv.Text(line, x + 50 - cv.Width(line, 6.2, true) / 2, top, 6.2, true, PdfStyle.Teal);
            top -= 8;
        }
        cv.Text("OFFICIAL SEAL", x + 50 - cv.Width("OFFICIAL SEAL", 6, true) / 2, bottom + 24, 6, true, PdfStyle.Teal);
    }

    /// <summary>Draws a PNG or JPEG inside the box, keeping its shape. Returns false when the image cannot be read.</summary>
    private static bool DrawImage(PdfCanvas cv, byte[] data, string? contentType, double x, double bottom, double maxWidth, double maxHeight)
    {
        var size = ImageSize.Read(data);
        if (size is null) return false;
        var scale = Math.Min(maxWidth / size.Value.Width, maxHeight / size.Value.Height);
        var w = size.Value.Width * scale;
        var h = size.Value.Height * scale;
        var left = x + (maxWidth - w) / 2;
        var base_ = bottom + (maxHeight - h) / 2;
        try
        {
            if (size.Value.Jpeg) cv.Jpeg(data, left, base_, w, h);
            else cv.Image(data, left, base_, left + w, base_ + h);
            return true;
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or NotSupportedException)
        {
            return false;
        }
    }

    /// <summary>Wraps runs of normal and bold text into lines of at most <paramref name="width"/>; returns the next baseline.</summary>
    private static double Runs(PdfCanvas cv, List<LetterRun> runs, double x, double y, double width)
    {
        var words = new List<(string Text, bool Bold)>();
        foreach (var run in runs)
            foreach (var word in PdfText.Flatten(run.Text).Split(' ', StringSplitOptions.RemoveEmptyEntries))
                words.Add((word, run.Bold));
        // Words glued to the previous run (no space between them, for example a full stop after a value) stay together.
        var glued = new HashSet<int>();
        var index = 0;
        foreach (var run in runs)
        {
            var parts = PdfText.Flatten(run.Text).Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length > 0 && index > 0 && run.Text.Length > 0 && !char.IsWhiteSpace(run.Text[0])) glued.Add(index);
            index += parts.Length;
        }

        var cursor = x;
        double Space(bool bold) => cv.Width("a a", BodySize, bold) - cv.Width("aa", BodySize, bold);
        for (var i = 0; i < words.Count; i++)
        {
            var (text, bold) = words[i];
            var wordWidth = cv.Width(text, BodySize, bold);
            var gap = cursor > x && !glued.Contains(i) ? Space(bold) : 0;
            if (cursor > x && cursor + gap + wordWidth > x + width)
            {
                y -= Leading;
                cursor = x;
                gap = 0;
            }
            cv.Text(text, cursor + gap, y, BodySize, bold);
            cursor += gap + wordWidth;
        }
        return y - Leading;
    }

    private static string JoinNonEmpty(string separator, params string[] parts) => string.Join(separator, parts.Where(p => !string.IsNullOrWhiteSpace(p)));

    /// <summary>Reads the pixel size of a PNG or JPEG without decoding it.</summary>
    private static class ImageSize
    {
        public static (double Width, double Height, bool Jpeg)? Read(byte[] d)
        {
            if (d.Length > 24 && d[0] == 0x89 && d[1] == 0x50 && d[2] == 0x4E && d[3] == 0x47)
            {
                double w = (d[16] << 24) | (d[17] << 16) | (d[18] << 8) | d[19];
                double h = (d[20] << 24) | (d[21] << 16) | (d[22] << 8) | d[23];
                return w > 0 && h > 0 ? (w, h, false) : null;
            }
            if (d.Length > 4 && d[0] == 0xFF && d[1] == 0xD8)
            {
                var i = 2;
                while (i + 9 < d.Length)
                {
                    if (d[i] != 0xFF) { i++; continue; }
                    var marker = d[i + 1];
                    if (marker is >= 0xC0 and <= 0xCF and not 0xC4 and not 0xC8 and not 0xCC)
                    {
                        double h = (d[i + 5] << 8) | d[i + 6];
                        double w = (d[i + 7] << 8) | d[i + 8];
                        return w > 0 && h > 0 ? (w, h, true) : null;
                    }
                    i += 2 + ((d[i + 2] << 8) | d[i + 3]);
                }
            }
            return null;
        }
    }
}
