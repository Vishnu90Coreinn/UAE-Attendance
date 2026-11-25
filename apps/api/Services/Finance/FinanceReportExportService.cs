using System.Globalization;
using System.Text;
using HrPayroll.Api.Dtos;
using HrPayroll.Api.Services.Staff;

namespace HrPayroll.Api.Services.Finance;

public enum FinReportFormat { Json, Excel, Pdf, Csv }

public sealed record FinReportFile(byte[] Content, string FileName, string ContentType);

/// <summary>Excel, PDF and CSV of the period report. All three are cut from the same <see cref="FinReport"/>, so the figures cannot differ.</summary>
public sealed class FinanceReportExportService(FinanceReportService reports, StaffExportService staffExports)
{
    private const string Footer = "Confidential: company finance record for internal use only.";
    private static readonly StaffExportService.Table[] None = [];

    private static string Money(decimal value) => value.ToString("N2", CultureInfo.InvariantCulture);
    private static string Plain(decimal value) => value.ToString("0.00", CultureInfo.InvariantCulture);
    private static string Day(string iso) => DateOnly.ParseExact(iso, "yyyy-MM-dd", CultureInfo.InvariantCulture).ToString("dd MMM yyyy", CultureInfo.InvariantCulture);

    private static StaffExportService.Table AccountsTable(FinReport r, string stem) => new(
        "FINANCE STATEMENT", $"{Day(r.From)} to {Day(r.To)}  |  AED", stem,
        [("ACCOUNT", 2.4, false), ("OPENING", 1.2, true), ("INCOME", 1.1, true), ("EXPENSES", 1.1, true), ("TRANSFERS IN", 1.1, true), ("TRANSFERS OUT", 1.1, true), ("CLOSING", 1.2, true)],
        r.Accounts.Select(a => new[] { a.Name, Money(a.Opening), Money(a.Income), Money(a.Expense), Money(a.TransfersIn), Money(a.TransfersOut), Money(a.Closing) })
            .Append(["Total", Money(r.Totals.Opening), Money(r.Totals.Income), Money(r.Totals.Expense), Money(r.Totals.TransfersIn), Money(r.Totals.TransfersOut), Money(r.Totals.Closing)]).ToList(),
        [$"Net result for the period: AED {Money(r.Period.Net)} (income less expenses). Transfers between the company's own accounts are not income or expense.", "Voided entries are not counted."]);

    private static StaffExportService.Table CategoryTable(string title, IReadOnlyList<FinReportCategory> rows, decimal total, string stem, string subtitle) => new(
        title, subtitle, stem, [("CATEGORY", 3, false), ("ENTRIES", 0.8, true), ("AMOUNT", 1.3, true), ("SHARE", 0.7, true)],
        rows.Select(c => new[] { c.Name, c.Count.ToString(CultureInfo.InvariantCulture), Money(c.Amount), c.Share + "%" })
            .Append(["Total", rows.Sum(c => c.Count).ToString(CultureInfo.InvariantCulture), Money(total), rows.Count > 0 ? "100%" : ""]).ToList(), []);

    public async Task<FinResult<FinReportFile>> ExportAsync(string? from, string? to, FinReportFormat format, CancellationToken ct)
    {
        var result = await reports.BuildAsync(from, to, ct);
        if (result.Status != 200) return new(result.Status, Errors: result.Errors, Title: result.Title);
        var r = result.Value!;
        var stem = $"Finance_Report_{r.From}_{r.To}";
        var subtitle = $"{Day(r.From)} to {Day(r.To)}  |  AED";
        var accounts = AccountsTable(r, stem);
        var income = CategoryTable("INCOME BY CATEGORY", r.IncomeCategories, r.Period.Income, stem, subtitle);
        var expenses = CategoryTable("EXPENSES BY CATEGORY", r.ExpenseCategories, r.Period.Expense, stem, subtitle);

        if (format == FinReportFormat.Csv) return FinResult<FinReportFile>.Ok(new(Csv(r), stem + ".csv", "text/csv; charset=utf-8"));

        var company = await staffExports.CompanyAsync(ct);
        if (format == FinReportFormat.Pdf)
            return FinResult<FinReportFile>.Ok(new(staffExports.BuildPdf([accounts, income, expenses], company, Footer), stem + ".pdf", AttendanceExportService.PdfType));

        var entries = await reports.EntriesAsync(r.From, r.To, ct);
        var detail = new StaffExportService.Table("ENTRIES", subtitle, stem,
            [("DATE", 1, false), ("NO.", 1.1, false), ("TYPE", 0.8, false), ("CATEGORY", 2, false), ("PARTY", 2, false), ("ACCOUNT", 1.6, false), ("REFERENCE", 1.2, false), ("AMOUNT", 1, true)],
            entries.Select(e => new[] { Day(e.Date), e.EntryNo, e.Kind, e.Category, e.Party, e.Account, e.Reference ?? "", Money(e.Amount) }).ToList(), []);
        var book = StaffExportService.Workbook([("Statement", accounts), ("Income", income), ("Expenses", expenses), ("Entries", detail)], company);
        return FinResult<FinReportFile>.Ok(new(book, stem + ".xlsx", AttendanceExportService.ExcelType));
    }

    // --- CSV: UTF-8 with a byte-order mark so Excel reads it right; plain numbers, no thousands separators --------------

    private static string Cell(string? text)
    {
        var value = text ?? "";
        // A cell that starts like a formula would run when opened in Excel.
        if (value.Length > 0 && value[0] is '=' or '+' or '-' or '@' or '\t' or '\r') value = "'" + value;
        return value.IndexOfAny([',', '"', '\r', '\n']) >= 0 ? "\"" + value.Replace("\"", "\"\"") + "\"" : value;
    }

    private static byte[] Csv(FinReport r)
    {
        var sb = new StringBuilder();
        void Line(params string?[] cells) => sb.Append(string.Join(',', cells.Select(Cell))).Append("\r\n");
        Line("Finance report", r.From, r.To, "AED");
        Line();
        Line("Account", "Opening", "Income", "Expenses", "Transfers in", "Transfers out", "Closing");
        foreach (var a in r.Accounts) Line(a.Name, Plain(a.Opening), Plain(a.Income), Plain(a.Expense), Plain(a.TransfersIn), Plain(a.TransfersOut), Plain(a.Closing));
        Line("Total", Plain(r.Totals.Opening), Plain(r.Totals.Income), Plain(r.Totals.Expense), Plain(r.Totals.TransfersIn), Plain(r.Totals.TransfersOut), Plain(r.Totals.Closing));
        Line();
        Line("Income by category", "Entries", "Amount", "Share %");
        foreach (var c in r.IncomeCategories) Line(c.Name, c.Count.ToString(CultureInfo.InvariantCulture), Plain(c.Amount), c.Share.ToString(CultureInfo.InvariantCulture));
        Line("Total", r.IncomeCategories.Sum(c => c.Count).ToString(CultureInfo.InvariantCulture), Plain(r.Period.Income), "");
        Line();
        Line("Expenses by category", "Entries", "Amount", "Share %");
        foreach (var c in r.ExpenseCategories) Line(c.Name, c.Count.ToString(CultureInfo.InvariantCulture), Plain(c.Amount), c.Share.ToString(CultureInfo.InvariantCulture));
        Line("Total", r.ExpenseCategories.Sum(c => c.Count).ToString(CultureInfo.InvariantCulture), Plain(r.Period.Expense), "");
        Line();
        Line("Net result", Plain(r.Period.Net));
        return [.. Encoding.UTF8.GetPreamble(), .. Encoding.UTF8.GetBytes(sb.ToString())];
    }
}
