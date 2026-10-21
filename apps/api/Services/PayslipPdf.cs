using System.Globalization;
using HrPayroll.Api.Dtos;
using Microsoft.Extensions.Configuration;
using UglyToad.PdfPig.Content;
using UglyToad.PdfPig.Core;
using UglyToad.PdfPig.Writer;

namespace HrPayroll.Api.Services;

/// <summary>
/// One A4 payslip per worker, following the client's payslip template: employee details, earnings, deductions,
/// net salary payable, acknowledgment and signatures. Built only from a finalised month's snapshot.
/// </summary>
public sealed class PayslipPdf(IConfiguration configuration)
{
    private const double Left = 36;
    private const double Right = 559;

    public byte[] Generate(PayrollResponse report, IReadOnlyList<PayrollLine> lines, IReadOnlyDictionary<int, DateOnly?> joinDates)
    {
        foreach (var line in lines)
        {
            PdfText.EnsurePrintable(line.WorkerName);
            PdfText.EnsurePrintable(line.Designation);
            foreach (var deduction in line.Deductions ?? []) { PdfText.EnsurePrintable(deduction.Name); PdfText.EnsurePrintable(deduction.Note); }
        }
        try
        {
            using var document = new PdfDocumentBuilder();
            var regular = document.AddTrueTypeFont(PdfText.Font("Regular"));
            var bold = document.AddTrueTypeFont(PdfText.Font("Bold"));
            var logo = PdfText.Asset("logo.jpg");
            foreach (var line in lines)
            {
                var page = document.AddPage(PageSize.A4);
                Draw(page, report, line, joinDates.TryGetValue(line.WorkerId, out var joined) ? joined : null, regular, bold, logo);
            }
            return document.Build();
        }
        catch (InvalidOperationException ex) when (ex.Message.StartsWith("The font does not contain a character:", StringComparison.Ordinal))
        {
            throw new PdfTextNotSupportedException(ex);
        }
    }

    private void Draw(PdfPageBuilder page, PayrollResponse report, PayrollLine line, DateOnly? joinDate,
        PdfDocumentBuilder.AddedFont regular, PdfDocumentBuilder.AddedFont bold, byte[] logo)
    {
        void Text(string text, double x, double baseline, double size = 9, bool strong = false) =>
            page.AddText(text, size, new PdfPoint(x, baseline), strong ? bold : regular);
        void RightText(string text, double rightEdge, double baseline, double size = 9, bool strong = false)
        {
            var width = page.MeasureText(text, size, new PdfPoint(0, 0), strong ? bold : regular)
                .Select(l => l.BoundingBox.Right).DefaultIfEmpty(0).Max();
            Text(text, rightEdge - width, baseline, size, strong);
        }
        void CenteredText(string text, double baseline, double size, bool strong)
        {
            var width = page.MeasureText(text, size, new PdfPoint(0, 0), strong ? bold : regular)
                .Select(l => l.BoundingBox.Right).DefaultIfEmpty(0).Max();
            Text(text, (Left + Right - width) / 2, baseline, size, strong);
        }
        void Rule(double y) => page.DrawLine(new PdfPoint(Left, y), new PdfPoint(Right, y), .4);

        // Letterhead: logo on the left, company details on the right.
        page.AddJpeg(logo, new PdfRectangle(Left, 716, Left + 150, 820));
        Text(report.Company.CompanyName, 210, 800, 12, true);
        Text(configuration["Company:AddressLine1"] ?? "", 210, 784, 8.5);
        Text(configuration["Company:AddressLine2"] ?? "", 210, 772, 8.5);
        Text($"Tel: {configuration["Company:Phone"]}   |   {configuration["Company:Website"]}   |   {report.Company.ContactEmail}", 210, 760, 8.5);
        Rule(706);

        CenteredText("EMPLOYEE PAYSLIP", 686, 14, true);

        // Employee details.
        var period = DateOnly.ParseExact(report.Period + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture);
        var payDate = report.FinalisedUtc is { } finalised ? PdfText.CompanyTime(finalised).ToString("dd MMM yyyy", CultureInfo.InvariantCulture) : "";
        var rows = new[]
        {
            ("Employee Name", line.WorkerName, "Employee No.", line.WorkerCode),
            ("Job Title", line.Designation, "Pay Period", period.ToString("MMMM yyyy", CultureInfo.InvariantCulture)),
            ("Join Date", joinDate?.ToString("dd MMM yyyy", CultureInfo.InvariantCulture) ?? "-", "Payment Date", payDate),
        };
        var top = 664.0;
        for (var i = 0; i < rows.Length; i++)
        {
            var baseline = top - i * 22 - 14;
            var (l1, v1, l2, v2) = rows[i];
            Text(l1, Left + 4, baseline, 9, true);
            Text(v1, 140, baseline);
            Text(l2, 330, baseline, 9, true);
            Text(v2, 430, baseline);
            Rule(top - (i + 1) * 22);
        }

        // Earnings.
        var y = 580.0;
        Text("EARNINGS", Left, y, 10, true);
        y -= 8;
        void Table(string[] headings, double[] widths, IReadOnlyList<string[]> body, string[]? totalRow)
        {
            var columnX = new double[widths.Length];
            var x = Left;
            for (var c = 0; c < widths.Length; c++) { columnX[c] = x; x += widths[c]; }
            void Cells(string[] cells, bool strong)
            {
                for (var c = 0; c < cells.Length; c++)
                {
                    if (c == cells.Length - 1 && cells.Length == 3) RightText(cells[c], columnX[c] + widths[c] - 4, y - 14, 9, strong);
                    else Text(cells[c], columnX[c] + 4, y - 14, 9, strong);
                }
                y -= 20;
                Rule(y);
            }
            Cells(headings, true);
            foreach (var row in body) Cells(row, false);
            if (totalRow is not null) Cells(totalRow, true);
        }
        var widthsThree = new double[] { 150, 273, 100 };
        Table(["Description", "Calculation", "Amount (AED)"], widthsThree, [
            ["Basic Salary", $"Hourly rate AED {line.HourlyRate.ToString("N2", CultureInfo.InvariantCulture)} x {line.BasicHours.ToString("N2", CultureInfo.InvariantCulture)} hrs",
                PdfText.Number(line.BasicPay)],
            ["Overtime (OT)", $"OT hours {line.OvertimeHours.ToString("N2", CultureInfo.InvariantCulture)} x AED {line.OvertimeRate.ToString("N2", CultureInfo.InvariantCulture)}",
                PdfText.Number(line.OvertimePay)],
        ], ["Gross Earnings", "Basic + OT", PdfText.Number(line.TotalPay)]);

        // Deductions.
        y -= 14;
        Text("DEDUCTIONS", Left, y, 10, true);
        y -= 8;
        var deductionRows = (line.Deductions ?? []).Select(d => new[] { d.Name, d.Note, PdfText.Number(d.Amount) }).ToList();
        if (deductionRows.Count == 0) deductionRows.Add(["No deductions this month", "-", PdfText.Number(0)]);
        Table(["Description", "Reason", "Amount (AED)"], widthsThree, deductionRows, ["Total Deductions", "", PdfText.Number(line.TotalDeductions)]);

        // Net salary payable.
        y -= 30;
        var boxTop = y + 8;
        var boxBottom = y - 26;
        Rule(boxTop);
        Rule(boxBottom);
        page.DrawLine(new PdfPoint(Left, boxTop), new PdfPoint(Left, boxBottom), .6);
        page.DrawLine(new PdfPoint(Right, boxTop), new PdfPoint(Right, boxBottom), .6);
        Text("NET SALARY PAYABLE", Left + 8, y - 8, 11, true);
        RightText("AED " + PdfText.Number(line.NetPay), Right - 8, y - 8, 11, true);

        // Acknowledgment and signatures.
        y = boxBottom - 40;
        Text("Employee Acknowledgment: ", Left, y, 9, true);
        Text("I confirm that I have received the salary stated above for the indicated pay period.", Left + 150, y, 9);
        y -= 46;
        Text("Employee Signature:", Left, y);
        page.DrawLine(new PdfPoint(140, y - 2), new PdfPoint(290, y - 2), .5);
        Text("Authorized Signature:", 310, y);
        page.DrawLine(new PdfPoint(420, y - 2), new PdfPoint(Right, y - 2), .5);
        y -= 34;
        Text("Date:", Left, y);
        page.DrawLine(new PdfPoint(70, y - 2), new PdfPoint(200, y - 2), .5);
        Text("Company Stamp:", 310, y);
        page.DrawLine(new PdfPoint(395, y - 2), new PdfPoint(Right, y - 2), .5);

        Text($"Payslip for {line.WorkerCode} | {report.Period} | {report.Status}", Left, 28, 8);
    }
}
