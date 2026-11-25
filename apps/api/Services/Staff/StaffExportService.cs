using System.Globalization;
using ClosedXML.Excel;
using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;
using UglyToad.PdfPig.Content;
using UglyToad.PdfPig.Writer;

namespace HrPayroll.Api.Services.Staff;

/// <summary>Excel and PDF downloads of the office attendance report and the leave balance report.</summary>
public sealed class StaffExportService(
    AppDbContext db, StaffAttendanceService attendance, StaffLeaveService leave, Microsoft.Extensions.Configuration.IConfiguration configuration)
{
    public sealed record Table(string Title, string Subtitle, string FileStem, (string Title, double Weight, bool Right)[] Columns, List<string[]> Rows, string[] Notes);

    public async Task<LeaveExportResult> AttendanceAsync(string? from, string? to, string? department, int? workerId, AttendanceExportFormat format, CancellationToken ct)
    {
        var result = await attendance.ReportAsync(from, to, department, workerId, ct);
        if (result.Status != 200) return new(result.Status, Errors: result.Errors);
        var report = result.Value!;
        var table = new Table("STAFF ATTENDANCE REPORT",
            $"{Date(report.From)} to {Date(report.To)}{(string.IsNullOrWhiteSpace(department) ? "" : "  |  " + department)}",
            $"Staff_Attendance_{report.From}_{report.To}",
            [("ID", 0.8, false), ("EMPLOYEE", 2.2, false), ("DEPT", 1.4, false), ("PRESENT", 0.8, true), ("LATE", 0.6, true), ("LATE MIN", 0.8, true),
             ("EARLY MIN", 0.8, true), ("ABSENT", 0.8, true), ("LEAVE", 0.7, true), ("HOURS", 0.8, true)],
            report.Rows.Select(r => new[]
            {
                r.Code, r.Name, r.Department ?? "", N(r.PresentDays), N(r.LateDays), N(r.LateMinutes), N(r.EarlyLeaveMinutes),
                N(r.AbsentDays), N(r.LeaveDays), r.TotalHours.ToString("0.00", CultureInfo.InvariantCulture),
            }).ToList(),
            ["Total hours are the sum of all sign-in and sign-out pairs. Weekly off days and public holidays are not counted as absent."]);
        var detail = new Table("DAILY DETAIL", table.Subtitle, table.FileStem,
            [("DATE", 1, false), ("ID", 0.8, false), ("EMPLOYEE", 2, false), ("STATUS", 1.3, false), ("IN", 0.6, false), ("OUT", 0.6, false),
             ("HOURS", 0.7, true), ("LATE MIN", 0.8, true), ("EARLY MIN", 0.8, true), ("FLAGS", 1.4, false)],
            report.Days.Select(d => new[]
            {
                Date(d.Day.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)), d.Code, d.Name, d.Day.Status, d.Day.FirstIn ?? "", d.Day.LastOut ?? "",
                d.Day.Hours.ToString("0.00", CultureInfo.InvariantCulture), N(d.Day.LateMinutes), N(d.Day.EarlyLeaveMinutes),
                string.Join(", ", new[] { d.Day.OutsideOffice ? "Outside office" : null, d.Day.MissingSignOut ? "Missing sign-out" : null }.Where(x => x is not null)),
            }).ToList(), []);
        return await BuildAsync(table, detail, format, ct);
    }

    public async Task<LeaveExportResult> PayrollAsync(string? month, AttendanceExportFormat format, CancellationToken ct)
    {
        var result = await attendance.PayrollSummaryAsync(month, ct);
        if (result.Status != 200) return new(result.Status, Errors: result.Errors);
        var s = result.Value!;
        static string Money(decimal v) => v.ToString("0.00", CultureInfo.InvariantCulture);
        var rule = (s.DeductAbsentDays ? "Each absent day costs salary / 30. " : "") + (s.LateDeductionPerMinute > 0 ? $"Late arrival costs AED {Money(s.LateDeductionPerMinute)} per minute. " : "");
        var table = new Table("STAFF PAYROLL SUMMARY", s.Label, $"Staff_Payroll_{s.Month}",
            [("ID", 0.8, false), ("EMPLOYEE", 2.1, false), ("SALARY", 1, true), ("WORK DAYS", 0.8, true), ("PRESENT", 0.8, true), ("ABSENT", 0.7, true),
             ("LEAVE", 0.6, true), ("LATE MIN", 0.7, true), ("DEDUCT", 0.9, true), ("NET (AED)", 1, true)],
            s.Rows.Select(r => new[]
            {
                r.Code, r.Name, Money(r.MonthlySalary), N(r.WorkingDays), N(r.PresentDays), N(r.AbsentDays), N(r.LeaveDays), N(r.LateMinutes),
                Money(r.AbsentDeduction + r.LateDeduction + r.OtherDeduction), Money(r.NetSalary),
            }).Append(["", "Total", Money(s.TotalSalary), "", "", "", "", "", Money(s.TotalDeductions), Money(s.TotalNet)]).ToList(),
            [rule.Length == 0 ? "No attendance deductions are applied." : rule.Trim(), "Advances, loans and other deductions entered on the Deductions page are included in DEDUCT."]);
        return await BuildAsync(table, new Table("DETAIL", table.Subtitle, table.FileStem, table.Columns, table.Rows, []), format, ct);
    }

    public async Task<LeaveExportResult> LeaveBalancesAsync(int? year, string? department, AttendanceExportFormat format, CancellationToken ct)
    {
        var y = year ?? DateTime.UtcNow.Year;
        var rows = await leave.AllBalancesAsync(y, department, ct);
        var types = rows.SelectMany(r => r.Balances).GroupBy(b => b.LeaveTypeId).Select(g => (g.Key, g.First().LeaveType)).OrderBy(t => t.Key).ToList();
        var columns = new List<(string, double, bool)> { ("ID", 0.8, false), ("EMPLOYEE", 2.2, false), ("DEPT", 1.3, false) };
        columns.AddRange(types.Select(t => (t.LeaveType.ToUpperInvariant() + " USED/LEFT", 1.4, true)));
        var body = rows.Select(r =>
        {
            var cells = new List<string> { r.Code, r.Name, r.Department ?? "" };
            cells.AddRange(types.Select(t => r.Balances.FirstOrDefault(b => b.LeaveTypeId == t.Key) is { } b ? $"{b.Used} / {b.Remaining}" : "-"));
            return cells.ToArray();
        }).ToList();
        var table = new Table("STAFF LEAVE BALANCES", $"Year {y}{(string.IsNullOrWhiteSpace(department) ? "" : "  |  " + department)}", $"Staff_Leave_{y}",
            columns.ToArray(), body, ["Used counts approved leave only; pending requests are not deducted until approved."]);

        var requests = await leave.ListAsync(null, null, department, y, ct);
        var detail = new Table("LEAVE REQUESTS", table.Subtitle, table.FileStem,
            [("ID", 0.8, false), ("EMPLOYEE", 2, false), ("TYPE", 1.4, false), ("FROM", 1, false), ("TO", 1, false), ("DAYS", 0.5, true), ("STATUS", 0.9, false), ("DECIDED BY", 1.1, false)],
            requests.Select(r => new[] { r.Code, r.Name, r.LeaveType, Date(r.StartDate), Date(r.EndDate), N(r.Days), r.Status, r.DecidedBy ?? "" }).ToList(), []);
        return await BuildAsync(table, detail, format, ct);
    }

    /// <summary>The letterhead details every export prints.</summary>
    public async Task<PayrollCompany> CompanyAsync(CancellationToken ct)
    {
        var s = await db.PayrollSettings.AsNoTracking().SingleAsync(x => x.Id == PayrollSettings.SingletonId, ct);
        return new PayrollCompany(s.CompanyName, s.Tagline, s.ContactEmail, s.PreparedByLabel, s.ApprovedByLabel);
    }

    private async Task<LeaveExportResult> BuildAsync(Table main, Table detail, AttendanceExportFormat format, CancellationToken ct)
    {
        var company = await CompanyAsync(ct);
        return format == AttendanceExportFormat.Pdf
            ? new(200, BuildPdf(main, company), main.FileStem + ".pdf", AttendanceExportService.PdfType)
            : new(200, BuildExcel(main, detail, company), main.FileStem + ".xlsx", AttendanceExportService.ExcelType);
    }

    private static string N(int value) => value.ToString(CultureInfo.InvariantCulture);
    private static string Date(string iso) => DateOnly.TryParseExact(iso, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)
        ? d.ToString("dd MMM yyyy", CultureInfo.InvariantCulture) : iso;

    // --- Excel -------------------------------------------------------------------------------------------------

    private static byte[] BuildExcel(Table main, Table detail, PayrollCompany company) =>
        Workbook([("Summary", main), ("Detail", detail)], company);

    /// <summary>One styled sheet per table, in the company's letterhead colours.</summary>
    public static byte[] Workbook(IReadOnlyList<(string Name, Table Table)> sheets, PayrollCompany company)
    {
        using var book = new XLWorkbook();
        foreach (var (name, table) in sheets) Sheet(book.AddWorksheet(name), table, company);
        using var stream = new MemoryStream();
        book.SaveAs(stream);
        return stream.ToArray();
    }

    private static void Sheet(IXLWorksheet sheet, Table t, PayrollCompany company)
    {
        sheet.Cell(1, 1).Value = company.CompanyName;
        sheet.Cell(1, 1).Style.Font.SetBold().Font.SetFontSize(14).Font.SetFontColor(XLColor.FromHtml("#134E52"));
        sheet.Cell(2, 1).Value = t.Title;
        sheet.Cell(2, 1).Style.Font.SetBold().Font.SetFontSize(12);
        sheet.Cell(3, 1).Value = t.Subtitle;
        const int headerRow = 5;
        for (var c = 0; c < t.Columns.Length; c++)
        {
            var cell = sheet.Cell(headerRow, c + 1);
            cell.Value = t.Columns[c].Title;
            cell.Style.Font.SetBold().Font.SetFontColor(XLColor.White);
            cell.Style.Fill.SetBackgroundColor(XLColor.FromHtml("#134E52"));
        }

        for (var i = 0; i < t.Rows.Count; i++)
        {
            for (var c = 0; c < t.Columns.Length; c++)
            {
                var text = t.Rows[i][c];
                var cell = sheet.Cell(headerRow + 1 + i, c + 1);
                if (t.Columns[c].Right && decimal.TryParse(text, NumberStyles.Number, CultureInfo.InvariantCulture, out var number))
                {
                    cell.Value = number;
                    if (text.Contains('.')) cell.Style.NumberFormat.Format = "#,##0.00";
                }
                else cell.Value = text;
                if (t.Columns[c].Right) cell.Style.Alignment.SetHorizontal(XLAlignmentHorizontalValues.Right);
            }
            if (i % 2 == 1) sheet.Range(headerRow + 1 + i, 1, headerRow + 1 + i, t.Columns.Length).Style.Fill.SetBackgroundColor(XLColor.FromHtml("#F0F4F5"));
        }

        if (t.Rows.Count == 0) sheet.Cell(headerRow + 1, 1).Value = "No records for this period.";
        var note = headerRow + t.Rows.Count + 2;
        foreach (var n in t.Notes) sheet.Cell(note++, 1).Value = n;
        sheet.Columns().AdjustToContents(headerRow, headerRow + t.Rows.Count);
        sheet.SheetView.FreezeRows(headerRow);
        sheet.PageSetup.PageOrientation = XLPageOrientation.Landscape;
        sheet.PageSetup.FitToPages(1, 0);
    }

    // --- PDF ---------------------------------------------------------------------------------------------------

    private const double Left = PdfLetterhead.Left;
    private const double Right = PdfLetterhead.Right;
    private const double RowHeight = 21;
    private const double BottomMargin = 72;

    private const string StaffFooter = "Confidential: staff record for internal company use only.";

    private byte[] BuildPdf(Table t, PayrollCompany company) => BuildPdf([t], company, StaffFooter);

    /// <summary>A letterhead page with each table in turn; the first table's title and subtitle head the document, later tables get a section heading.</summary>
    public byte[] BuildPdf(IReadOnlyList<Table> tables, PayrollCompany company, string footer)
    {
        foreach (var table in tables) foreach (var row in table.Rows) foreach (var cell in row) PdfText.EnsurePrintable(cell);
        try
        {
            using var document = new PdfDocumentBuilder();
            var regular = document.AddTrueTypeFont(PdfText.Font("Regular"));
            var bold = document.AddTrueTypeFont(PdfText.Font("Bold"));
            var logo = PdfText.Asset("logo.png");
            var details = PdfText.Letterhead(configuration, company.ContactEmail);

            var pages = new List<PdfCanvas>();
            PdfCanvas NewPage()
            {
                var cv = new PdfCanvas(document.AddPage(PageSize.A4), regular, bold);
                pages.Add(cv);
                return cv;
            }

            static void Header(PdfCanvas cv, double y, Table t, double[] widths)
            {
                cv.Fill(Left, y - 22, Right - Left, 22, PdfStyle.Teal);
                var x = Left;
                for (var c = 0; c < t.Columns.Length; c++)
                {
                    var title = cv.Fit(t.Columns[c].Title, widths[c] - 8, 6.5, true);
                    if (t.Columns[c].Right) cv.RightText(title, x + widths[c] - 4, y - 14, 6.5, true, PdfStyle.White);
                    else cv.Text(title, x + 4, y - 14, 6.5, true, PdfStyle.White);
                    x += widths[c];
                }
            }

            var page = NewPage();
            var rule = PdfLetterhead.Draw(page, logo, company, details, tables[0].Title, tables[0].Subtitle, null);
            var yPos = rule - 16;

            for (var n = 0; n < tables.Count; n++)
            {
                var t = tables[n];
                var totalWeight = t.Columns.Sum(c => c.Weight);
                var widths = t.Columns.Select(c => (Right - Left) * c.Weight / totalWeight).ToArray();
                if (n > 0)
                {
                    if (yPos - 90 < BottomMargin) { page = NewPage(); yPos = 800; }
                    else yPos -= 14;
                    page.Text(t.Title, Left, yPos - 12, 9, true);
                    yPos -= 20;
                }

                Header(page, yPos, t, widths);
                yPos -= 22;
                if (t.Rows.Count == 0) { page.Text("No records for this period.", Left + 6, yPos - 20, 9, false, PdfStyle.Muted); yPos -= 28; }

                for (var i = 0; i < t.Rows.Count; i++)
                {
                    if (yPos - RowHeight < BottomMargin)
                    {
                        page = NewPage();
                        yPos = 800;
                        Header(page, yPos, t, widths);
                        yPos -= 22;
                    }

                    if (i % 2 == 1) page.Fill(Left, yPos - RowHeight, Right - Left, RowHeight, PdfStyle.Stripe);
                    var x = Left;
                    for (var c = 0; c < t.Columns.Length; c++)
                    {
                        var text = page.Fit(t.Rows[i][c], widths[c] - 8, 8);
                        if (t.Columns[c].Right) page.RightText(text, x + widths[c] - 4, yPos - 14, 8);
                        else page.Text(text, x + 4, yPos - 14, 8, c == 1);
                        x += widths[c];
                    }

                    page.Rule(Left, Right, yPos - RowHeight, 0.4, PdfStyle.Hairline);
                    yPos -= RowHeight;
                }

                foreach (var note in t.Notes)
                {
                    if (yPos - 16 < BottomMargin) { page = NewPage(); yPos = 800; }
                    page.Text(note, Left, yPos - 16, 7.2, false, PdfStyle.Muted);
                    yPos -= 12;
                }
            }

            for (var i = 0; i < pages.Count; i++)
            {
                pages[i].Rule(Left, Right, 58, 0.5, PdfStyle.Hairline);
                pages[i].Text(footer, Left, 44, 7, false, PdfStyle.Muted);
                pages[i].RightText($"Page {i + 1}", Right, 44, 7, false, PdfStyle.Muted);
            }

            return document.Build();
        }
        catch (InvalidOperationException ex) when (ex.Message.StartsWith("The font does not contain a character:", StringComparison.Ordinal))
        {
            throw new PdfTextNotSupportedException(ex);
        }
    }
}
