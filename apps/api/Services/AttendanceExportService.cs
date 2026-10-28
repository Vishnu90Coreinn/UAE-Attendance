using System.Globalization;
using ClosedXML.Excel;
using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;
using UglyToad.PdfPig.Content;
using UglyToad.PdfPig.Writer;

namespace HrPayroll.Api.Services;

public enum AttendanceExportFormat
{
    Pdf,
    Excel,
}

public sealed record AttendanceExportResult(
    int StatusCode, byte[]? File = null, string? FileName = null, string? ContentType = null,
    Dictionary<string, string[]>? Errors = null);

/// <summary>
/// The saved attendance for one day as a printable PDF or an Excel sheet. Pay columns follow the same rule as the
/// attendance screen: they are left out for callers who may not see wages.
/// </summary>
public sealed class AttendanceExportService(
    AttendanceService attendance, WageRedactor wages, AppDbContext db, Microsoft.Extensions.Configuration.IConfiguration configuration)
{
    public const string PdfType = "application/pdf";
    public const string ExcelType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    public async Task<AttendanceExportResult> ExportAsync(string? date, AttendanceExportFormat format, CancellationToken ct)
    {
        var result = await attendance.GetAsync(date, ct);
        if (result.Day is null) return new(result.StatusCode, Errors: result.Errors);

        var day = wages.Apply(result.Day);
        return await BuildAsync([day], $"Attendance_{day.Date:yyyy-MM-dd}", format, ct);
    }

    private async Task<AttendanceExportResult> BuildAsync(List<AttendanceDayResponse> days, string stem, AttendanceExportFormat format, CancellationToken ct)
    {
        var showPay = !wages.HidesWages;
        var s = await db.PayrollSettings.AsNoTracking().SingleAsync(x => x.Id == PayrollSettings.SingletonId, ct);
        var company = new PayrollCompany(s.CompanyName, s.Tagline, s.ContactEmail, s.PreparedByLabel, s.ApprovedByLabel);

        return format == AttendanceExportFormat.Pdf
            ? new(200, BuildPdf(days, company, showPay), $"{stem}.pdf", PdfType)
            : new(200, BuildExcel(days, company, showPay), $"{stem}.xlsx", ExcelType);
    }

    public const int MaxRangeDays = 62;

    /// <summary>Every day in the range in one PDF (each day on its own page) or one Excel workbook (a sheet per day).</summary>
    public async Task<AttendanceExportResult> ExportRangeAsync(string? from, string? to, AttendanceExportFormat format, CancellationToken ct)
    {
        var errors = new Dictionary<string, string[]>();
        if (!TryDate(from, out var start)) errors["from"] = ["Choose a valid start date."];
        if (!TryDate(to, out var end)) errors["to"] = ["Choose a valid end date."];
        if (errors.Count == 0 && end < start) errors["to"] = ["The end date must be on or after the start date."];
        if (errors.Count == 0 && end.DayNumber - start.DayNumber + 1 > MaxRangeDays)
            errors["to"] = [$"Choose a range of at most {MaxRangeDays} days."];
        if (errors.Count > 0) return new(400, Errors: errors);

        var days = new List<AttendanceDayResponse>();
        for (var date = start; date <= end; date = date.AddDays(1))
        {
            var result = await attendance.GetAsync(date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), ct);
            if (result.Day is null) return new(result.StatusCode, Errors: result.Errors);
            days.Add(wages.Apply(result.Day));
        }

        return await BuildAsync(days, $"Attendance_{start:yyyy-MM-dd}_to_{end:yyyy-MM-dd}", format, ct);
    }

    private static bool TryDate(string? text, out DateOnly date) =>
        DateOnly.TryParseExact(text, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out date);

    // --- shared row model -------------------------------------------------------------------------------------

    private sealed record Line(string Code, string Name, string Designation, string Status, decimal? Basic, decimal? Overtime,
        string Approval, decimal? Pay);

    private static List<Line> Lines(AttendanceDayResponse day) =>
        day.Rows.Select(row =>
        {
            var record = row.Record;
            var status = record?.Status ?? row.ApprovedLeave ?? "Not recorded";
            return new Line(row.Worker.WorkerCode, row.Worker.FullName, row.Worker.Designation, status,
                record?.BasicHours, record?.OvertimeHours, record?.ApprovalStatus ?? "-", row.DailyPay?.TotalPay);
        }).ToList();

    private static (int Present, int Absent, int Leave, int NotRecorded) Counts(List<Line> lines)
    {
        var present = lines.Count(l => l.Status == "Present");
        var absent = lines.Count(l => l.Status == "Absent");
        var notRecorded = lines.Count(l => l.Status == "Not recorded");
        return (present, absent, lines.Count - present - absent - notRecorded, notRecorded);
    }

    private static string DateLabel(DateOnly date) => date.ToString("dddd, dd MMMM yyyy", CultureInfo.InvariantCulture);

    // --- Excel ------------------------------------------------------------------------------------------------

    private static byte[] BuildExcel(List<AttendanceDayResponse> days, PayrollCompany company, bool showPay)
    {
        using var book = new XLWorkbook();
        if (days.Count == 1) AddDaySheet(book, days[0], "Attendance", company, showPay);
        else AddRangeSheet(book, days, company, showPay);

        using var stream = new MemoryStream();
        book.SaveAs(stream);
        return stream.ToArray();
    }

    /// <summary>Every day of a range on one sheet: one row per worker per day, so it can be filtered, sorted or pivoted.</summary>
    private static void AddRangeSheet(XLWorkbook book, List<AttendanceDayResponse> days, PayrollCompany company, bool showPay)
    {
        var sheet = book.AddWorksheet("Attendance");
        var lastColumn = showPay ? 10 : 9;
        var all = days.SelectMany(d => Lines(d).Select(l => (d.Date, Line: l))).ToList();
        var present = all.Count(a => a.Line.Status == "Present");
        var absent = all.Count(a => a.Line.Status == "Absent");
        var notRecorded = all.Count(a => a.Line.Status == "Not recorded");

        sheet.Cell(1, 1).Value = company.CompanyName;
        sheet.Cell(1, 1).Style.Font.SetBold().Font.SetFontSize(14).Font.SetFontColor(XLColor.FromHtml("#134E52"));
        sheet.Cell(2, 1).Value = "Attendance Report";
        sheet.Cell(2, 1).Style.Font.SetBold().Font.SetFontSize(12);
        sheet.Cell(3, 1).Value = $"{days[0].Date.ToString("dd MMMM yyyy", CultureInfo.InvariantCulture)} to {days[^1].Date.ToString("dd MMMM yyyy", CultureInfo.InvariantCulture)} · {days.Count} days";
        sheet.Cell(4, 1).Value =
            $"{present} present · {absent} absent · {all.Count - present - absent - notRecorded} on leave · {notRecorded} not recorded (worker-days)";
        sheet.Cell(4, 1).Style.Font.SetFontColor(XLColor.FromHtml("#626A70"));

        var headers = new List<string> { "Date", "Day", "Worker ID", "Name", "Designation", "Status", "Basic hours", "Overtime hours", "Approval" };
        if (showPay) headers.Add("Daily pay (AED)");
        const int headerRow = 6;
        for (var c = 0; c < headers.Count; c++)
        {
            var cell = sheet.Cell(headerRow, c + 1);
            cell.Value = headers[c];
            cell.Style.Font.SetBold().Font.SetFontColor(XLColor.White);
            cell.Style.Fill.SetBackgroundColor(XLColor.FromHtml("#134E52"));
        }

        var payColumn = headers.Count;
        for (var i = 0; i < all.Count; i++)
        {
            var (date, line) = all[i];
            var r = headerRow + 1 + i;
            sheet.Cell(r, 1).Value = date.ToDateTime(TimeOnly.MinValue);
            sheet.Cell(r, 2).Value = date.ToString("ddd", CultureInfo.InvariantCulture);
            sheet.Cell(r, 3).Value = line.Code;
            sheet.Cell(r, 4).Value = line.Name;
            sheet.Cell(r, 5).Value = line.Designation;
            sheet.Cell(r, 6).Value = line.Status;
            if (line.Basic is { } basic) sheet.Cell(r, 7).Value = basic;
            if (line.Overtime is { } overtime) sheet.Cell(r, 8).Value = overtime;
            sheet.Cell(r, 9).Value = line.Approval;
            if (showPay && line.Pay is { } pay) sheet.Cell(r, payColumn).Value = pay;
            // Alternate shading by day (not by row) so each day reads as a block.
            if ((date.DayNumber - days[0].Date.DayNumber) % 2 == 1)
                sheet.Range(r, 1, r, lastColumn).Style.Fill.SetBackgroundColor(XLColor.FromHtml("#F0F4F5"));
        }

        var lastRow = headerRow + all.Count;
        if (all.Count > 0)
        {
            sheet.Range(headerRow + 1, 1, lastRow, 1).Style.DateFormat.SetFormat("dd-mmm-yyyy");
            sheet.Range(headerRow + 1, 7, lastRow, 8).Style.NumberFormat.SetFormat("0.00");
            if (showPay) sheet.Range(headerRow + 1, payColumn, lastRow, payColumn).Style.NumberFormat.SetFormat("#,##0.00");
            sheet.Range(headerRow, 1, lastRow, lastColumn).SetAutoFilter();

            var totals = lastRow + 1;
            sheet.Cell(totals, 6).Value = "Total";
            sheet.Cell(totals, 7).FormulaA1 = $"SUBTOTAL(109,G{headerRow + 1}:G{lastRow})";
            sheet.Cell(totals, 8).FormulaA1 = $"SUBTOTAL(109,H{headerRow + 1}:H{lastRow})";
            sheet.Range(totals, 7, totals, 8).Style.NumberFormat.SetFormat("0.00");
            if (showPay)
            {
                sheet.Cell(totals, payColumn).FormulaA1 = $"SUBTOTAL(109,{sheet.Cell(headerRow + 1, payColumn).Address.ColumnLetter}{headerRow + 1}:{sheet.Cell(lastRow, payColumn).Address.ColumnLetter}{lastRow})";
                sheet.Cell(totals, payColumn).Style.NumberFormat.SetFormat("#,##0.00");
            }
            sheet.Range(totals, 1, totals, lastColumn).Style.Font.SetBold().Border.SetTopBorder(XLBorderStyleValues.Medium);
        }

        sheet.Range(headerRow, 7, lastRow + 1, 8).Style.Alignment.SetHorizontal(XLAlignmentHorizontalValues.Right);
        if (showPay) sheet.Range(headerRow, payColumn, lastRow + 1, payColumn).Style.Alignment.SetHorizontal(XLAlignmentHorizontalValues.Right);
        sheet.Columns().AdjustToContents(headerRow, lastRow + 1);
        sheet.SheetView.FreezeRows(headerRow);
        sheet.PageSetup.PageOrientation = XLPageOrientation.Landscape;
        sheet.PageSetup.FitToPages(1, 0);
        sheet.PageSetup.SetRowsToRepeatAtTop(headerRow, headerRow);
    }

    private static void AddDaySheet(XLWorkbook book, AttendanceDayResponse day, string sheetName, PayrollCompany company, bool showPay)
    {
        var lines = Lines(day);
        var (present, absent, leave, notRecorded) = Counts(lines);

        var sheet = book.AddWorksheet(sheetName);
        var lastColumn = showPay ? 9 : 8;

        sheet.Cell(1, 1).Value = company.CompanyName;
        sheet.Cell(1, 1).Style.Font.SetBold().Font.SetFontSize(14).Font.SetFontColor(XLColor.FromHtml("#134E52"));
        sheet.Cell(2, 1).Value = "Daily Attendance";
        sheet.Cell(2, 1).Style.Font.SetBold().Font.SetFontSize(12);
        sheet.Cell(3, 1).Value = DateLabel(day.Date);
        sheet.Cell(4, 1).Value =
            $"{present} present · {absent} absent · {leave} on leave · {notRecorded} not recorded" + (day.IsFinalised ? " · Month finalised" : "");
        sheet.Cell(4, 1).Style.Font.SetFontColor(XLColor.FromHtml("#626A70"));

        var headers = new List<string> { "#", "Worker ID", "Name", "Designation", "Status", "Basic hours", "Overtime hours", "Approval" };
        if (showPay) headers.Add("Daily pay (AED)");
        const int headerRow = 6;
        for (var c = 0; c < headers.Count; c++)
        {
            var cell = sheet.Cell(headerRow, c + 1);
            cell.Value = headers[c];
            cell.Style.Font.SetBold().Font.SetFontColor(XLColor.White);
            cell.Style.Fill.SetBackgroundColor(XLColor.FromHtml("#134E52"));
            cell.Style.Alignment.SetVertical(XLAlignmentVerticalValues.Center);
        }

        for (var i = 0; i < lines.Count; i++)
        {
            var line = lines[i];
            var r = headerRow + 1 + i;
            sheet.Cell(r, 1).Value = i + 1;
            sheet.Cell(r, 2).Value = line.Code;
            sheet.Cell(r, 3).Value = line.Name;
            sheet.Cell(r, 4).Value = line.Designation;
            sheet.Cell(r, 5).Value = line.Status;
            if (line.Basic is { } basic) sheet.Cell(r, 6).Value = basic;
            if (line.Overtime is { } overtime) sheet.Cell(r, 7).Value = overtime;
            sheet.Cell(r, 8).Value = line.Approval;
            if (showPay && line.Pay is { } pay) sheet.Cell(r, 9).Value = pay;
            if (i % 2 == 1) sheet.Range(r, 1, r, lastColumn).Style.Fill.SetBackgroundColor(XLColor.FromHtml("#F0F4F5"));
        }

        var lastRow = headerRow + lines.Count;
        if (lines.Count > 0)
        {
            sheet.Range(headerRow + 1, 6, lastRow, 7).Style.NumberFormat.SetFormat("0.00");
            if (showPay) sheet.Range(headerRow + 1, 9, lastRow, 9).Style.NumberFormat.SetFormat("#,##0.00");
            sheet.Range(headerRow, 1, lastRow, lastColumn).Style.Border.SetInsideBorder(XLBorderStyleValues.Hair)
                .Border.SetOutsideBorder(XLBorderStyleValues.Thin);

            var totals = lastRow + 1;
            sheet.Cell(totals, 5).Value = "Total";
            sheet.Cell(totals, 6).FormulaA1 = $"SUM(F{headerRow + 1}:F{lastRow})";
            sheet.Cell(totals, 7).FormulaA1 = $"SUM(G{headerRow + 1}:G{lastRow})";
            sheet.Range(totals, 6, totals, 7).Style.NumberFormat.SetFormat("0.00");
            if (showPay)
            {
                sheet.Cell(totals, 9).FormulaA1 = $"SUM(I{headerRow + 1}:I{lastRow})";
                sheet.Cell(totals, 9).Style.NumberFormat.SetFormat("#,##0.00");
            }
            sheet.Range(totals, 1, totals, lastColumn).Style.Font.SetBold().Border.SetTopBorder(XLBorderStyleValues.Medium);
        }

        sheet.Range(headerRow, 6, lastRow + 1, 7).Style.Alignment.SetHorizontal(XLAlignmentHorizontalValues.Right);
        if (showPay) sheet.Range(headerRow, 9, lastRow + 1, 9).Style.Alignment.SetHorizontal(XLAlignmentHorizontalValues.Right);
        sheet.Columns().AdjustToContents(headerRow, lastRow + 1);
        sheet.Column(1).Width = 5;
        sheet.SheetView.FreezeRows(headerRow);
        sheet.PageSetup.PageOrientation = XLPageOrientation.Landscape;
        sheet.PageSetup.FitToPages(1, 0);
        sheet.PageSetup.SetRowsToRepeatAtTop(headerRow, headerRow);
    }

    // --- PDF --------------------------------------------------------------------------------------------------

    private const double Left = PdfLetterhead.Left;
    private const double Right = PdfLetterhead.Right;
    private const double RowHeight = 21;
    private const double BottomMargin = 72;

    private byte[] BuildPdf(List<AttendanceDayResponse> days, PayrollCompany company, bool showPay)
    {
        foreach (var line in days.SelectMany(Lines))
        {
            PdfText.EnsurePrintable(line.Code);
            PdfText.EnsurePrintable(line.Name);
            PdfText.EnsurePrintable(line.Designation);
            PdfText.EnsurePrintable(line.Status);
        }

        try
        {
            using var document = new PdfDocumentBuilder();
            var regular = document.AddTrueTypeFont(PdfText.Font("Regular"));
            var bold = document.AddTrueTypeFont(PdfText.Font("Bold"));
            var logo = PdfText.Asset("logo.png");
            var details = PdfText.Letterhead(configuration, company.ContactEmail);

            // Column layout (left edge, width, right-aligned). The name column takes whatever the others leave.
            var columns = new List<(string Title, double Width, bool RightAlign)>
            {
                ("ID", 52, false), ("WORKER", 0, false), ("DESIGNATION", 92, false), ("STATUS", 70, false),
                ("BASIC", 38, true), ("OT", 34, true), ("APPROVAL", 62, false),
            };
            if (showPay) columns.Add(("PAY (AED)", 58, true));
            var nameIndex = 1;
            columns[nameIndex] = ("WORKER", Right - Left - columns.Sum(c => c.Width), false);

            var images = new Dictionary<byte[], PdfPageBuilder.AddedImage>();
            var pages = new List<(PdfCanvas Canvas, DateOnly Date)>();
            PdfCanvas NewPage(DateOnly date)
            {
                var cv = new PdfCanvas(document.AddPage(PageSize.A4), regular, bold, images);
                pages.Add((cv, date));
                return cv;
            }

            void Footer(PdfCanvas cv, DateOnly date, int number)
            {
                cv.Rule(Left, Right, 58, 0.5, PdfStyle.Hairline);
                cv.Text("Confidential: attendance record for internal company use only.", Left, 44, 7, false, PdfStyle.Muted);
                cv.RightText($"{date:yyyy-MM-dd}  |  Page {number}", Right, 44, 7, false, PdfStyle.Muted);
            }

            void TableHeader(PdfCanvas cv, double y)
            {
                cv.Fill(Left, y - 22, Right - Left, 22, PdfStyle.Teal);
                var x = Left;
                foreach (var (title, width, rightAlign) in columns)
                {
                    if (rightAlign) cv.RightText(title, x + width - 6, y - 14, 7, true, PdfStyle.White);
                    else cv.Text(title, x + 6, y - 14, 7, true, PdfStyle.White);
                    x += width;
                }
            }

            foreach (var day in days)
            {
                var lines = Lines(day);
                var (present, absent, leave, notRecorded) = Counts(lines);
                var page = NewPage(day.Date);
                var rule = PdfLetterhead.Draw(page, logo, company, details, "DAILY ATTENDANCE", DateLabel(day.Date), day.IsFinalised ? "FINALISED" : null);
                var y = rule - 16;

                // Day summary tiles.
                var tiles = new (string Label, int Value)[]
                {
                    ("PRESENT", present), ("ABSENT", absent), ("ON LEAVE", leave), ("NOT RECORDED", notRecorded),
                };
                var tileWidth = (Right - Left - 3 * 8) / 4;
                for (var i = 0; i < tiles.Length; i++)
                {
                    var x = Left + i * (tileWidth + 8);
                    page.Fill(x, y - 44, tileWidth, 44, PdfStyle.Panel);
                    page.Fill(x, y - 44, 3, 44, i == 0 ? PdfStyle.Teal : i == 1 ? PdfStyle.Amber : PdfStyle.Hairline);
                    page.Text(tiles[i].Label, x + 12, y - 16, 6.8, true, PdfStyle.Muted);
                    page.Text(tiles[i].Value.ToString(CultureInfo.InvariantCulture), x + 12, y - 37, 16, true);
                }
                y -= 44 + 20;

                TableHeader(page, y);
                y -= 22;

                if (lines.Count == 0)
                {
                    page.Text("No workers for this date.", Left + 6, y - 20, 9, false, PdfStyle.Muted);
                }

                for (var i = 0; i < lines.Count; i++)
                {
                    if (y - RowHeight < BottomMargin)
                    {
                        page = NewPage(day.Date);
                        y = 800;
                        TableHeader(page, y);
                        y -= 22;
                    }

                    var line = lines[i];
                    if (i % 2 == 1) page.Fill(Left, y - RowHeight, Right - Left, RowHeight, PdfStyle.Stripe);
                    var cells = new List<string>
                    {
                        line.Code, line.Name, line.Designation, line.Status,
                        line.Basic is { } b ? PdfText.Number(b) : "-", line.Overtime is { } o ? PdfText.Number(o) : "-", line.Approval,
                    };
                    if (showPay) cells.Add(line.Pay is { } p ? PdfText.Number(p) : "-");

                    var x = Left;
                    for (var c = 0; c < columns.Count; c++)
                    {
                        var (_, width, rightAlign) = columns[c];
                        var text = page.Fit(cells[c], width - 12, 8.5, c == nameIndex);
                        var muted = c == 3 && line.Status == "Not recorded";
                        var color = muted ? PdfStyle.Muted : line.Status == "Absent" && c == 3 ? PdfStyle.Amber : PdfStyle.Ink;
                        if (rightAlign) page.RightText(text, x + width - 6, y - 14, 8.5, false, color);
                        else page.Text(text, x + (c == 6 ? 16 : 6), y - 14, 8.5, c == nameIndex || c == 3, color);
                        x += width;
                    }
                    page.Rule(Left, Right, y - RowHeight, 0.4, PdfStyle.Hairline);
                    y -= RowHeight;
                }

                // Totals row, then signatures if there is room.
                if (lines.Count > 0)
                {
                    if (y - 24 < BottomMargin)
                    {
                        page = NewPage(day.Date);
                        y = 800;
                    }

                    page.Fill(Left, y - 24, Right - Left, 24, PdfStyle.Panel);
                    page.Rule(Left, Right, y, 0.8, PdfStyle.Teal);
                    var x = Left;
                    for (var c = 0; c < columns.Count; c++)
                    {
                        var (_, width, _) = columns[c];
                        if (c == 3) page.Text("TOTAL", x + 6, y - 15, 8.5, true);
                        if (c == 4) page.RightText(PdfText.Number(lines.Sum(l => l.Basic ?? 0)), x + width - 6, y - 15, 8.5, true);
                        if (c == 5) page.RightText(PdfText.Number(lines.Sum(l => l.Overtime ?? 0)), x + width - 6, y - 15, 8.5, true);
                        if (showPay && c == columns.Count - 1) page.RightText(PdfText.Number(lines.Sum(l => l.Pay ?? 0)), x + width - 6, y - 15, 8.5, true);
                        x += width;
                    }
                    y -= 24;
                }

                if (y - 90 < BottomMargin)
                {
                    page = NewPage(day.Date);
                    y = 800;
                }
                var signatureY = Math.Max(y - 56, BottomMargin + 30);
                page.Rule(Left, 266, signatureY, 0.6, PdfStyle.Ink);
                page.Text("Prepared by (Supervisor)", Left, signatureY - 11, 7.6, false, PdfStyle.Muted);
                page.Rule(310, Right, signatureY, 0.6, PdfStyle.Ink);
                page.Text("Approved by (Manager)", 310, signatureY - 11, 7.6, false, PdfStyle.Muted);

            }

            for (var i = 0; i < pages.Count; i++) Footer(pages[i].Canvas, pages[i].Date, i + 1);
            return document.Build();
        }
        catch (InvalidOperationException ex) when (ex.Message.StartsWith("The font does not contain a character:", StringComparison.Ordinal))
        {
            throw new PdfTextNotSupportedException(ex);
        }
    }
}
