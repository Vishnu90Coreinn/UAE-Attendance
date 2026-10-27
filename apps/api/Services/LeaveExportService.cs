using System.Globalization;
using ClosedXML.Excel;
using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;
using UglyToad.PdfPig.Content;
using UglyToad.PdfPig.Writer;

namespace HrPayroll.Api.Services;

public sealed record LeaveExportResult(
    int StatusCode, byte[]? File = null, string? FileName = null, string? ContentType = null,
    Dictionary<string, string[]>? Errors = null);

/// <summary>
/// The leave requests that touch one calendar month, for every worker or a single one, as a printable PDF or an Excel sheet.
/// A request that spans two months appears in both, with the days that fall inside the month counted separately.
/// </summary>
public sealed class LeaveExportService(AppDbContext db, Microsoft.Extensions.Configuration.IConfiguration configuration)
{
    public async Task<LeaveExportResult> ExportAsync(string? month, string? workerId, AttendanceExportFormat format, CancellationToken ct)
    {
        var errors = new Dictionary<string, string[]>();
        if (!DateOnly.TryParseExact(month + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var first))
            errors["month"] = ["Enter a valid month in yyyy-MM format."];
        var id = 0;
        if (!string.IsNullOrEmpty(workerId) && (!int.TryParse(workerId, NumberStyles.None, CultureInfo.InvariantCulture, out id) || id <= 0))
            errors["workerId"] = ["Worker ID must be a positive integer."];
        if (errors.Count > 0) return new(400, Errors: errors);

        var last = first.AddMonths(1).AddDays(-1);
        string scope = "All workers";
        if (id > 0)
        {
            var worker = await db.Workers.AsNoTracking().SingleOrDefaultAsync(w => w.Id == id, ct);
            if (worker is null) return new(400, Errors: new() { ["workerId"] = ["Select a valid worker."] });
            scope = $"{worker.FullName} ({worker.WorkerCode})";
        }

        var query = db.LeaveRequests.AsNoTracking().Include(x => x.Worker).Where(x => x.StartDate <= last && x.EndDate >= first);
        if (id > 0) query = query.Where(x => x.WorkerId == id);
        var rows = await query.OrderBy(x => x.Worker.WorkerCode).ThenBy(x => x.StartDate).ThenBy(x => x.Id).ToListAsync(ct);
        var lines = rows.Select(x =>
        {
            var from = x.StartDate > first ? x.StartDate : first;
            var to = x.EndDate < last ? x.EndDate : last;
            return new Line(x.Worker.WorkerCode, x.Worker.FullName, x.LeaveType, x.StartDate, x.EndDate, x.Days,
                to.DayNumber - from.DayNumber + 1, x.Status, x.DecidedBy ?? "");
        }).ToList();

        var s = await db.PayrollSettings.AsNoTracking().SingleAsync(x => x.Id == PayrollSettings.SingletonId, ct);
        var company = new PayrollCompany(s.CompanyName, s.Tagline, s.ContactEmail, s.PreparedByLabel, s.ApprovedByLabel);
        var stem = id > 0 ? $"Leave_{first:yyyy-MM}_{Clean(rows.FirstOrDefault()?.Worker.WorkerCode ?? id.ToString(CultureInfo.InvariantCulture))}" : $"Leave_{first:yyyy-MM}";
        return format == AttendanceExportFormat.Pdf
            ? new(200, BuildPdf(first, scope, lines, company), $"{stem}.pdf", AttendanceExportService.PdfType)
            : new(200, BuildExcel(first, scope, lines, company), $"{stem}.xlsx", AttendanceExportService.ExcelType);
    }

    private static string Clean(string text) => System.Text.RegularExpressions.Regex.Replace(text.Trim(), @"[^A-Za-z0-9-]+", "_").Trim('_');

    private sealed record Line(string Code, string Name, string Type, DateOnly Start, DateOnly End, int TotalDays, int DaysInMonth,
        string Status, string DecidedBy);

    private static string MonthLabel(DateOnly first) => first.ToString("MMMM yyyy", CultureInfo.InvariantCulture);
    private static string Date(DateOnly d) => d.ToString("dd MMM yyyy", CultureInfo.InvariantCulture);
    private static int Days(List<Line> lines, string status) => lines.Where(l => l.Status == status).Sum(l => l.DaysInMonth);

    // --- Excel ------------------------------------------------------------------------------------------------

    private static byte[] BuildExcel(DateOnly first, string scope, List<Line> lines, PayrollCompany company)
    {
        using var book = new XLWorkbook();
        var sheet = book.AddWorksheet("Leave");
        sheet.Cell(1, 1).Value = company.CompanyName;
        sheet.Cell(1, 1).Style.Font.SetBold().Font.SetFontSize(14).Font.SetFontColor(XLColor.FromHtml("#134E52"));
        sheet.Cell(2, 1).Value = $"Leave report: {MonthLabel(first)}";
        sheet.Cell(2, 1).Style.Font.SetBold().Font.SetFontSize(12);
        sheet.Cell(3, 1).Value = scope;
        sheet.Cell(4, 1).Value = $"{lines.Count} requests · {Days(lines, "Approved")} approved days · {Days(lines, "Pending")} pending days · {Days(lines, "Rejected")} rejected days";
        sheet.Cell(4, 1).Style.Font.SetFontColor(XLColor.FromHtml("#626A70"));

        string[] headers = ["#", "Worker ID", "Name", "Leave type", "From", "To", "Total days", "Days in month", "Status", "Decided by"];
        const int headerRow = 6;
        for (var c = 0; c < headers.Length; c++)
        {
            var cell = sheet.Cell(headerRow, c + 1);
            cell.Value = headers[c];
            cell.Style.Font.SetBold().Font.SetFontColor(XLColor.White);
            cell.Style.Fill.SetBackgroundColor(XLColor.FromHtml("#134E52"));
        }

        for (var i = 0; i < lines.Count; i++)
        {
            var l = lines[i];
            var r = headerRow + 1 + i;
            sheet.Cell(r, 1).Value = i + 1;
            sheet.Cell(r, 2).Value = l.Code;
            sheet.Cell(r, 3).Value = l.Name;
            sheet.Cell(r, 4).Value = l.Type;
            sheet.Cell(r, 5).Value = l.Start.ToDateTime(TimeOnly.MinValue);
            sheet.Cell(r, 6).Value = l.End.ToDateTime(TimeOnly.MinValue);
            sheet.Cell(r, 7).Value = l.TotalDays;
            sheet.Cell(r, 8).Value = l.DaysInMonth;
            sheet.Cell(r, 9).Value = l.Status;
            sheet.Cell(r, 10).Value = l.DecidedBy;
            if (i % 2 == 1) sheet.Range(r, 1, r, headers.Length).Style.Fill.SetBackgroundColor(XLColor.FromHtml("#F0F4F5"));
        }

        var lastRow = headerRow + lines.Count;
        if (lines.Count > 0)
        {
            sheet.Range(headerRow + 1, 5, lastRow, 6).Style.DateFormat.SetFormat("dd mmm yyyy");
            sheet.Range(headerRow, 1, lastRow, headers.Length).Style.Border.SetInsideBorder(XLBorderStyleValues.Hair)
                .Border.SetOutsideBorder(XLBorderStyleValues.Thin);
            var totals = lastRow + 1;
            sheet.Cell(totals, 7).Value = "Approved days";
            sheet.Cell(totals, 8).FormulaA1 = $"SUMIF(I{headerRow + 1}:I{lastRow},\"Approved\",H{headerRow + 1}:H{lastRow})";
            sheet.Range(totals, 1, totals, headers.Length).Style.Font.SetBold().Border.SetTopBorder(XLBorderStyleValues.Medium);
        }
        else
        {
            sheet.Cell(headerRow + 1, 1).Value = "No leave requests in this month.";
        }

        sheet.Range(headerRow, 7, lastRow + 1, 8).Style.Alignment.SetHorizontal(XLAlignmentHorizontalValues.Right);
        sheet.Columns().AdjustToContents(headerRow, lastRow + 1);
        sheet.Column(1).Width = 5;
        sheet.SheetView.FreezeRows(headerRow);
        sheet.PageSetup.PageOrientation = XLPageOrientation.Landscape;
        sheet.PageSetup.FitToPages(1, 0);
        sheet.PageSetup.SetRowsToRepeatAtTop(headerRow, headerRow);

        using var stream = new MemoryStream();
        book.SaveAs(stream);
        return stream.ToArray();
    }

    // --- PDF --------------------------------------------------------------------------------------------------

    private const double Left = PdfLetterhead.Left;
    private const double Right = PdfLetterhead.Right;
    private const double RowHeight = 21;
    private const double BottomMargin = 72;

    private byte[] BuildPdf(DateOnly first, string scope, List<Line> lines, PayrollCompany company)
    {
        foreach (var l in lines)
        {
            PdfText.EnsurePrintable(l.Code);
            PdfText.EnsurePrintable(l.Name);
        }
        PdfText.EnsurePrintable(scope);

        try
        {
            using var document = new PdfDocumentBuilder();
            var regular = document.AddTrueTypeFont(PdfText.Font("Regular"));
            var bold = document.AddTrueTypeFont(PdfText.Font("Bold"));
            var logo = PdfText.Asset("logo.png");
            var details = PdfText.Letterhead(configuration, company.ContactEmail);

            var columns = new List<(string Title, double Width, bool RightAlign)>
            {
                ("ID", 52, false), ("WORKER", 0, false), ("LEAVE TYPE", 86, false), ("FROM", 66, false), ("TO", 66, false),
                ("DAYS", 36, true), ("STATUS", 64, false),
            };
            columns[1] = ("WORKER", Right - Left - columns.Sum(c => c.Width), false);

            var pages = new List<PdfCanvas>();
            PdfCanvas NewPage()
            {
                var cv = new PdfCanvas(document.AddPage(PageSize.A4), regular, bold);
                pages.Add(cv);
                return cv;
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

            var page = NewPage();
            var rule = PdfLetterhead.Draw(page, logo, company, details, "LEAVE REPORT", $"{MonthLabel(first)}  |  {scope}", null);
            var y = rule - 16;

            var tiles = new (string Label, int Value)[]
            {
                ("REQUESTS", lines.Count), ("APPROVED DAYS", Days(lines, "Approved")), ("PENDING DAYS", Days(lines, "Pending")),
                ("WORKERS", lines.Select(l => l.Code).Distinct().Count()),
            };
            var tileWidth = (Right - Left - 3 * 8) / 4;
            for (var i = 0; i < tiles.Length; i++)
            {
                var x = Left + i * (tileWidth + 8);
                page.Fill(x, y - 44, tileWidth, 44, PdfStyle.Panel);
                page.Fill(x, y - 44, 3, 44, i == 1 ? PdfStyle.Teal : i == 2 ? PdfStyle.Amber : PdfStyle.Hairline);
                page.Text(tiles[i].Label, x + 12, y - 16, 6.8, true, PdfStyle.Muted);
                page.Text(tiles[i].Value.ToString(CultureInfo.InvariantCulture), x + 12, y - 37, 16, true);
            }
            y -= 44 + 20;

            TableHeader(page, y);
            y -= 22;
            if (lines.Count == 0) page.Text("No leave requests in this month.", Left + 6, y - 20, 9, false, PdfStyle.Muted);

            for (var i = 0; i < lines.Count; i++)
            {
                if (y - RowHeight < BottomMargin)
                {
                    page = NewPage();
                    y = 800;
                    TableHeader(page, y);
                    y -= 22;
                }

                var l = lines[i];
                if (i % 2 == 1) page.Fill(Left, y - RowHeight, Right - Left, RowHeight, PdfStyle.Stripe);
                string[] cells = [l.Code, l.Name, l.Type, Date(l.Start), Date(l.End), l.DaysInMonth.ToString(CultureInfo.InvariantCulture), l.Status];
                var x = Left;
                for (var c = 0; c < columns.Count; c++)
                {
                    var (_, width, rightAlign) = columns[c];
                    var text = page.Fit(cells[c], width - 12, 8.5, c == 1);
                    var color = c == 6 && l.Status == "Rejected" ? PdfStyle.Muted : c == 6 && l.Status == "Pending" ? PdfStyle.Amber : PdfStyle.Ink;
                    if (rightAlign) page.RightText(text, x + width - 6, y - 14, 8.5, false, color);
                    else page.Text(text, x + 6, y - 14, 8.5, c == 1 || c == 6, color);
                    x += width;
                }
                page.Rule(Left, Right, y - RowHeight, 0.4, PdfStyle.Hairline);
                y -= RowHeight;
            }

            if (lines.Count > 0)
            {
                if (y - 24 < BottomMargin)
                {
                    page = NewPage();
                    y = 800;
                }
                page.Fill(Left, y - 24, Right - Left, 24, PdfStyle.Panel);
                page.Rule(Left, Right, y, 0.8, PdfStyle.Teal);
                page.Text("APPROVED DAYS IN MONTH", Left + 6, y - 15, 8.5, true);
                var daysRight = Right - columns[6].Width - 6;
                page.RightText(Days(lines, "Approved").ToString(CultureInfo.InvariantCulture), daysRight, y - 15, 8.5, true);
                y -= 24;
                page.Text("Days shown are the days of each request that fall inside this month.", Left, y - 16, 7.2, false, PdfStyle.Muted);
            }

            for (var i = 0; i < pages.Count; i++)
            {
                pages[i].Rule(Left, Right, 58, 0.5, PdfStyle.Hairline);
                pages[i].Text("Confidential: leave record for internal company use only.", Left, 44, 7, false, PdfStyle.Muted);
                pages[i].RightText($"{first:yyyy-MM}  |  Page {i + 1}", Right, 44, 7, false, PdfStyle.Muted);
            }
            return document.Build();
        }
        catch (InvalidOperationException ex) when (ex.Message.StartsWith("The font does not contain a character:", StringComparison.Ordinal))
        {
            throw new PdfTextNotSupportedException(ex);
        }
    }
}
