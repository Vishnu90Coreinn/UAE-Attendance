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
        // Letterhead: logo on the left, address and contact on the right, and the company name on one line across the
        // sheet (its size shrinks to fit rather than wrapping).
        if (settings.Logo is { Length: > 0 }) DrawImage(cv, settings.Logo, settings.LogoContentType, Left, 758, 110, 52, alignLeft: true);
        var y = 800.0;
        foreach (var line in new[] { JoinNonEmpty(", ", c.Address1, c.Address2), JoinNonEmpty("  |  ", string.IsNullOrWhiteSpace(c.Mobile) ? "" : "Mobile: " + c.Mobile, string.IsNullOrWhiteSpace(c.Email) ? "" : "Email: " + c.Email) })
        {
            if (line.Length == 0) continue;
            cv.RightText(cv.Fit(line, 330, 8.5), Right, y, 8.5, false, PdfStyle.Muted);
            y -= 11;
        }
        var name = c.CompanyName.ToUpperInvariant();
        var nameSize = Math.Min(13.0, 12.0 * (Right - Left) / Math.Max(1, cv.Width(name, 12, true)));
        y = 744;
        cv.Text(name, (Left + Right - cv.Width(name, nameSize, true)) / 2, y, nameSize, true, PdfStyle.Teal);
        y -= 10;
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
        cv.Text(c.Title, (Left + Right - titleWidth) / 2, y, 14, true, PdfStyle.Ink);
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
                ("Basic Salary", s.Basic), ("Housing Allowance", s.Housing),
                ("Transportation Allowance", s.Transport), ("Other Fixed Allowances", s.Other),
            };
            var tableTop = y;
            const double divider = 150; // width of the amount column
            cv.Fill(Left, y - 20, Right - Left, 20, PdfStyle.Panel);
            cv.Text("SALARY COMPONENT", Left + 8, y - 14, 8, true);
            cv.RightText("AMOUNT (AED)", Right - 8, y - 14, 8, true);
            y -= 20;
            cv.Rule(Left, Right, y, 0.5, PdfStyle.Hairline);
            foreach (var (label, amount) in rows)
            {
                cv.Text(label, Left + 8, y - 15, 9.5);
                cv.RightText(PdfText.Number(amount), Right - 8, y - 15, 9.5);
                y -= 22;
                cv.Rule(Left, Right, y, 0.5, PdfStyle.Hairline);
            }
            cv.Fill(Left, y - 22, Right - Left, 22, PdfStyle.AmberTint);
            cv.Text("TOTAL GROSS MONTHLY SALARY", Left + 8, y - 15, 9.5, true);
            cv.RightText(PdfText.Number(s.Total) + " AED", Right - 8, y - 15, 10.5, true);
            y -= 22;
            // The whole table is boxed, with a line between the two columns, as on screen.
            cv.Outline(Left, y, Right - Left, tableTop - y, 0.6, PdfStyle.Hairline);
            cv.VRule(Right - divider, y, tableTop, 0.5, PdfStyle.Hairline);
            y -= 16;
        }

        // Purpose note.
        var noteLines = cv.Wrap(c.PurposeNote, Right - Left - 24, 9);
        var noteHeight = noteLines.Count * 12 + 14;
        cv.Fill(Left, y - noteHeight, Right - Left, noteHeight, PdfStyle.Stripe);
        cv.VRule(Left + 1, y - noteHeight, y, 2, PdfStyle.Muted);
        for (var i = 0; i < noteLines.Count; i++) cv.Text(noteLines[i], Left + 12, y - 16 - i * 12, 9, false, PdfStyle.Muted);
        y -= noteHeight + 30;

        // Authorisation and signature (no stamp or seal is printed).
        cv.Rule(Left, Right, y + 14, 0.4, PdfStyle.Hairline);
        cv.Text("For " + c.CompanyName.ToUpperInvariant(), Left, y, 9.5, true);
        y -= 8;
        if (c.ShowSeal && settings.Signature is { Length: > 0 }) DrawImage(cv, settings.Signature, settings.SignatureContentType, Left, y - 52, 130, 46);
        y -= 66;
        cv.Rule(Left, Left + 170, y, 0.6, PdfStyle.Ink);
        cv.Text(c.SignerName, Left, y - 13, 10, true);
        cv.Text(c.SignerTitle, Left, y - 25, 9, false, PdfStyle.Muted);

        var footer = cv.Fit(("Official company document - " + c.CompanyName).ToUpperInvariant(), Right - Left, 7.2);
        cv.Text(footer, (Left + Right - cv.Width(footer, 7.2)) / 2, 40, 7.2, false, PdfStyle.Muted);
    }

    /// <summary>Draws a PNG or JPEG inside the box, keeping its shape. Returns false when the image cannot be read.</summary>
    private static bool DrawImage(PdfCanvas cv, byte[] data, string? contentType, double x, double bottom, double maxWidth, double maxHeight, bool alignLeft = false)
    {
        var size = ImageSize.Read(data);
        if (size is null) return false;
        var scale = Math.Min(maxWidth / size.Value.Width, maxHeight / size.Value.Height);
        var w = size.Value.Width * scale;
        var h = size.Value.Height * scale;
        var left = alignLeft ? x : x + (maxWidth - w) / 2;
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
        var previousEndedInSpace = true;
        foreach (var run in runs)
        {
            var parts = PdfText.Flatten(run.Text).Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length > 0 && index > 0 && !char.IsWhiteSpace(run.Text[0]) && !previousEndedInSpace) glued.Add(index);
            index += parts.Length;
            if (run.Text.Length > 0) previousEndedInSpace = char.IsWhiteSpace(run.Text[^1]);
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
    /// <summary>Also used by the tax invoice, which prints the same uploaded images.</summary>
    internal static class ImageSize
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
