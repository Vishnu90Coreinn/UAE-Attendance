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
    private static readonly double[] Widths = [54, 36, 32, 42, 108, 58, 66, 127];

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
                var remarks = canvas.Wrap(f.Remarks.Length == 0 ? "-" : f.Remarks, Widths[7] - 12, 8.5);
                var wir = canvas.Wrap(SiteProgressService.WirLabel(f.WirStatus), Widths[6] - 12, 8.5);
                var align = canvas.Wrap(SiteProgressService.AlignmentLabel(f.Alignment), Widths[4] - 12, 8.5);
                var height = Math.Max(Math.Max(1, remarks.Count), Math.Max(wir.Count, align.Count)) * 11 + 8;
                if (y - height < 60)
                {
                    canvas = NewPage(false, out y);
                    Header(canvas, ref y);
                }
                var x = Left;
                string[] numbers = [f.Frames.ToString(CultureInfo.InvariantCulture), f.Glass.ToString(CultureInfo.InvariantCulture), f.Shutters.ToString(CultureInfo.InvariantCulture)];
                canvas.Text(canvas.Fit(f.Floor, Widths[0] - 12, 8.5), x + 6, y - 14, 8.5, true);
                x += Widths[0];
                for (var n = 0; n < 3; n++)
                {
                    canvas.RightText(numbers[n], x + Widths[n + 1] - 6, y - 14, 8.5);
                    x += Widths[n + 1];
                }
                for (var l = 0; l < align.Count; l++) canvas.Text(align[l], x + 6, y - 14 - l * 11, 8.5);
                x += Widths[4];
                canvas.Text(canvas.Fit(SiteProgressService.CompletionLabel(f.Completion), Widths[5] - 12, 8.5), x + 6, y - 14, 8.5);
                x += Widths[5];
                for (var l = 0; l < wir.Count; l++) canvas.Text(wir[l], x + 6, y - 14 - l * 11, 8.5);
                x += Widths[6];
                for (var l = 0; l < remarks.Count; l++) canvas.Text(remarks[l], x + 6, y - 14 - l * 11, 8.5, false, PdfStyle.Muted);
                y -= height;
                canvas.Rule(Left, Right, y, 0.4, PdfStyle.Hairline);
            }

            if (y < 150) { canvas = NewPage(false, out y); }
            y -= 44;
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
        string N(int v) => v.ToString("N0", CultureInfo.InvariantCulture);
        (string, string)[][] rows =
        [
            [("ALUMINIUM FRAMES", N(k.TotalFrames)), ("FIXED GLASS", N(k.TotalGlass)), ("SHUTTERS FINISHED", N(k.TotalShutters)),
             ("COMPLETED FLOORS", N(k.CompletedFloors)), ("PENDING INSTALL.", N(k.NoProgressFloors)), ("HANDOVER READY", k.HandoverReadyPercent + "%")],
            [("ALIGN: NOT COMPLETE", N(k.AlignmentNotComplete)), ("ALIGN: UNDER PROCESS", N(k.AlignmentUnderProcess)), ("ALIGN: COMPLETE", N(k.AlignmentComplete)),
             ("WIR APPROVED", N(k.ApprovedWir)), ("WIR PENDING", N(k.PendingWir)), ("WIR REJECTED", N(k.RejectedWir))],
        ];
        const double gap = 6;
        var width = (Right - Left - gap * 5) / 6;
        foreach (var items in rows)
        {
            for (var i = 0; i < items.Length; i++)
            {
                var x = Left + i * (width + gap);
                cv.Fill(x, y - 40, width, 40, PdfStyle.Panel);
                cv.Text(cv.Fit(items[i].Item1, width - 12, 6.0, true), x + 6, y - 13, 6.0, true, PdfStyle.Muted);
                cv.Text(items[i].Item2, x + 6, y - 32, 14, true, PdfStyle.Teal);
            }
            y -= 40 + 6;
        }
        y -= 12;
    }

    private static void Header(PdfCanvas cv, ref double y)
    {
        string[] headings = ["Floor", "Frames", "Glass", "Shutters", "Alignment", "Completion", "WIR Status", "Site Remarks"];
        cv.Fill(Left, y - 22, Right - Left, 22, PdfStyle.Panel);
        var x = Left;
        for (var c = 0; c < headings.Length; c++)
        {
            if (c is 1 or 2 or 3) cv.RightText(headings[c], x + Widths[c] - 6, y - 14, 8, true);
            else cv.Text(headings[c], x + 6, y - 14, 8, true);
            x += Widths[c];
        }
        y -= 22;
        cv.Rule(Left, Right, y, 1.2, PdfStyle.Teal);
    }
}
