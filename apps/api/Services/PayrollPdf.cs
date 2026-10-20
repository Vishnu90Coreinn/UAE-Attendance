using System.Globalization;
using System.Reflection;
using HrPayroll.Api.Dtos;
using UglyToad.PdfPig.Content;
using UglyToad.PdfPig.Core;
using UglyToad.PdfPig.Writer;

namespace HrPayroll.Api.Services;

public sealed class PdfTextNotSupportedException(Exception inner) : Exception("The payroll PDF contains unsupported text.", inner);

/// <summary>A4 payroll layout with embedded, openly licensed fonts and selectable text.</summary>
public sealed class PayrollPdf
{
    public byte[] Generate(PayrollResponse report)
    {
        try { return GenerateCore(report); }
        catch (InvalidOperationException ex) when (ex.Message.StartsWith("The font does not contain a character:", StringComparison.Ordinal))
        { throw new PdfTextNotSupportedException(ex); }
    }

    private static byte[] GenerateCore(PayrollResponse report)
    {
        using var document = new PdfDocumentBuilder();
        var regular = document.AddTrueTypeFont(Font("Regular"));
        var bold = document.AddTrueTypeFont(Font("Bold"));
        var pages = new List<PdfPageBuilder>();
        PdfPageBuilder page = null!;
        double y = 0;
        double[] widths = [145, 119, 46, 70, 65, 78];
        string[] headers = ["Worker Name", "Designation", "Days Worked", "Basic Pay", "OT Pay", "Total Net Salary"];
        List<string> Wrap(string text, double width, double size, PdfDocumentBuilder.AddedFont font)
        {
            var result = new List<string>();
            var normalized = System.Text.RegularExpressions.Regex.Replace(text, @"\s+", " ").Trim();
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
        void Text(string text, double x, double baseline, double size = 8, bool strong = false) =>
            page.AddText(text, size, new PdfPoint(x, baseline), strong ? bold : regular);
        void Block(string text, double size, bool strong = false)
        {
            foreach (var line in Wrap(text, 523, size, strong ? bold : regular)) { Text(line, 36, y, size, strong); y -= size + 4; }
        }
        void TableRow(string[] values, bool heading = false)
        {
            var cells = values.Select((v, i) => Wrap(v, widths[i] - 7, 9, heading ? bold : regular)).ToArray();
            var height = cells.Max(c => c.Count) * 12 + 12;
            if (y - height < 82) NewPage();
            var x = 36d;
            for (var col = 0; col < cells.Length; col++)
            {
                for (var line = 0; line < cells[col].Count; line++)
                {
                    var value = cells[col][line];
                    var right = page.MeasureText(value, 9, new PdfPoint(0, 0), heading ? bold : regular)
                        .Select(l => l.BoundingBox.Right).DefaultIfEmpty(0).Max();
                    Text(value, col >= 2 ? x + widths[col] - 4 - right : x + 3, y - 12 - line * 12, 9, heading);
                }
                x += widths[col];
            }
            y -= height;
            page.DrawLine(new PdfPoint(36, y), new PdfPoint(559, y), .4);
        }
        void NewPage()
        {
            page = document.AddPage(PageSize.A4);
            pages.Add(page);
            y = 804;
            Block(report.Company.CompanyName, 15, true);
            Block(report.Company.Tagline, 9);
            Block("Email: " + report.Company.ContactEmail, 8);
            Block("United Arab Emirates", 8);
            y -= 7;
            Block("Monthly Payroll Report", 12, true);
            Block($"Month: {report.Period}   |   {report.Status}   |   Currency AED", 9);
            if (report.FinalisedBy is not null)
                Block($"Finalised by: {report.FinalisedBy} | {report.FinalisedUtc:yyyy-MM-dd HH:mm} UTC", 8);
            y -= 5;
            TableRow(headers, true);
        }
        static string Number(decimal value) => value.ToString("N2", CultureInfo.InvariantCulture);
        NewPage();
        foreach (var line in report.Lines)
            TableRow([line.WorkerName, line.Designation,
                line.DaysWorked.ToString(CultureInfo.InvariantCulture), Number(line.BasicPay), Number(line.OvertimePay), Number(line.TotalPay)]);
        var totals = report.Totals;
        TableRow(["TOTAL PAYROLL", "", "",
            Number(totals.BasicPay), Number(totals.OvertimePay), Number(totals.TotalPay)], true);
        if (y < 225) NewPage();
        y -= 25;
        Block("Total Net Salary: AED " + Number(totals.TotalPay), 12, true);
        y -= 25;
        var signatureTop = y;
        foreach (var line in Wrap("Prepared By: " + report.Company.PreparedByLabel, 240, 9, bold)) { Text(line, 36, y, 9, true); y -= 13; }
        var preparedBottom = y;
        y = signatureTop;
        foreach (var line in Wrap("Approved By: " + report.Company.ApprovedByLabel, 240, 9, bold)) { Text(line, 310, y, 9, true); y -= 13; }
        y = Math.Min(y, preparedBottom) - 30;
        page.DrawLine(new PdfPoint(36, y), new PdfPoint(266, y), .5);
        page.DrawLine(new PdfPoint(310, y), new PdfPoint(540, y), .5);
        Text("Signature & Date", 36, y - 14);
        Text("Signature & Stamp", 310, y - 14);
        for (var i = 0; i < pages.Count; i++)
        {
            page = pages[i];
            Text($"{report.Status}  |  Page {i + 1} of {pages.Count}", 36, 28, 8);
        }
        return document.Build();
    }

    private static byte[] Font(string weight)
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream($"HrPayroll.Api.Pdf.Fonts.NotoSans-{weight}.ttf")
            ?? throw new InvalidOperationException("The payroll PDF font is missing.");
        using var bytes = new MemoryStream();
        stream.CopyTo(bytes);
        return bytes.ToArray();
    }
}
