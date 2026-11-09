using System.Globalization;
using HrPayroll.Api.Dtos;
using Microsoft.Extensions.Configuration;
using UglyToad.PdfPig.Content;
using UglyToad.PdfPig.Writer;

namespace HrPayroll.Api.Services;

/// <summary>The daily site progress report as an A4 PDF: summary figures, the floors table and three signature blocks.</summary>
public sealed class SiteProgressPdf(IConfiguration configuration)
{
    private const double Left = PdfLetterhead.Left;
    private const double Right = PdfLetterhead.Right;
    private static readonly double[] Widths = [118, 52, 52, 78, 100, 123];

    public byte[] Generate(SiteProgressResponse report, PayrollCompany company)
    {
        PdfText.EnsurePrintable(report.ProjectName);
        foreach (var f in report.Floors) { PdfText.EnsurePrintable(f.Floor); PdfText.EnsurePrintable(f.Remarks); }
        try
        {
            using var document = new PdfDocumentBuilder();
            var regular = document.AddTrueTypeFont(PdfText.Font("Regular"));
            var bold = document.AddTrueTypeFont(PdfText.Font("Bold"));
            var logo = PdfText.Asset("logo.png");
            var images = new Dictionary<byte[], PdfPageBuilder.AddedImage>();
            var details = PdfText.Letterhead(configuration, company.ContactEmail);
            var date = DateOnly.ParseExact(report.Date, "yyyy-MM-dd", CultureInfo.InvariantCulture).ToString("dd MMMM yyyy", CultureInfo.InvariantCulture);

            PdfCanvas NewPage(bool first, out double y)
            {
                var cv = new PdfCanvas(document.AddPage(PageSize.A4), regular, bold, images);
                var rule = PdfLetterhead.Draw(cv, logo, company, details, "SITE PROGRESS REPORT", date, null);
                y = rule - 20;
                if (first)
                {
                    cv.Text("PROJECT", Left, y, 6.8, true, PdfStyle.Muted);
                    cv.Text(cv.Fit(report.ProjectName, Right - Left, 12, true), Left, y - 14, 12, true);
                    y -= 34;
                    Kpis(cv, report.Kpis, ref y);
                }
                return cv;
            }

            var canvas = NewPage(true, out var y);
            Header(canvas, ref y);
            foreach (var f in report.Floors)
            {
                var remarks = canvas.Wrap(f.Remarks.Length == 0 ? "-" : f.Remarks, Widths[5] - 12, 8.5);
                var height = Math.Max(1, remarks.Count) * 11 + 10;
                if (y - height < 60)
                {
                    canvas = NewPage(false, out y);
                    Header(canvas, ref y);
                }
                var cells = new[]
                {
                    canvas.Fit(f.Floor, Widths[0] - 12, 8.5), f.Frames.ToString(CultureInfo.InvariantCulture),
                    f.Glass.ToString(CultureInfo.InvariantCulture), SiteProgressService.CompletionLabel(f.Completion),
                    SiteProgressService.WirLabel(f.WirStatus),
                };
                var x = Left;
                for (var c = 0; c < cells.Length; c++)
                {
                    if (c is 1 or 2) canvas.RightText(cells[c], x + Widths[c] - 6, y - 14, 8.5);
                    else canvas.Text(canvas.Fit(cells[c], Widths[c] - 12, 8.5), x + 6, y - 14, 8.5, c == 0);
                    x += Widths[c];
                }
                for (var l = 0; l < remarks.Count; l++) canvas.Text(remarks[l], x + 6, y - 14 - l * 11, 8.5, false, PdfStyle.Muted);
                y -= height;
                canvas.Rule(Left, Right, y, 0.4, PdfStyle.Hairline);
            }

            if (y < 150) { canvas = NewPage(false, out y); }
            y -= 60;
            var blocks = new[] { "Site Engineer / Subcontractor", "QA/QC Inspector", "Consultant Approval" };
            const double blockWidth = 150;
            for (var i = 0; i < blocks.Length; i++)
            {
                var x1 = Left + i * ((Right - Left - blockWidth) / 2);
                canvas.Rule(x1, x1 + blockWidth, y, 0.6, PdfStyle.Ink);
                canvas.Text(blocks[i], x1, y - 11, 7.8, true);
                canvas.Text("Signature & Date", x1, y - 22, 7.2, false, PdfStyle.Muted);
            }
            return document.Build();
        }
        catch (InvalidOperationException ex) when (ex.Message.StartsWith("The font does not contain a character:", StringComparison.Ordinal))
        {
            throw new PdfTextNotSupportedException(ex);
        }
    }

    private static void Kpis(PdfCanvas cv, SiteProgressKpis k, ref double y)
    {
        var items = new[]
        {
            ("ALUMINIUM FRAMES", k.TotalFrames), ("FIXED GLASS", k.TotalGlass), ("COMPLETED FLOORS", k.CompletedFloors),
            ("PENDING INSTALLATION", k.NoProgressFloors), ("PENDING WIR", k.PendingWir),
        };
        const double gap = 6;
        var width = (Right - Left - gap * 4) / 5;
        for (var i = 0; i < items.Length; i++)
        {
            var x = Left + i * (width + gap);
            cv.Fill(x, y - 44, width, 44, PdfStyle.Panel);
            cv.Text(items[i].Item1, x + 8, y - 14, 6.2, true, PdfStyle.Muted);
            cv.Text(items[i].Item2.ToString("N0", CultureInfo.InvariantCulture), x + 8, y - 35, 15, true, PdfStyle.Teal);
        }
        y -= 44 + 22;
    }

    private static void Header(PdfCanvas cv, ref double y)
    {
        string[] headings = ["Floor", "Frames", "Glass", "Completion", "WIR Status", "Site Remarks"];
        cv.Fill(Left, y - 22, Right - Left, 22, PdfStyle.Panel);
        var x = Left;
        for (var c = 0; c < headings.Length; c++)
        {
            if (c is 1 or 2) cv.RightText(headings[c], x + Widths[c] - 6, y - 14, 8, true);
            else cv.Text(headings[c], x + 6, y - 14, 8, true);
            x += Widths[c];
        }
        y -= 22;
        cv.Rule(Left, Right, y, 1.2, PdfStyle.Teal);
    }
}
