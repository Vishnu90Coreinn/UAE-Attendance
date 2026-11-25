using System.Globalization;
using System.Text;
using HrPayroll.Api.Dtos;
using HrPayroll.Api.Services.Staff;

namespace HrPayroll.Api.Services.Finance;

/// <summary>Excel, PDF and CSV of the books. Each file is cut from the same data the screen shows, so the figures cannot differ.</summary>
public sealed class FinanceLedgerExportService(FinanceLedgerService ledger, StaffExportService staffExports)
{
    private const string Footer = "Confidential: company books for internal use only.";

    private static string Money(decimal value) => value.ToString("N2", CultureInfo.InvariantCulture);
    private static string Plain(decimal value) => value.ToString("0.00", CultureInfo.InvariantCulture);
    private static string Day(string iso) => DateOnly.ParseExact(iso, "yyyy-MM-dd", CultureInfo.InvariantCulture).ToString("dd MMM yyyy", CultureInfo.InvariantCulture);

    private static string Cell(string? text)
    {
        var value = text ?? "";
        // Text that starts like a formula would run when opened in Excel; plain numbers such as -250.00 are left alone.
        if (value.Length > 0 && value[0] is '=' or '+' or '-' or '@' or '\t' or '\r' && !decimal.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out _)) value = "'" + value;
        return value.IndexOfAny([',', '"', '\r', '\n']) >= 0 ? "\"" + value.Replace("\"", "\"\"") + "\"" : value;
    }

    private static byte[] Csv(IEnumerable<string[]> rows) =>
        [.. Encoding.UTF8.GetPreamble(), .. Encoding.UTF8.GetBytes(string.Join("\r\n", rows.Select(r => string.Join(',', r.Select(Cell)))) + "\r\n")];

    private async Task<FinReportFile> FileAsync(StaffExportService.Table table, IReadOnlyList<string[]> csv, string stem, string sheet, FinReportFormat format, CancellationToken ct)
    {
        if (format == FinReportFormat.Csv) return new(Csv(csv), stem + ".csv", "text/csv; charset=utf-8");
        var company = await staffExports.CompanyAsync(ct);
        return format == FinReportFormat.Pdf
            ? new(staffExports.BuildPdf([table], company, Footer), stem + ".pdf", AttendanceExportService.PdfType)
            : new(StaffExportService.Workbook([(sheet, table)], company), stem + ".xlsx", AttendanceExportService.ExcelType);
    }

    public async Task<FinReportFile> TrialBalanceAsync(string? asOf, FinReportFormat format, CancellationToken ct)
    {
        var date = FinanceRules.TryParseDate(asOf, out var d) ? d : (DateOnly?)null;
        var t = await ledger.TrialBalanceAsync(date, ct);
        var stem = $"Trial_Balance_{t.AsOf}";
        var rows = t.Accounts.Select(a => new[] { a.Code, a.Name, a.Type, Money(a.Debit), Money(a.Credit) }).Append(["", "Total", "", Money(t.TotalDebit), Money(t.TotalCredit)]).ToList();
        var table = new StaffExportService.Table("TRIAL BALANCE", $"As at {Day(t.AsOf)}  |  AED", stem,
            [("CODE", 0.8, false), ("ACCOUNT", 3, false), ("TYPE", 1, false), ("DEBIT", 1.3, true), ("CREDIT", 1.3, true)], rows,
            [t.Balanced ? "Total debits equal total credits." : "Total debits and credits differ: the books need attention."]);
        var csv = new List<string[]> { new[] { "Trial balance", t.AsOf, "AED" }, new[] { "Code", "Account", "Type", "Debit", "Credit" } };
        csv.AddRange(t.Accounts.Select(a => new[] { a.Code, a.Name, a.Type, Plain(a.Debit), Plain(a.Credit) }));
        csv.Add(["", "Total", "", Plain(t.TotalDebit), Plain(t.TotalCredit)]);
        return await FileAsync(table, csv, stem, "Trial balance", format, ct);
    }

    public async Task<FinResult<FinReportFile>> StatementAsync(int accountId, string? from, string? to, FinReportFormat format, CancellationToken ct)
    {
        var result = await ledger.StatementAsync(accountId, from, to, ct);
        if (result.Status != 200) return new(result.Status, Errors: result.Errors, Title: result.Title);
        var s = result.Value!;
        var stem = $"Ledger_{s.Account.Code}_{s.From}_{s.To}";
        var rows = new List<string[]> { new[] { "", "", $"Opening balance on {Day(s.From)}", "", "", Money(s.Opening) } };
        rows.AddRange(s.Lines.Select(l => new[] { Day(l.Date), l.JournalNumber, l.Description, Money(l.Debit), Money(l.Credit), Money(l.Balance) }));
        rows.Add(["", "", $"Closing balance on {Day(s.To)}", "", "", Money(s.Closing)]);
        var table = new StaffExportService.Table($"LEDGER: {s.Account.Code} {s.Account.Name}".ToUpperInvariant(), $"{Day(s.From)} to {Day(s.To)}  |  AED", stem,
            [("DATE", 1, false), ("JOURNAL", 1.1, false), ("DESCRIPTION", 3, false), ("DEBIT", 1.2, true), ("CREDIT", 1.2, true), ("BALANCE", 1.3, true)], rows,
            [$"{s.Account.Type} account. The balance grows with a {(s.Account.Type is "Asset" or "Expense" ? "debit" : "credit")}."]);
        var csv = new List<string[]> { new[] { "Ledger", s.Account.Code, s.Account.Name, s.From, s.To }, new[] { "Date", "Journal", "Description", "Debit", "Credit", "Balance" }, new[] { "", "", "Opening balance", "", "", Plain(s.Opening) } };
        csv.AddRange(s.Lines.Select(l => new[] { l.Date, l.JournalNumber, l.Description, Plain(l.Debit), Plain(l.Credit), Plain(l.Balance) }));
        csv.Add(["", "", "Closing balance", "", "", Plain(s.Closing)]);
        return FinResult<FinReportFile>.Ok(await FileAsync(table, csv, stem, "Ledger", format, ct));
    }

    public async Task<FinReportFile> JournalsAsync(string? from, string? to, FinReportFormat format, CancellationToken ct)
    {
        var list = await ledger.JournalsAsync(from, to, null, null, ct);
        var stem = $"Journals_{(string.IsNullOrWhiteSpace(from) ? "start" : from)}_{(string.IsNullOrWhiteSpace(to) ? "today" : to)}";
        var flat = list.Items.Reverse().SelectMany(j => j.Lines.Select(l => (J: j, L: l))).ToList();
        var rows = flat.Select(x => new[] { Day(x.J.Date), x.J.Number, x.J.Description, $"{x.L.AccountCode} {x.L.AccountName}", x.L.Debit > 0 ? Money(x.L.Debit) : "", x.L.Credit > 0 ? Money(x.L.Credit) : "" }).ToList();
        var table = new StaffExportService.Table("JOURNALS", $"{list.Count} journals  |  AED", stem,
            [("DATE", 1, false), ("JOURNAL", 1.1, false), ("DESCRIPTION", 2.6, false), ("ACCOUNT", 2.4, false), ("DEBIT", 1.1, true), ("CREDIT", 1.1, true)], rows,
            list.Truncated ? ["Only the newest 500 journals are included. Narrow the dates for the rest."] : []);
        var csv = new List<string[]> { new[] { "Date", "Journal", "Description", "Account code", "Account", "Debit", "Credit", "Posted by hand" } };
        csv.AddRange(flat.Select(x => new[] { x.J.Date, x.J.Number, x.J.Description, x.L.AccountCode, x.L.AccountName, x.L.Debit > 0 ? Plain(x.L.Debit) : "", x.L.Credit > 0 ? Plain(x.L.Credit) : "", x.J.IsManual ? "Yes" : "No" }));
        return await FileAsync(table, csv, stem, "Journals", format, ct);
    }
}
