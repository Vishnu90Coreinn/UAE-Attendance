using HrPayroll.Api.Dtos;
using HrPayroll.Api.Services;
using UglyToad.PdfPig;

namespace HrPayroll.Api.Tests.Unit;

public class PayrollPdfTests
{
    [Fact]
    public void Pdf_EmbedsUnicodeText_AndPaginatesLongRowsWithinA4()
    {
        var lines = Enumerable.Range(1, 120).Select(i => new PayrollLine(i, $"W{i:000}",
            i == 1 ? "José Иванов" : i == 2 ? "W" + new string('\n', 118) + "W" : new string('W', 120), string.Concat(Enumerable.Repeat("X\n", 40)), 12.5m, 5m, 26, 208m, 10m, 2600m, 50m, 2650m)).ToArray();
        var report = new PayrollResponse("2026-01", "Draft", new("Example Company", "T" + new string('\n', 198) + "T", "office@example.com", "HR Department", "General Manager"),
            lines, PayrollCalculator.GrandTotals(lines), "revision");
        var bytes = new PayrollPdf().Generate(report);
        using var pdf = PdfDocument.Open(bytes);
        Assert.True(pdf.NumberOfPages > 1);
        var text = string.Join("\n", pdf.GetPages().Select(p => p.Text));

        Assert.Contains("José Иванов", text);
        Assert.Contains("Total Net Salary", text);
        Assert.Contains("Signature & Date", text);
        Assert.Contains("Signature & Stamp", text);
        Assert.Contains("United Arab Emirates", text);
        Assert.Contains("Month: 2026-01", text);
        Assert.Contains("TOTAL PAYROLL", text);
        Assert.Contains("Prepared By: HR Department", text);
        Assert.Contains("Approved By: General Manager", text);
        Assert.Contains("318,000.00", text);
        foreach (var page in pdf.GetPages())
        {
            Assert.InRange(page.Width, 594, 596);
            Assert.InRange(page.Height, 841, 843);
            Assert.Contains("Worker Name", page.Text);
            var baselines = page.Letters.GroupBy(l => Math.Round(l.StartBaseLine.Y, 1))
                .Select(g => string.Concat(g.OrderBy(l => l.StartBaseLine.X).Select(l => l.Value))).ToArray();
            Assert.Contains(baselines, textLine => textLine.Contains("Worked", StringComparison.Ordinal));
            Assert.Contains(baselines, textLine => textLine.Contains("Salary", StringComparison.Ordinal));
            Assert.Contains($"Page {page.Number} of {pdf.NumberOfPages}", page.Text);
            Assert.All(page.Letters, l =>
            {
                Assert.InRange(l.BoundingBox.Left, 20, 575);
                Assert.InRange(l.BoundingBox.Right, 20, 575);
                Assert.InRange(l.BoundingBox.Bottom, 15, 825);
                Assert.InRange(l.BoundingBox.Top, 15, 825);
            });
        }
    }
}
