using System.Globalization;
using HrPayroll.Api.Dtos;
using Microsoft.Extensions.Configuration;
using UglyToad.PdfPig.Content;
using UglyToad.PdfPig.Writer;

namespace HrPayroll.Api.Services.Staff;

/// <summary>Everything printed on one office employee's payslip.</summary>
public sealed record StaffPayslipData(
    StaffPayrollRow Row, string Designation, DateOnly? JoinDate, string MonthLabel, string Month, bool MonthToDate, bool DeductAbsent, decimal LateRate);

/// <summary>
/// One A4 payslip per office employee, in the same layout as the site workers' payslip: details, earnings, deductions,
/// net salary payable, acknowledgment and signatures. It also shows the attendance the month's figures come from.
/// </summary>
public sealed class StaffPayslipPdf(IConfiguration configuration)
{
    private const double Left = PdfLetterhead.Left;
    private const double Right = PdfLetterhead.Right;

    public byte[] Generate(PayrollCompany company, IReadOnlyList<StaffPayslipData> slips)
    {
        foreach (var s in slips)
        {
            PdfText.EnsurePrintable(s.Row.Name);
            PdfText.EnsurePrintable(s.Designation);
            PdfText.EnsurePrintable(s.Row.Department ?? "");
        }

        try
        {
            using var document = new PdfDocumentBuilder();
            var regular = document.AddTrueTypeFont(PdfText.Font("Regular"));
            var bold = document.AddTrueTypeFont(PdfText.Font("Bold"));
            var logo = PdfText.Asset("logo.png");
            foreach (var slip in slips)
                Draw(new PdfCanvas(document.AddPage(PageSize.A4), regular, bold), company, slip, logo);
            return document.Build();
        }
        catch (InvalidOperationException ex) when (ex.Message.StartsWith("The font does not contain a character:", StringComparison.Ordinal))
        {
            throw new PdfTextNotSupportedException(ex);
        }
    }

    private void Draw(PdfCanvas cv, PayrollCompany company, StaffPayslipData slip, byte[] logo)
    {
        var r = slip.Row;
        var details = PdfText.Letterhead(configuration, company.ContactEmail);
        var rule = PdfLetterhead.Draw(cv, logo, company, details, "PAYSLIP", slip.MonthLabel, slip.MonthToDate ? "MONTH TO DATE" : null);

        var y = rule - 16;
        const double panelHeight = 92;
        cv.Fill(Left, y - panelHeight, Right - Left, panelHeight, PdfStyle.Panel);
        var fields = new[]
        {
            ("EMPLOYEE NAME", r.Name), ("EMPLOYEE NO.", r.Code),
            ("JOB TITLE", slip.Designation), ("PAY PERIOD", slip.MonthLabel),
            ("JOIN DATE", slip.JoinDate?.ToString("dd MMM yyyy", CultureInfo.InvariantCulture) ?? "-"), ("DEPARTMENT", string.IsNullOrWhiteSpace(r.Department) ? "-" : r.Department!),
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

        static string Money(decimal v) => PdfText.Number(v);
        Table("EARNINGS", ["Description", "Calculation", "Amount (AED)"],
            [["Monthly Salary", "Fixed monthly salary", Money(r.MonthlySalary)]],
            ["Gross Earnings", "", Money(r.MonthlySalary)]);

        y -= 26;
        var deductions = new List<string[]>();
        if (r.AbsentDeduction > 0) deductions.Add(["Absence", $"{r.AbsentDays} absent day(s) x salary / 30", Money(r.AbsentDeduction)]);
        if (r.LateDeduction > 0) deductions.Add(["Late arrival", $"{r.LateMinutes} min x AED {Money(slip.LateRate)}", Money(r.LateDeduction)]);
        foreach (var item in r.OtherItems ?? []) deductions.Add([item.Type, item.Reason, Money(item.Amount)]);
        if (deductions.Count == 0) deductions.Add(["No deductions this month", "-", Money(0)]);
        Table("DEDUCTIONS", ["Description", "Reason", "Amount (AED)"], deductions, ["Total Deductions", "", Money(r.AbsentDeduction + r.LateDeduction + r.OtherDeduction)]);

        // The attendance the figures come from, so the employee can see why.
        y -= 26;
        cv.Text("ATTENDANCE", Left, y, 9.5, true, PdfStyle.Teal);
        y -= 14;
        var facts = new[]
        {
            ("WORKING DAYS", r.WorkingDays.ToString(CultureInfo.InvariantCulture)), ("PRESENT", r.PresentDays.ToString(CultureInfo.InvariantCulture)),
            ("ABSENT", r.AbsentDays.ToString(CultureInfo.InvariantCulture)), ("ON LEAVE", r.LeaveDays.ToString(CultureInfo.InvariantCulture)),
            ("LATE (MIN)", r.LateMinutes.ToString(CultureInfo.InvariantCulture)), ("HOURS", r.TotalHours.ToString("0.0", CultureInfo.InvariantCulture)),
        };
        var cell = (Right - Left) / facts.Length;
        for (var i = 0; i < facts.Length; i++)
        {
            cv.Text(facts[i].Item1, Left + i * cell + 6, y, 6.6, true, PdfStyle.Muted);
            cv.Text(facts[i].Item2, Left + i * cell + 6, y - 13, 11, true);
        }

        y -= 38;
        cv.Fill(Left, y - 46, Right - Left, 46, PdfStyle.Teal);
        cv.Text("NET SALARY PAYABLE", Left + 16, y - 20, 10.5, true, PdfStyle.White);
        cv.Text("Gross earnings less total deductions", Left + 16, y - 34, 7.6, false, PdfStyle.TealPale);
        cv.RightText("AED " + Money(r.NetSalary), Right - 16, y - 29, 16, true, PdfStyle.White);
        y -= 46;

        y -= 34;
        cv.Text("Employee Acknowledgment", Left, y, 8.5, true, PdfStyle.Teal);
        y -= 14;
        cv.Text("I confirm that I have received the salary stated above for the indicated pay period.", Left, y, 8.5);
        y -= 50;
        void SignatureLine(double x1, double x2, string label)
        {
            cv.Rule(x1, x2, y, 0.6, PdfStyle.Ink);
            cv.Text(label, x1, y - 11, 7.6, false, PdfStyle.Muted);
        }

        SignatureLine(Left, 266, "Employee Signature");
        SignatureLine(310, Right, "Authorized Signature");
        y -= 46;
        SignatureLine(Left, 266, "Date");

        cv.Rule(Left, Right, 58, 0.5, PdfStyle.Hairline);
        cv.Text("Confidential: this payslip is issued to the named employee only.", Left, 44, 7, false, PdfStyle.Muted);
        cv.RightText($"Payslip for {r.Code}  |  {slip.Month}", Right, 44, 7, false, PdfStyle.Muted);
    }
}
