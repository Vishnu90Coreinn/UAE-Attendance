using System.Globalization;
using System.Reflection;
using System.Text.RegularExpressions;
using HrPayroll.Api.Dtos;
using Microsoft.Extensions.Configuration;
using UglyToad.PdfPig.Content;
using UglyToad.PdfPig.Core;
using UglyToad.PdfPig.Writer;

namespace HrPayroll.Api.Services;

public sealed class PdfTextNotSupportedException(Exception inner) : Exception("The payroll PDF contains unsupported text.", inner);

/// <summary>A4 payroll report with the company letterhead, embedded openly licensed fonts and selectable text.</summary>
public sealed class PayrollPdf(IConfiguration? configuration = null)
{
    private const double Left = 36;
    private const double Right = 559;

    public byte[] Generate(PayrollResponse report)
    {
        try { return GenerateCore(report); }
        catch (InvalidOperationException ex) when (ex.Message.StartsWith("The font does not contain a character:", StringComparison.Ordinal))
        { throw new PdfTextNotSupportedException(ex); }
    }

    private byte[] GenerateCore(PayrollResponse report)
    {
        foreach (var line in report.Lines) { PdfText.EnsurePrintable(line.WorkerName); PdfText.EnsurePrintable(line.Designation); }
        using var document = new PdfDocumentBuilder();
        var regular = document.AddTrueTypeFont(PdfText.Font("Regular"));
        var bold = document.AddTrueTypeFont(PdfText.Font("Bold"));
        var logo = PdfText.Asset("logo.png");
        var details = PdfText.Letterhead(configuration, report.Company.ContactEmail);
        var pages = new List<PdfPageBuilder>();
        PdfPageBuilder page = null!;
        double y = 0;
        // Columns fill the 523pt text width.
        double[] widths = [118, 100, 46, 66, 58, 66, 69];
        string[] headers = ["Worker Name", "Designation", "Days Worked", "Basic Pay", "OT Pay", "Deductions", "Total Net Salary"];

        List<string> Wrap(string text, double width, double size, PdfDocumentBuilder.AddedFont font)
        {
            var result = new List<string>();
            var normalized = Regex.Replace(text, @"\s+", " ").Trim();
            var current = "";
            double Measure(string value) => page.MeasureText(value, size, new PdfPoint(0, 0), font)
                .Select(l => l.BoundingBox.Right).DefaultIfEmpty(0).Max();
            foreach (var word in normalized.Split(' ', StringSplitOptions.RemoveEmptyEntries))
            {
                var candidate = current.Length == 0 ? word : current + " " + word;
                if (Measure(candidate) <= width) { current = candidate; continue; }
                if (current.Length > 0) { result.Add(current); current = ""; }
                // Only a single word wider than its column is split within the word.
                foreach (var character in word)
                {
                    candidate = current + character;
                    if (Measure(candidate) > width && current.Length > 0)
                    { result.Add(current); current = character.ToString(); }
                    else current = candidate;
                }
            }
            result.Add(current.TrimEnd());
            return result;
        }

        void Text(string text, double x, double baseline, double size = 8, bool strong = false, PdfStyle.Rgb? color = null)
        {
            page.SetTextAndFillColor(color ?? PdfStyle.Ink);
            page.AddText(PdfText.Flatten(text), size, new PdfPoint(x, baseline), strong ? bold : regular);
        }
        double Width(string text, double size, bool strong) => page.MeasureText(PdfText.Flatten(text), size, new PdfPoint(0, 0), strong ? bold : regular)
            .Select(l => l.BoundingBox.Right).DefaultIfEmpty(0).Max();
        void RightText(string text, double rightEdge, double baseline, double size = 8, bool strong = false, PdfStyle.Rgb? color = null) =>
            Text(text, rightEdge - Width(text, size, strong), baseline, size, strong, color);
        void Fill(double x, double bottom, double width, double height, PdfStyle.Rgb color)
        {
            page.SetTextAndFillColor(color);
            page.DrawRectangle(new PdfPoint(x, bottom), width, height, 0, true);
        }
        void Rule(double x1, double x2, double at, double width, PdfStyle.Rgb color)
        {
            page.SetStrokeColor(color.R, color.G, color.B);
            page.DrawLine(new PdfPoint(x1, at), new PdfPoint(x2, at), width);
            page.ResetColor();
        }

        void Header()
        {
            // Letterhead: logo, company identity on the left; report title and status on the right.
            page.AddPng(logo, new PdfRectangle(Left, 742, Left + 100, 807));
            Text(report.Company.CompanyName, 148, 800, 13, true, PdfStyle.Teal);
            Text(report.Company.Tagline, 148, 786, 8.5, false, PdfStyle.Muted);
            Text(details.Address1, 148, 773, 7.8, false, PdfStyle.Muted);
            Text(details.Address2, 148, 762, 7.8, false, PdfStyle.Muted);
            Text(details.Contact, 148, 751, 7.8, false, PdfStyle.Muted);
            RightText($"Month: {report.Period}", Right, 784, 13, true);
            var statusWidth = Width(report.Status.ToUpperInvariant(), 7.5, true) + 18;
            var finalised = report.Status == "Finalised";
            Fill(Right - statusWidth, 762, statusWidth, 14, finalised ? PdfStyle.Teal : PdfStyle.Amber);
            page.SetTextAndFillColor(PdfStyle.White);
            page.AddText(report.Status.ToUpperInvariant(), 7.5, new PdfPoint(Right - statusWidth + 9, 766), bold);
            Rule(Left, Right, 740, 2.2, PdfStyle.Teal);
            y = 722;
            Text("MONTHLY PAYROLL REPORT", Left, y, 11, true, PdfStyle.Teal);
            y -= 18;
            if (report.FinalisedBy is not null && report.FinalisedUtc is { } finalisedUtc)
            {
                Text($"Finalised by {report.FinalisedBy} on {PdfText.CompanyTime(finalisedUtc):dd MMM yyyy HH:mm} (UAE)", Left, y, 8, false, PdfStyle.Muted);
                y -= 16;
            }
            y -= 6;
            TableHeading();
        }

        void TableHeading()
        {
            var height = 24.0;
            if (y - height < 100) { NewPage(); return; }
            Fill(Left, y - height, Right - Left, height, PdfStyle.Teal);
            var x = Left;
            for (var c = 0; c < headers.Length; c++)
            {
                var text = headers[c];
                var lines = Wrap(text, widths[c] - 8, 8.5, bold);
                for (var l = 0; l < lines.Count; l++)
                {
                    var baseline = y - 10 - l * 11;
                    if (c >= 2) RightText(lines[l], x + widths[c] - 4, baseline, 8.5, true, PdfStyle.White);
                    else Text(lines[l], x + 4, baseline, 8.5, true, PdfStyle.White);
                }
                x += widths[c];
            }
            y -= height;
        }

        void NewPage()
        {
            page = document.AddPage(PageSize.A4);
            pages.Add(page);
            if (pages.Count == 1)
            {
                y = 820;
                Header();
                return;
            }
            // Continuation pages carry a slim running header instead of the full letterhead.
            page.AddPng(logo, new PdfRectangle(Left, 790, Left + 52, 823));
            Text(report.Company.CompanyName, 96, 806, 9, true, PdfStyle.Teal);
            Text($"Monthly Payroll Report, {report.Period} (continued)", 96, 795, 8, false, PdfStyle.Muted);
            Rule(Left, Right, 780, 1, PdfStyle.Teal);
            y = 766;
            TableHeading();
        }

        NewPage();
        var rowIndex = 0;
        foreach (var line in report.Lines)
        {
            var cells = new[]
            {
                line.WorkerName, line.Designation, line.DaysWorked.ToString(CultureInfo.InvariantCulture),
                PdfText.Number(line.BasicPay), PdfText.Number(line.OvertimePay),
                PdfText.Number(line.TotalDeductions), PdfText.Number(line.NetPay),
            };
            var wrapped = cells.Select((v, i) => Wrap(v, widths[i] - 8, 8.5, regular)).ToArray();
            var rowHeight = wrapped.Max(c => c.Count) * 11 + 10;
            if (y - rowHeight < 100)
            {
                NewPage();
                rowIndex = 0;
            }
            if (rowIndex % 2 == 1) Fill(Left, y - rowHeight, Right - Left, rowHeight, PdfStyle.Stripe);
            var x = Left;
            for (var c = 0; c < wrapped.Length; c++)
            {
                var strong = c == wrapped.Length - 1;
                for (var l = 0; l < wrapped[c].Count; l++)
                {
                    var baseline = y - 13 - l * 11;
                    if (c >= 2) RightText(wrapped[c][l], x + widths[c] - 4, baseline, 8.5, strong);
                    else Text(wrapped[c][l], x + 4, baseline, 8.5, strong);
                }
                x += widths[c];
            }
            y -= rowHeight;
            Rule(Left, Right, y, 0.4, PdfStyle.Hairline);
            rowIndex++;
        }

        // Totals row, then the net salary box.
        var totals = report.Totals;
        var totalCells = new[]
        {
            "TOTAL PAYROLL", "", totals.DaysWorked.ToString(CultureInfo.InvariantCulture),
            PdfText.Number(totals.BasicPay), PdfText.Number(totals.OvertimePay),
            PdfText.Number(totals.TotalDeductions), PdfText.Number(totals.NetPay),
        };
        if (y - 26 < 150) NewPage();
        Fill(Left, y - 24, Right - Left, 24, PdfStyle.TealTint);
        Rule(Left, Right, y, 1.2, PdfStyle.Teal);
        var tx = Left;
        for (var c = 0; c < totalCells.Length; c++)
        {
            if (c == 0) Text(totalCells[c], tx + 4, y - 15, 8.5, true, PdfStyle.Teal);
            else if (c >= 2) RightText(totalCells[c], tx + widths[c] - 4, y - 15, 8.5, true);
            tx += widths[c];
        }
        y -= 24;
        Rule(Left, Right, y, 1.2, PdfStyle.Teal);

        y -= 26;
        if (y < 200) NewPage();
        Fill(Left, y - 30, Right - Left, 34, PdfStyle.TealTint);
        Text("TOTAL NET SALARY (AED)", Left + 10, y - 19, 9, true, PdfStyle.Teal);
        RightText(PdfText.Number(totals.NetPay), Right - 10, y - 20, 13, true, PdfStyle.Teal);
        y -= 66;

        // Signatures.
        if (y < 150) NewPage();
        Text("Prepared By: " + report.Company.PreparedByLabel, Left, y, 9, true);
        Text("Approved By: " + report.Company.ApprovedByLabel, 310, y, 9, true);
        y -= 46;
        Rule(Left, 266, y, 0.6, PdfStyle.Ink);
        Rule(310, Right, y, 0.6, PdfStyle.Ink);
        Text("Signature & Date", Left, y - 13, 8, false, PdfStyle.Muted);
        Text("Signature & Stamp", 310, y - 13, 8, false, PdfStyle.Muted);

        // Footer on every page: company contact on the left, page numbers and status on the right.
        for (var i = 0; i < pages.Count; i++)
        {
            page = pages[i];
            Rule(Left, Right, 58, 0.6, PdfStyle.Hairline);
            Text(report.Company.CompanyName, Left, 44, 7.2, false, PdfStyle.Muted);
            RightText($"{report.Status}  |  Page {i + 1} of {pages.Count}", Right, 44, 7.2, false, PdfStyle.Muted);
        }
        return document.Build();
    }
}

/// <summary>Brand colours taken from the company logo, shared by the payroll report and payslips.</summary>
internal static class PdfStyle
{
    public readonly record struct Rgb(byte R, byte G, byte B);

    public static readonly Rgb Teal = new(19, 78, 82);
    public static readonly Rgb TealTint = new(232, 242, 242);
    public static readonly Rgb Stripe = new(246, 249, 249);
    public static readonly Rgb Hairline = new(214, 224, 224);
    public static readonly Rgb Ink = new(26, 32, 36);
    public static readonly Rgb Muted = new(96, 104, 110);
    public static readonly Rgb White = new(255, 255, 255);
    public static readonly Rgb Amber = new(180, 110, 20);

    /// <summary>PdfPig takes the three colour bytes; this lets callers pass a brand colour directly.</summary>
    public static void SetTextAndFillColor(this PdfPageBuilder page, Rgb color) => page.SetTextAndFillColor(color.R, color.G, color.B);
}

/// <summary>Shared font, asset, letterhead and text helpers for the payroll report and payslips.</summary>
internal static class PdfText
{
    private static readonly TimeZoneInfo CompanyTimeZone = TimeZoneInfo.FindSystemTimeZoneById("Asia/Dubai");

    /// <summary>
    /// The embedded font covers Latin letters only. Anything outside Latin (Arabic, Bengali, ...) would print as "?" without
    /// an error, so it is refused up front and the caller reports that the PDF supports English text.
    /// </summary>
    public static void EnsurePrintable(string text)
    {
        if (text.Any(c => c > 'ɏ' || (char.IsControl(c) && !char.IsWhiteSpace(c))))
            throw new PdfTextNotSupportedException(new InvalidOperationException("Text outside the Latin range: " + text));
    }

    /// <summary>Line breaks and tabs in free text would fail a single-line draw, so they become spaces first.</summary>
    public static string Flatten(string text) => Regex.Replace(text, @"\s+", " ").Trim();

    public static string Number(decimal value) => value.ToString("N2", CultureInfo.InvariantCulture);

    public static DateTime CompanyTime(DateTime utc) =>
        TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), CompanyTimeZone);

    /// <summary>Address, phone, website and email printed under the company name.</summary>
    public static LetterheadDetails Letterhead(IConfiguration? configuration, string email) => new(
        configuration?["Company:AddressLine1"] ?? "",
        configuration?["Company:AddressLine2"] ?? "",
        string.Join("  |  ", new[] { configuration?["Company:Phone"], configuration?["Company:Website"], email, "United Arab Emirates" }
            .Where(v => !string.IsNullOrWhiteSpace(v))));

    public sealed record LetterheadDetails(string Address1, string Address2, string Contact);

    public static byte[] Font(string weight) => Asset($"NotoSans-{weight}.ttf", "Fonts");

    public static byte[] Asset(string fileName, string folder = "Assets")
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream($"HrPayroll.Api.Pdf.{folder}.{fileName}")
            ?? throw new InvalidOperationException($"The PDF resource {fileName} is missing.");
        using var bytes = new MemoryStream();
        stream.CopyTo(bytes);
        return bytes.ToArray();
    }
}
