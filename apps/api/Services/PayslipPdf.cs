using System.Globalization;
using HrPayroll.Api.Dtos;
using Microsoft.Extensions.Configuration;
using UglyToad.PdfPig.Content;
using UglyToad.PdfPig.Writer;

namespace HrPayroll.Api.Services;

/// <summary>
/// One A4 payslip per worker, following the client's payslip template: employee details, earnings, deductions,
/// net salary payable, acknowledgment and signatures. Built only from a finalised month's snapshot.
/// </summary>
public sealed class PayslipPdf(IConfiguration configuration)
{
    private const double Left = PdfLetterhead.Left;
    private const double Right = PdfLetterhead.Right;

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
            var logo = PdfText.Asset("logo.png");
            foreach (var line in lines)
            {
                var page = document.AddPage(PageSize.A4);
                Draw(new PdfCanvas(page, regular, bold), report, line, joinDates.TryGetValue(line.WorkerId, out var joined) ? joined : null, logo);
            }
            return document.Build();
        }
        catch (InvalidOperationException ex) when (ex.Message.StartsWith("The font does not contain a character:", StringComparison.Ordinal))
        {
            throw new PdfTextNotSupportedException(ex);
        }
    }

    private void Draw(PdfCanvas cv, PayrollResponse report, PayrollLine line, DateOnly? joinDate, byte[] logo)
    {
        var details = PdfText.Letterhead(configuration, report.Company.ContactEmail);
        var period = DateOnly.ParseExact(report.Period + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture);
        var periodLabel = period.ToString("MMMM yyyy", CultureInfo.InvariantCulture);
        var rule = PdfLetterhead.Draw(cv, logo, report.Company, details, "PAYSLIP", periodLabel, null);

        // Employee details panel: label above value, two columns.
        var y = rule - 16;
        const double panelHeight = 92;
        cv.Fill(Left, y - panelHeight, Right - Left, panelHeight, PdfStyle.Panel);
        var payDate = report.FinalisedUtc is { } finalised ? PdfText.CompanyTime(finalised).ToString("dd MMM yyyy", CultureInfo.InvariantCulture) : "";
        var fields = new[]
        {
            ("EMPLOYEE NAME", line.WorkerName), ("EMPLOYEE NO.", line.WorkerCode),
            ("JOB TITLE", line.Designation), ("PAY PERIOD", periodLabel),
            ("JOIN DATE", joinDate?.ToString("dd MMM yyyy", CultureInfo.InvariantCulture) ?? "-"), ("PAYMENT DATE", payDate),
        };
        for (var i = 0; i < fields.Length; i++)
        {
            var x = Left + 14 + (i % 2) * 262;
            var baseline = y - 18 - (i / 2) * 28;
            cv.Text(fields[i].Item1, x, baseline, 6.8, true, PdfStyle.Muted);
            cv.Text(cv.Fit(fields[i].Item2, 235, 9.5, true), x, baseline - 12, 9.5, true);
        }
        y -= panelHeight + 24;

        var widths = new double[] { 150, 273, 100 };
        void Table(string title, string[] headings, IReadOnlyList<string[]> body, string[] totalRow)
        {
            cv.Text(title, Left, y, 9.5, true, PdfStyle.Teal);
            y -= 10;
            void Cells(string[] cells, double size, bool strong, IReadOnlyList<string>[] wrapped)
            {
                var x = Left;
                for (var col = 0; col < cells.Length; col++)
                {
                    for (var l = 0; l < wrapped[col].Count; l++)
                    {
                        var baseline = y - 14 - l * 12;
                        if (col == cells.Length - 1) cv.RightText(wrapped[col][l], x + widths[col] - 6, baseline, size, strong);
                        else cv.Text(wrapped[col][l], x + 6, baseline, size, strong);
                    }
                    x += widths[col];
                }
            }
            IReadOnlyList<string>[] Wrapped(string[] cells, double size, bool strong) =>
                cells.Select((v, i) => (IReadOnlyList<string>)cv.Wrap(v, widths[i] - 12, size, strong)).ToArray();

            cv.Fill(Left, y - 22, Right - Left, 22, PdfStyle.Panel);
            Cells(headings, 8, true, Wrapped(headings, 8, true));
            y -= 22;
            cv.Rule(Left, Right, y, 1.2, PdfStyle.Teal);
            foreach (var row in body)
            {
                var wrapped = Wrapped(row, 9, false);
                var rowHeight = wrapped.Max(w => w.Count) * 12 + 10;
                Cells(row, 9, false, wrapped);
                y -= rowHeight;
                cv.Rule(Left, Right, y, 0.4, PdfStyle.Hairline);
            }
            cv.Fill(Left, y - 22, Right - Left, 22, PdfStyle.Panel);
            cv.Rule(Left, Right, y, 0.8, PdfStyle.Teal);
            Cells(totalRow, 9, true, Wrapped(totalRow, 9, true));
            y -= 22;
            cv.Rule(Left, Right, y, 0.8, PdfStyle.Teal);
        }

        string Decimal(decimal value) => value.ToString("N2", CultureInfo.InvariantCulture);
        Table("EARNINGS", ["Description", "Calculation", "Amount (AED)"], [
            ["Basic Salary", $"Hourly rate AED {Decimal(line.HourlyRate)} x {Decimal(line.BasicHours)} hrs", PdfText.Number(line.BasicPay)],
            ["Overtime (OT)", $"OT hours {Decimal(line.OvertimeHours)} x AED {Decimal(line.OvertimeRate)}", PdfText.Number(line.OvertimePay)],
        ], ["Gross Earnings", "Basic + OT", PdfText.Number(line.TotalPay)]);

        y -= 26;
        var deductionRows = (line.Deductions ?? []).Select(d => new[] { d.Name, d.Note, PdfText.Number(d.Amount) }).ToList();
        if (deductionRows.Count == 0) deductionRows.Add(["No deductions this month", "-", PdfText.Number(0)]);
        Table("DEDUCTIONS", ["Description", "Reason", "Amount (AED)"], deductionRows, ["Total Deductions", "", PdfText.Number(line.TotalDeductions)]);

        // Net salary payable: the one solid band on the page.
        y -= 28;
        cv.Fill(Left, y - 46, Right - Left, 46, PdfStyle.Teal);
        cv.Text("NET SALARY PAYABLE", Left + 16, y - 20, 10.5, true, PdfStyle.White);
        cv.Text("Gross earnings less total deductions", Left + 16, y - 34, 7.6, false, PdfStyle.TealPale);
        cv.RightText("AED " + PdfText.Number(line.NetPay), Right - 16, y - 29, 16, true, PdfStyle.White);
        y -= 46;

        // Acknowledgment and signatures.
        y -= 36;
        cv.Text("Employee Acknowledgment", Left, y, 8.5, true, PdfStyle.Teal);
        y -= 14;
        cv.Text("I confirm that I have received the salary stated above for the indicated pay period.", Left, y, 8.5);
        y -= 54;
        void SignatureLine(double x1, double x2, string label)
        {
            cv.Rule(x1, x2, y, 0.6, PdfStyle.Ink);
            cv.Text(label, x1, y - 11, 7.6, false, PdfStyle.Muted);
        }
        SignatureLine(Left, 266, "Employee Signature");
        SignatureLine(310, Right, "Authorized Signature");
        y -= 50;
        SignatureLine(Left, 266, "Date");
        SignatureLine(310, Right, "Company Stamp");

        cv.Rule(Left, Right, 58, 0.5, PdfStyle.Hairline);
        cv.Text("Confidential: this payslip is issued to the named employee only.", Left, 44, 7, false, PdfStyle.Muted);
        cv.RightText($"Payslip for {line.WorkerCode}  |  {report.Period}  |  {report.Status}", Right, 44, 7, false, PdfStyle.Muted);
    }
}
