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
        [("ACCOUNT", 2.2, false), ("OPENING", 1.15, true), ("INCOME", 1.05, true), ("EXPENSES", 1.05, true), ("TRANSFERS IN", 1.05, true), ("TRANSFERS OUT", 1.05, true), ("CAPITAL", 1.05, true), ("CLOSING", 1.15, true)],
        r.Accounts.Select(a => new[] { a.Name, Money(a.Opening), Money(a.Income), Money(a.Expense), Money(a.TransfersIn), Money(a.TransfersOut), Money(a.Capital), Money(a.Closing) })
            .Append(["Total", Money(r.Totals.Opening), Money(r.Totals.Income), Money(r.Totals.Expense), Money(r.Totals.TransfersIn), Money(r.Totals.TransfersOut), Money(r.Totals.Capital), Money(r.Totals.Closing)]).ToList(),
        [$"Net result for the period: AED {Money(r.Period.Net)} (income less expenses). Transfers between the company's own accounts and partners' capital are not income or expense.", "Capital is what partners put in, less what was paid back. Voided entries are not counted."]);

    private static string MonthName(string month) =>
        DateOnly.ParseExact(month + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture).ToString("MMM yyyy", CultureInfo.InvariantCulture);

    private static StaffExportService.Table MonthsTable(FinReport r, string stem, string subtitle)
    {
        var months = r.Months ?? [];
        return new("MONTH BY MONTH", subtitle, stem, [("MONTH", 1.5, false), ("ENTRIES", 0.8, true), ("INCOME", 1.3, true), ("EXPENSES", 1.3, true), ("NET", 1.3, true), ("CAPITAL", 1.2, true), ("STATUS", 1, false)],
            months.Select(m => new[] { MonthName(m.Month), m.Entries.ToString(CultureInfo.InvariantCulture), Money(m.Income), Money(m.Expense), Money(m.Net), Money(m.Capital), m.IsLocked ? "Locked" : "Open" })
                .Append(["Total", months.Sum(m => m.Entries).ToString(CultureInfo.InvariantCulture), Money(r.Period.Income), Money(r.Period.Expense), Money(r.Period.Net), Money(r.Totals.Capital), ""]).ToList(),
            ["A month is Locked once it has been checked and closed. The first and last month hold only the days inside the report period, so choose whole months to compare with another system."]);
    }

    private static StaffExportService.Table PartnersTable(FinReport r, string stem, string subtitle)
    {
        var partners = r.Partners ?? [];
        return new("PARTNERS' CAPITAL", subtitle, stem, [("PARTNER", 2.6, false), ("OPENING", 1.2, true), ("ADDED", 1.2, true), ("RETURNED", 1.2, true), ("CLOSING", 1.3, true), ("SHARE", 0.8, true)],
            partners.Select(p => new[] { p.Name, Money(p.Opening), Money(p.Added), Money(p.Returned), Money(p.Closing), p.Share.ToString("0.00", CultureInfo.InvariantCulture) + "%" })
                .Append(["Total", Money(partners.Sum(p => p.Opening)), Money(partners.Sum(p => p.Added)), Money(partners.Sum(p => p.Returned)), Money(partners.Sum(p => p.Closing)), partners.Count > 0 ? "100.00%" : ""]).ToList(),
            ["Share is each partner's capital at the end of the period as a percentage of all partners' capital."]);
    }

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
        var partnersTable = PartnersTable(r, stem, subtitle);
        var monthsTable = MonthsTable(r, stem, subtitle);

        if (format == FinReportFormat.Csv) return FinResult<FinReportFile>.Ok(new(Csv(r), stem + ".csv", "text/csv; charset=utf-8"));

        var company = await staffExports.CompanyAsync(ct);
        if (format == FinReportFormat.Pdf)
            return FinResult<FinReportFile>.Ok(new(staffExports.BuildPdf([accounts, monthsTable, income, expenses, partnersTable], company, Footer), stem + ".pdf", AttendanceExportService.PdfType));

        var entries = await reports.EntriesAsync(r.From, r.To, ct);
        var detail = new StaffExportService.Table("ENTRIES", subtitle, stem,
            [("DATE", 1, false), ("NO.", 1.1, false), ("TYPE", 0.8, false), ("CATEGORY", 2, false), ("PARTY", 2, false), ("ACCOUNT", 1.6, false), ("REFERENCE", 1.2, false), ("AMOUNT", 1, true)],
            entries.Select(e => new[] { Day(e.Date), e.EntryNo, e.Kind, e.Category, e.Party, e.Account, e.Reference ?? "", Money(e.Amount) }).ToList(), []);
        var book = StaffExportService.Workbook([("Statement", accounts), ("Months", monthsTable), ("Income", income), ("Expenses", expenses), ("Partners", partnersTable), ("Entries", detail)], company);
        return FinResult<FinReportFile>.Ok(new(book, stem + ".xlsx", AttendanceExportService.ExcelType));
    }

    // --- CSV: UTF-8 with a byte-order mark so Excel reads it right; plain numbers, no thousands separators --------------

    private static string Cell(string? text)
    {
        var value = text ?? "";
        // A cell that starts like a formula would run when opened in Excel.
        // Plain numbers such as -250.00 are left alone; only text that could be a formula is marked.
        if (value.Length > 0 && value[0] is '=' or '+' or '-' or '@' or '\t' or '\r' && !decimal.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out _)) value = "'" + value;
        return value.IndexOfAny([',', '"', '\r', '\n']) >= 0 ? "\"" + value.Replace("\"", "\"\"") + "\"" : value;
    }

    private static byte[] Csv(FinReport r)
    {
        var sb = new StringBuilder();
        void Line(params string?[] cells) => sb.Append(string.Join(',', cells.Select(Cell))).Append("\r\n");
        Line("Finance report", r.From, r.To, "AED");
        Line();
        Line("Account", "Opening", "Income", "Expenses", "Transfers in", "Transfers out", "Capital", "Closing");
        foreach (var a in r.Accounts) Line(a.Name, Plain(a.Opening), Plain(a.Income), Plain(a.Expense), Plain(a.TransfersIn), Plain(a.TransfersOut), Plain(a.Capital), Plain(a.Closing));
        Line("Total", Plain(r.Totals.Opening), Plain(r.Totals.Income), Plain(r.Totals.Expense), Plain(r.Totals.TransfersIn), Plain(r.Totals.TransfersOut), Plain(r.Totals.Capital), Plain(r.Totals.Closing));
        Line();
        Line("Month by month", "Entries", "Income", "Expenses", "Net", "Capital", "Status");
        foreach (var m in r.Months ?? []) Line(m.Month, m.Entries.ToString(CultureInfo.InvariantCulture), Plain(m.Income), Plain(m.Expense), Plain(m.Net), Plain(m.Capital), m.IsLocked ? "Locked" : "Open");
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
        Line();
        Line("Partners' capital", "Opening", "Added", "Returned", "Closing", "Share %");
        foreach (var p in r.Partners ?? []) Line(p.Name, Plain(p.Opening), Plain(p.Added), Plain(p.Returned), Plain(p.Closing), Plain(p.Share));
        return [.. Encoding.UTF8.GetPreamble(), .. Encoding.UTF8.GetBytes(sb.ToString())];
    }
}
