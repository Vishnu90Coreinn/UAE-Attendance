using HrPayroll.Api.Dtos;
using UglyToad.PdfPig.Core;
using UglyToad.PdfPig.Writer;

namespace HrPayroll.Api.Services;

/// <summary>Drawing helpers for one PDF page: text in the two embedded fonts, rules, and filled or outlined boxes.</summary>
internal sealed class PdfCanvas(PdfPageBuilder page, PdfDocumentBuilder.AddedFont regular, PdfDocumentBuilder.AddedFont bold)
{
    /// <summary>Draws a JPEG stretched to the box whose bottom-left corner is (<paramref name="x"/>, <paramref name="y"/>).</summary>
    public void Jpeg(byte[] data, double x, double y, double width, double height) =>
        page.AddJpeg(data, new PdfRectangle(x, y, x + width, y + height));

    public double Width(string text, double size, bool strong = false) =>
        page.MeasureText(PdfText.Flatten(text), size, new PdfPoint(0, 0), strong ? bold : regular)
            .Select(l => l.BoundingBox.Right).DefaultIfEmpty(0).Max();

    public void Text(string text, double x, double baseline, double size = 8, bool strong = false, PdfStyle.Rgb? color = null)
    {
        page.SetTextAndFillColor(color ?? PdfStyle.Ink);
        page.AddText(PdfText.Flatten(text), size, new PdfPoint(x, baseline), strong ? bold : regular);
    }

    public void RightText(string text, double rightEdge, double baseline, double size = 8, bool strong = false, PdfStyle.Rgb? color = null) =>
        Text(text, rightEdge - Width(text, size, strong), baseline, size, strong, color);

    /// <summary>Breaks text into lines no wider than <paramref name="width"/>; only a single over-wide word is split inside.</summary>
    public List<string> Wrap(string text, double width, double size, bool strong = false)
    {
        var result = new List<string>();
        var current = "";
        foreach (var word in PdfText.Flatten(text).Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            var candidate = current.Length == 0 ? word : current + " " + word;
            if (Width(candidate, size, strong) <= width) { current = candidate; continue; }
            if (current.Length > 0) { result.Add(current); current = ""; }
            foreach (var character in word)
            {
                candidate = current + character;
                if (Width(candidate, size, strong) > width && current.Length > 0)
                { result.Add(current); current = character.ToString(); }
                else current = candidate;
            }
        }
        result.Add(current.TrimEnd());
        return result;
    }

    /// <summary>One line of text, cut short with dots when it would be wider than <paramref name="width"/>.</summary>
    public string Fit(string text, double width, double size, bool strong = false)
    {
        var flat = PdfText.Flatten(text);
        if (Width(flat, size, strong) <= width) return flat;
        while (flat.Length > 1 && Width(flat + "...", size, strong) > width) flat = flat[..^1];
        return flat.TrimEnd() + "...";
    }

    public void Fill(double x, double bottom, double width, double height, PdfStyle.Rgb color)
    {
        // The stroke matches the fill so the box has no dark hairline edge.
        page.SetTextAndFillColor(color);
        page.SetStrokeColor(color.R, color.G, color.B);
        page.DrawRectangle(new PdfPoint(x, bottom), width, height, 0, true);
        page.ResetColor();
    }

    public void Outline(double x, double bottom, double width, double height, double lineWidth, PdfStyle.Rgb color)
    {
        page.SetStrokeColor(color.R, color.G, color.B);
        page.DrawRectangle(new PdfPoint(x, bottom), width, height, lineWidth, false);
        page.ResetColor();
    }

    public void Rule(double x1, double x2, double at, double width, PdfStyle.Rgb color)
    {
        page.SetStrokeColor(color.R, color.G, color.B);
        page.DrawLine(new PdfPoint(x1, at), new PdfPoint(x2, at), width);
        page.ResetColor();
    }

    public void VRule(double x, double bottom, double top, double width, PdfStyle.Rgb color)
    {
        page.SetStrokeColor(color.R, color.G, color.B);
        page.DrawLine(new PdfPoint(x, bottom), new PdfPoint(x, top), width);
        page.ResetColor();
    }

    public void Image(byte[] png, double left, double bottom, double right, double top) =>
        page.AddPng(png, new PdfRectangle(left, bottom, right, top));
}

/// <summary>The company letterhead shared by the payroll report and the payslips, so both read as one document family.</summary>
internal static class PdfLetterhead
{
    public const double Left = 36;
    public const double Right = 559;

    /// <summary>
    /// Logo and company details on the left; document title, subtitle and an optional status badge on the right; an accent
    /// rule underneath. Returns the y position of that rule so the caller can place content below it.
    /// </summary>
    public static double Draw(PdfCanvas cv, byte[] logo, PayrollCompany company, PdfText.LetterheadDetails details,
        string title, string subtitle, string? badge)
    {
        cv.Image(logo, Left, 757, Left + 78, 808);

        const double textLeft = 128;
        var y = 797.0;
        foreach (var line in cv.Wrap(company.CompanyName, 270, 11.5, true))
        {
            cv.Text(line, textLeft, y, 11.5, true, PdfStyle.Teal);
            y -= 13.5;
        }
        y -= 1;
        var lastBaseline = y + 14.5;
        foreach (var line in new[] { company.Tagline, details.Address1, details.Address2, details.Contact })
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            cv.Text(cv.Fit(line, 330, 7.6), textLeft, y, 7.6, false, PdfStyle.Muted);
            lastBaseline = y;
            y -= 10.5;
        }

        cv.RightText(title, Right, 797, 15, true, PdfStyle.Teal);
        cv.RightText(subtitle, Right, 780, 9.5, false, PdfStyle.Ink);
        if (badge is not null)
        {
            var color = string.Equals(badge, "FINALISED", StringComparison.OrdinalIgnoreCase) ? PdfStyle.Teal : PdfStyle.Amber;
            var width = cv.Width(badge, 7, true) + 18;
            cv.Outline(Right - width, 758, width, 14, 0.9, color);
            cv.Text(badge, Right - width + 9, 762.5, 7, true, color);
        }

        var rule = Math.Min(751, lastBaseline - 9);
        Accent(cv, rule);
        return rule;
    }

    /// <summary>A hairline across the page with a short thick brand segment at its left end.</summary>
    public static void Accent(PdfCanvas cv, double y)
    {
        cv.Rule(Left, Right, y, 0.6, PdfStyle.Hairline);
        cv.Rule(Left, Left + 64, y, 2.4, PdfStyle.Teal);
    }
}
