using System.Globalization;
using System.Reflection;
using System.Text.RegularExpressions;
using HrPayroll.Api.Dtos;
using Microsoft.Extensions.Configuration;
using UglyToad.PdfPig.Content;
using UglyToad.PdfPig.Writer;

namespace HrPayroll.Api.Services;

public sealed class PdfTextNotSupportedException(Exception inner) : Exception("The payroll PDF contains unsupported text.", inner);

/// <summary>A4 payroll report with the company letterhead, embedded openly licensed fonts and selectable text.</summary>
public sealed class PayrollPdf(IConfiguration? configuration = null)
{
    private const double Left = PdfLetterhead.Left;
    private const double Right = PdfLetterhead.Right;

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
        PdfCanvas cv = null!;
        double y = 0;
        // Columns fill the 523pt text width.
        double[] widths = [118, 100, 46, 66, 58, 66, 69];
        string[] headers = ["Worker Name", "Designation", "Days Worked", "Basic Pay", "OT Pay", "Deductions", "Total Net Salary"];

        void Header()
        {
            var rule = PdfLetterhead.Draw(cv, logo, report.Company, details, "PAYROLL REPORT", $"Month: {report.Period}", report.Status.ToUpperInvariant());

            // Summary strip: the four figures a reader looks for first.
            var top = rule - 16;
            const double stripHeight = 42;
            var totals = report.Totals;
            cv.Fill(Left, top - stripHeight, Right - Left, stripHeight, PdfStyle.Panel);
            string[] labels = ["WORKERS", "GROSS PAY (AED)", "DEDUCTIONS (AED)", "NET PAYABLE (AED)"];
            string[] values =
            [
                report.Lines.Count.ToString(CultureInfo.InvariantCulture), PdfText.Number(totals.TotalPay),
                PdfText.Number(totals.TotalDeductions), PdfText.Number(totals.NetPay),
            ];
            var cellWidth = (Right - Left) / labels.Length;
            for (var i = 0; i < labels.Length; i++)
            {
                var x = Left + i * cellWidth;
                cv.Text(labels[i], x + 12, top - 16, 6.8, true, PdfStyle.Muted);
                cv.Text(values[i], x + 12, top - 33, 12.5, true, i == labels.Length - 1 ? PdfStyle.Teal : PdfStyle.Ink);
                if (i > 0) cv.VRule(x, top - stripHeight + 9, top - 9, 0.5, PdfStyle.Hairline);
            }

            y = top - stripHeight - 16;
            var note = report.FinalisedBy is not null && report.FinalisedUtc is { } finalisedUtc
                ? $"Finalised by {report.FinalisedBy} on {PdfText.CompanyTime(finalisedUtc):dd MMM yyyy HH:mm} (UAE)"
                : "Draft: figures are provisional until the month is finalised.";
            cv.Text(cv.Fit(note, 380, 7.8), Left, y, 7.8, false, PdfStyle.Muted);
            cv.RightText("All amounts in AED", Right, y, 7.8, false, PdfStyle.Muted);
            y -= 12;
            TableHeading();
        }

        void TableHeading()
        {
            const double height = 28;
            if (y - height < 100) { NewPage(); return; }
            cv.Fill(Left, y - height, Right - Left, height, PdfStyle.Panel);
            var x = Left;
            for (var col = 0; col < headers.Length; col++)
            {
                var lines = cv.Wrap(headers[col], widths[col] - 8, 8, true);
                for (var l = 0; l < lines.Count; l++)
                {
                    var baseline = y - 11 - l * 10;
                    if (col >= 2) cv.RightText(lines[l], x + widths[col] - 4, baseline, 8, true);
                    else cv.Text(lines[l], x + 4, baseline, 8, true);
                }
                x += widths[col];
            }
            y -= height;
            cv.Rule(Left, Right, y, 1.2, PdfStyle.Teal);
        }

        void NewPage()
        {
            var page = document.AddPage(PageSize.A4);
            pages.Add(page);
            cv = new PdfCanvas(page, regular, bold);
            if (pages.Count == 1)
            {
                y = 820;
                Header();
                return;
            }
            // Continuation pages carry a slim running header instead of the full letterhead.
            cv.Image(logo, Left, 792, Left + 46, 822);
            cv.Text(cv.Fit(report.Company.CompanyName, 400, 9, true), 94, 808, 9, true, PdfStyle.Teal);
            cv.Text($"Payroll Report, Month: {report.Period} (continued)", 94, 796, 7.8, false, PdfStyle.Muted);
            PdfLetterhead.Accent(cv, 784);
            y = 770;
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
            var wrapped = cells.Select((v, i) => cv.Wrap(v, widths[i] - 8, 8.5)).ToArray();
            var rowHeight = wrapped.Max(w => w.Count) * 11 + 10;
            if (y - rowHeight < 100)
            {
                NewPage();
                rowIndex = 0;
            }
            if (rowIndex % 2 == 1) cv.Fill(Left, y - rowHeight, Right - Left, rowHeight, PdfStyle.Stripe);
            var x = Left;
            for (var col = 0; col < wrapped.Length; col++)
            {
                var strong = col == wrapped.Length - 1;
                for (var l = 0; l < wrapped[col].Count; l++)
                {
                    var baseline = y - 13 - l * 11;
                    if (col >= 2) cv.RightText(wrapped[col][l], x + widths[col] - 4, baseline, 8.5, strong);
                    else cv.Text(wrapped[col][l], x + 4, baseline, 8.5, strong);
                }
                x += widths[col];
            }
            y -= rowHeight;
            cv.Rule(Left, Right, y, 0.4, PdfStyle.Hairline);
            rowIndex++;
        }

        // Totals row, closed with an accounting-style double rule.
        var grand = report.Totals;
        var totalCells = new[]
        {
            "TOTAL PAYROLL", "", grand.DaysWorked.ToString(CultureInfo.InvariantCulture),
            PdfText.Number(grand.BasicPay), PdfText.Number(grand.OvertimePay),
            PdfText.Number(grand.TotalDeductions), PdfText.Number(grand.NetPay),
        };
        if (y - 26 < 150) NewPage();
        cv.Fill(Left, y - 24, Right - Left, 24, PdfStyle.Panel);
        cv.Rule(Left, Right, y, 1.2, PdfStyle.Teal);
        var tx = Left;
        for (var col = 0; col < totalCells.Length; col++)
        {
            if (col == 0) cv.Text(totalCells[col], tx + 4, y - 15, 8.5, true, PdfStyle.Teal);
            else if (col >= 2) cv.RightText(totalCells[col], tx + widths[col] - 4, y - 15, 8.5, true, col == totalCells.Length - 1 ? PdfStyle.Teal : PdfStyle.Ink);
            tx += widths[col];
        }
        y -= 24;
        cv.Rule(Left, Right, y, 0.6, PdfStyle.Teal);
        cv.Rule(Left, Right, y - 2.4, 0.6, PdfStyle.Teal);

        // Signatures.
        y -= 44;
        if (y < 130) NewPage();
        var signatureLine = y - 30;
        cv.Rule(Left, 266, signatureLine, 0.6, PdfStyle.Ink);
        cv.Rule(310, Right, signatureLine, 0.6, PdfStyle.Ink);
        cv.Text("Prepared By: " + report.Company.PreparedByLabel, Left, signatureLine - 12, 8.5, true);
        cv.Text("Approved By: " + report.Company.ApprovedByLabel, 310, signatureLine - 12, 8.5, true);
        cv.Text("Signature & Date", Left, signatureLine - 23, 7.6, false, PdfStyle.Muted);
        cv.Text("Signature & Stamp", 310, signatureLine - 23, 7.6, false, PdfStyle.Muted);

        // Footer on every page: confidentiality and company on the left, status and page numbers on the right.
        for (var i = 0; i < pages.Count; i++)
        {
            cv = new PdfCanvas(pages[i], regular, bold);
            cv.Rule(Left, Right, 58, 0.5, PdfStyle.Hairline);
            cv.Text(cv.Fit("Confidential  |  " + report.Company.CompanyName, 330, 7), Left, 44, 7, false, PdfStyle.Muted);
            cv.RightText($"{report.Status}  |  Page {i + 1} of {pages.Count}", Right, 44, 7, false, PdfStyle.Muted);
        }
        return document.Build();
    }
}

/// <summary>Brand colours taken from the company logo, shared by the payroll report and payslips.</summary>
internal static class PdfStyle
{
    public readonly record struct Rgb(byte R, byte G, byte B);

    public static readonly Rgb Teal = new(19, 78, 82);
    public static readonly Rgb TealPale = new(190, 214, 216);
    public static readonly Rgb Panel = new(240, 244, 245);
    public static readonly Rgb Stripe = new(248, 250, 250);
    public static readonly Rgb Hairline = new(212, 220, 223);
    public static readonly Rgb Ink = new(28, 34, 38);
    public static readonly Rgb Muted = new(98, 106, 112);
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
