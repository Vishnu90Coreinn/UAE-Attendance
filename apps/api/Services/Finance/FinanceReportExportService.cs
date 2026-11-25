using System.Globalization;
using System.Text;
using HrPayroll.Api.Dtos;
using HrPayroll.Api.Services.Staff;

namespace HrPayroll.Api.Services.Finance;

public enum FinReportFormat { Json, Excel, Pdf, Csv }

public sealed record FinReportFile(byte[] Content, string FileName, string ContentType);

/// <summary>Excel, PDF and CSV of the period report. All three are cut from the same <see cref="FinReport"/>, so the figures cannot differ.</summary>
public sealed class FinanceReportExportService(FinanceReportService reports, StaffExportService staffExports, FinanceVatService vat)
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

    private static string MonthName(string key, string grain) => grain switch
    {
        "year" => key,
        "day" => Day(key),
        "week" => "Week of " + Day(key),
        _ => DateOnly.ParseExact(key + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture).ToString("MMM yyyy", CultureInfo.InvariantCulture),
    };

    private static StaffExportService.Table MonthsTable(FinReport r, string stem, string subtitle)
    {
        var months = r.Months ?? [];
        var grain = r.Granularity;
        return new(grain switch { "day" => "DAY BY DAY", "week" => "WEEK BY WEEK", "year" => "YEAR BY YEAR", _ => "MONTH BY MONTH" }, subtitle, stem, [(grain switch { "day" => "DAY", "week" => "WEEK", "year" => "YEAR", _ => "MONTH" }, 1.5, false), ("ENTRIES", 0.8, true), ("INCOME", 1.3, true), ("EXPENSES", 1.3, true), ("NET", 1.3, true), ("CAPITAL", 1.2, true), ("STATUS", 1, false)],
            months.Select(m => new[] { MonthName(m.Month, grain), m.Entries.ToString(CultureInfo.InvariantCulture), Money(m.Income), Money(m.Expense), Money(m.Net), Money(m.Capital), m.IsLocked ? "Locked" : "Open" })
                .Append(["Total", months.Sum(m => m.Entries).ToString(CultureInfo.InvariantCulture), Money(r.Period.Income), Money(r.Period.Expense), Money(r.Period.Net), Money(r.Totals.Capital), ""]).ToList(),
            ["A month is Locked once it has been checked and closed. The first and last row hold only the days inside the report period, so choose whole months to compare with another system."]);
    }

    private static StaffExportService.Table PartnersTable(FinReport r, string stem, string subtitle)
    {
        var partners = r.Partners ?? [];
        return new("PARTNERS' CAPITAL", subtitle, stem, [("PARTNER", 2.6, false), ("OPENING", 1.2, true), ("ADDED", 1.2, true), ("RETURNED", 1.2, true), ("CLOSING", 1.3, true), ("SHARE", 0.8, true)],
            partners.Select(p => new[] { p.Name, Money(p.Opening), Money(p.Added), Money(p.Returned), Money(p.Closing), p.Share.ToString("0.00", CultureInfo.InvariantCulture) + "%" })
                .Append(["Total", Money(partners.Sum(p => p.Opening)), Money(partners.Sum(p => p.Added)), Money(partners.Sum(p => p.Returned)), Money(partners.Sum(p => p.Closing)), partners.Count > 0 ? "100.00%" : ""]).ToList(),
            ["Share is each partner's capital at the end of the period as a percentage of all partners' capital."]);
    }

    /// <summary>The VAT return figures as Excel, PDF or CSV.</summary>
    public async Task<FinResult<FinReportFile>> VatAsync(string? from, string? to, FinReportFormat format, CancellationToken ct)
    {
        var result = await vat.BuildAsync(from, to, ct);
        if (result.Status != 200) return new(result.Status, Errors: result.Errors, Title: result.Title);
        var v = result.Value!;
        var stem = $"VAT_{v.From}_{v.To}";
        var rows = new List<string[]>();
        var csv = new List<string[]> { new[] { "VAT return", v.From, v.To, "AED" }, new[] { "Section", "Type", "Rate %", "Entries", "Net", "VAT" } };
        void Block(string title, IReadOnlyList<FinVatRow> list)
        {
            rows.Add([title.ToUpperInvariant(), "", "", "", ""]);
            foreach (var r in list)
            {
                rows.Add([r.TaxType, r.Rate.ToString("0.##", CultureInfo.InvariantCulture) + "%", r.Count.ToString(CultureInfo.InvariantCulture), Money(r.Net), Money(r.Vat)]);
                csv.Add([title, r.TaxType, r.Rate.ToString("0.##", CultureInfo.InvariantCulture), r.Count.ToString(CultureInfo.InvariantCulture), Plain(r.Net), Plain(r.Vat)]);
            }

            if (list.Count == 0) rows.Add(["None in this period", "", "", "", ""]);
        }

        Block("Sales", v.Sales);
        Block("Purchases", v.Purchases);
        rows.Add(["", "", "", "", ""]);
        rows.Add(["VAT charged (output)", "", "", "", Money(v.OutputVat)]);
        rows.Add(["VAT reclaimable (input)", "", "", "", Money(v.InputVat)]);
        rows.Add([v.NetPayable >= 0 ? "Net VAT payable" : "Net VAT refundable", "", "", "", Money(v.NetPayable)]);
        csv.Add(["Summary", "VAT charged (output)", "", "", "", Plain(v.OutputVat)]);
        csv.Add(["Summary", "VAT reclaimable (input)", "", "", "", Plain(v.InputVat)]);
        csv.Add(["Summary", "Net VAT payable", "", "", "", Plain(v.NetPayable)]);
        var notes = new List<string> { "Output VAT includes the VAT the company accounts for itself on reverse-charge purchases, which is reclaimed as input VAT in the same return." };
        if (v.UnrecordedSales.Count + v.UnrecordedPurchases.Count > 0)
            notes.Add($"Not in this return: {v.UnrecordedSales.Count} sales (AED {Money(v.UnrecordedSales.Amount)}) and {v.UnrecordedPurchases.Count} purchases (AED {Money(v.UnrecordedPurchases.Amount)}) have no VAT type recorded.");
        var table = new StaffExportService.Table("VAT RETURN", $"{Day(v.From)} to {Day(v.To)}  |  AED", stem, [("TYPE", 3, false), ("RATE", 0.8, true), ("ENTRIES", 0.9, true), ("NET", 1.3, true), ("VAT", 1.3, true)], rows, notes.ToArray());
        if (format == FinReportFormat.Csv) return FinResult<FinReportFile>.Ok(new(Csv(csv), stem + ".csv", "text/csv; charset=utf-8"));
        var company = await staffExports.CompanyAsync(ct);
        return FinResult<FinReportFile>.Ok(format == FinReportFormat.Pdf
            ? new(staffExports.BuildPdf([table], company, Footer), stem + ".pdf", AttendanceExportService.PdfType)
            : new(StaffExportService.Workbook([("VAT return", table)], company), stem + ".xlsx", AttendanceExportService.ExcelType));
    }

    private static byte[] Csv(IEnumerable<string[]> lines) =>
        [.. Encoding.UTF8.GetPreamble(), .. Encoding.UTF8.GetBytes(string.Join("\r\n", lines.Select(r => string.Join(',', r.Select(Cell)))) + "\r\n")];

    private static StaffExportService.Table PayeeTable(string title, IReadOnlyList<FinReportPayee>? rows, decimal total, string stem, string subtitle, string nameHeader)
    {
        var list = rows ?? [];
        return new(title, subtitle, stem, [(nameHeader, 3, false), ("ENTRIES", 0.8, true), ("AMOUNT", 1.3, true), ("SHARE", 0.7, true)],
            list.Select(p => new[] { p.Name, p.Count.ToString(CultureInfo.InvariantCulture), Money(p.Amount), p.Share.ToString("0.0", CultureInfo.InvariantCulture) + "%" })
                .Append(["Total", list.Sum(p => p.Count).ToString(CultureInfo.InvariantCulture), Money(total), list.Count > 0 ? "100%" : ""]).ToList(), []);
    }

    private static StaffExportService.Table EnteredByTable(FinReport r, string stem, string subtitle)
    {
        var list = r.EnteredBy ?? [];
        return new("ENTERED BY", subtitle, stem, [("PERSON", 2.6, false), ("ENTRIES", 0.9, true), ("INCOME", 1.3, true), ("EXPENSES", 1.3, true)],
            list.Select(p => new[] { p.Name, p.Entries.ToString(CultureInfo.InvariantCulture), Money(p.Income), Money(p.Expense) })
                .Append(["Total", list.Sum(p => p.Entries).ToString(CultureInfo.InvariantCulture), Money(list.Sum(p => p.Income)), Money(list.Sum(p => p.Expense))]).ToList(),
            ["Each entry is counted under the person who recorded it. Expenses waiting for approval are not counted."]);
    }

    private static StaffExportService.Table CashFlowTable(FinReport r, string stem, string subtitle)
    {
        var c = r.CashFlow ?? new FinCashFlow(0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
        static string[] R(string item, string amount) => [item, amount];
        var rows = new List<string[]>
        {
            R("Opening balance of all accounts", Money(c.Opening)),
            R("Income received", Money(c.Income)), R("Expenses paid", "- " + Money(c.Expense)), R("Net from operations", Money(c.Operating)),
            R("Capital put in by partners", Money(c.CapitalIn)), R("Capital paid back to partners", "- " + Money(c.CapitalOut)), R("Net from partners' capital", Money(c.Financing)),
        };
        if (c.Other != 0m) rows.Add(R("Other (accounts opened in the period)", Money(c.Other)));
        rows.Add(R("Net change in the period", Money(c.NetChange)));
        rows.Add(R("Closing balance of all accounts", Money(c.Closing)));
        return new("CASH FLOW", subtitle, stem, [("ITEM", 3, false), ("AED", 1.3, true)], rows,
            ["Transfers between the company's own accounts move money from one account to another and do not change the total."]);
    }

    private static StaffExportService.Table CategoryTable(string title, IReadOnlyList<FinReportCategory> rows, decimal total, string stem, string subtitle) => new(
        title, subtitle, stem, [("CATEGORY", 3, false), ("ENTRIES", 0.8, true), ("AMOUNT", 1.3, true), ("SHARE", 0.7, true)],
        rows.Select(c => new[] { c.Name, c.Count.ToString(CultureInfo.InvariantCulture), Money(c.Amount), c.Share.ToString("0.0", CultureInfo.InvariantCulture) + "%" })
            .Append(["Total", rows.Sum(c => c.Count).ToString(CultureInfo.InvariantCulture), Money(total), rows.Count > 0 ? "100%" : ""]).ToList(), []);

    public async Task<FinResult<FinReportFile>> ExportAsync(string? from, string? to, FinReportFormat format, CancellationToken ct, string? granularity = null)
    {
        var result = await reports.BuildAsync(from, to, ct, granularity);
        if (result.Status != 200) return new(result.Status, Errors: result.Errors, Title: result.Title);
        var r = result.Value!;
        var stem = $"Finance_Report_{r.From}_{r.To}";
        var subtitle = $"{Day(r.From)} to {Day(r.To)}  |  AED";
        var accounts = AccountsTable(r, stem);
        var income = CategoryTable("INCOME BY CATEGORY", r.IncomeCategories, r.Period.Income, stem, subtitle);
        var expenses = CategoryTable("EXPENSES BY CATEGORY", r.ExpenseCategories, r.Period.Expense, stem, subtitle);
        var partnersTable = PartnersTable(r, stem, subtitle);
        var cashFlow = CashFlowTable(r, stem, subtitle);
        var expensePayees = PayeeTable("EXPENSES BY PAYEE", r.ExpensePayees, r.Period.Expense, stem, subtitle, "PAID TO");
        var incomePayees = PayeeTable("INCOME BY SOURCE", r.IncomePayees, r.Period.Income, stem, subtitle, "RECEIVED FROM");
        var enteredBy = EnteredByTable(r, stem, subtitle);
        var monthsTable = MonthsTable(r, stem, subtitle);

        if (format == FinReportFormat.Csv) return FinResult<FinReportFile>.Ok(new(Csv(r), stem + ".csv", "text/csv; charset=utf-8"));

        var company = await staffExports.CompanyAsync(ct);
        if (format == FinReportFormat.Pdf)
            return FinResult<FinReportFile>.Ok(new(staffExports.BuildPdf([accounts, cashFlow, monthsTable, income, expenses, expensePayees, incomePayees, enteredBy, partnersTable], company, Footer), stem + ".pdf", AttendanceExportService.PdfType));

        var entries = await reports.EntriesAsync(r.From, r.To, ct);
        var detail = new StaffExportService.Table("ENTRIES", subtitle, stem,
            [("DATE", 1, false), ("NO.", 1.1, false), ("TYPE", 0.8, false), ("CATEGORY", 2, false), ("PARTY", 2, false), ("ACCOUNT", 1.6, false), ("REFERENCE", 1.2, false), ("AMOUNT", 1, true)],
            entries.Select(e => new[] { Day(e.Date), e.EntryNo, e.Kind, e.Category, e.Party, e.Account, e.Reference ?? "", Money(e.Amount) }).ToList(), []);
        var book = StaffExportService.Workbook([("Statement", accounts), ("Cash flow", cashFlow), ("Months", monthsTable), ("Income", income), ("Expenses", expenses), ("Expense payees", expensePayees), ("Income sources", incomePayees), ("Entered by", enteredBy), ("Partners", partnersTable), ("Entries", detail)], company);
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
        var cf = r.CashFlow;
        if (cf is not null)
        {
            Line("Cash flow", "AED");
            Line("Opening balance", Plain(cf.Opening)); Line("Income received", Plain(cf.Income)); Line("Expenses paid", Plain(-cf.Expense)); Line("Net from operations", Plain(cf.Operating));
            Line("Capital put in", Plain(cf.CapitalIn)); Line("Capital paid back", Plain(-cf.CapitalOut)); Line("Net from capital", Plain(cf.Financing));
            if (cf.Other != 0m) Line("Other", Plain(cf.Other));
            Line("Net change", Plain(cf.NetChange)); Line("Closing balance", Plain(cf.Closing));
            Line();
        }

        Line(r.Granularity switch { "day" => "Day by day", "week" => "Week by week (Monday)", "year" => "Year by year", _ => "Month by month" }, "Entries", "Income", "Expenses", "Net", "Capital", "Status");
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
        Line("Expenses by payee", "Entries", "Amount", "Share %");
        foreach (var p in r.ExpensePayees ?? []) Line(p.Name, p.Count.ToString(CultureInfo.InvariantCulture), Plain(p.Amount), p.Share.ToString(CultureInfo.InvariantCulture));
        Line();
        Line("Income by source", "Entries", "Amount", "Share %");
        foreach (var p in r.IncomePayees ?? []) Line(p.Name, p.Count.ToString(CultureInfo.InvariantCulture), Plain(p.Amount), p.Share.ToString(CultureInfo.InvariantCulture));
        Line();
        Line("Entered by", "Entries", "Income", "Expenses");
        foreach (var p in r.EnteredBy ?? []) Line(p.Name, p.Entries.ToString(CultureInfo.InvariantCulture), Plain(p.Income), Plain(p.Expense));
        Line();
        Line("Net result", Plain(r.Period.Net));
        Line();
        Line("Partners' capital", "Opening", "Added", "Returned", "Closing", "Share %");
        foreach (var p in r.Partners ?? []) Line(p.Name, Plain(p.Opening), Plain(p.Added), Plain(p.Returned), Plain(p.Closing), Plain(p.Share));
        return [.. Encoding.UTF8.GetPreamble(), .. Encoding.UTF8.GetBytes(sb.ToString())];
    }
}
