using System.Globalization;
using ClosedXML.Excel;
using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace HrPayroll.Api.Services.Finance;

/// <summary>
/// Expenses or income from an Excel file, for the entries that were kept elsewhere before this app. The file is checked row by row first;
/// the import saves every good row at once, or nothing. Imported rows carry no receipt (they are marked "No receipt" until one is added by a correction).
/// </summary>
public sealed class FinanceImportService(AppDbContext db, IAuditLogger audit, IHttpContextAccessor http, TimeProvider time, FinancePeriodService periods)
{
    public const int MaxRows = 1000;
    public const long MaxBytes = 5 * 1024 * 1024;
    private const string Source = "Excel import";

    private static readonly string[] DateFormats = ["yyyy-MM-dd", "dd/MM/yyyy", "d/M/yyyy", "dd-MM-yyyy", "d-M-yyyy", "dd.MM.yyyy", "d MMM yyyy", "dd MMM yyyy"];

    private static string[] Headers(string kind) => ["Date", kind == FinEntryKinds.Income ? "Received from" : "Paid to", "Category", "Account", "Amount", "Reference", "Notes"];

    /// <summary>An empty sheet with the right columns and one example row, so the person filling it in sees what is expected.</summary>
    public static byte[] Template(string kind)
    {
        using var book = new XLWorkbook();
        var sheet = book.Worksheets.Add(kind == FinEntryKinds.Income ? "Income" : "Expenses");
        var headers = Headers(kind);
        for (var i = 0; i < headers.Length; i++)
        {
            sheet.Cell(1, i + 1).Value = headers[i];
            sheet.Cell(1, i + 1).Style.Font.Bold = true;
        }

        sheet.Cell(2, 1).Value = "2026-09-25";
        sheet.Cell(2, 2).Value = kind == FinEntryKinds.Income ? "One by Binghatti" : "M S K Luxuries Properties";
        sheet.Cell(2, 3).Value = kind == FinEntryKinds.Income ? "Other income" : "Worker Accommodation Rent";
        sheet.Cell(2, 4).Value = "Main bank account";
        sheet.Cell(2, 5).Value = 12000;
        sheet.Cell(2, 6).Value = "Cheque 000004";
        sheet.Cell(2, 7).Value = "Example row: delete it before importing";
        sheet.Columns().AdjustToContents();
        using var stream = new MemoryStream();
        book.SaveAs(stream);
        return stream.ToArray();
    }

    private static string? Text(IXLCell cell) => cell.IsEmpty() ? null : FinanceRules.Clean(cell.GetFormattedString());

    private static bool TryDate(IXLCell cell, out DateOnly date)
    {
        date = default;
        if (cell.IsEmpty()) return false;
        if (cell.DataType == XLDataType.DateTime) { date = DateOnly.FromDateTime(cell.GetDateTime()); return true; }
        return DateOnly.TryParseExact(cell.GetFormattedString().Trim(), DateFormats, CultureInfo.InvariantCulture, DateTimeStyles.None, out date);
    }

    private static bool TryAmount(IXLCell cell, out decimal amount)
    {
        amount = 0;
        if (cell.IsEmpty()) return false;
        if (cell.DataType == XLDataType.Number) { amount = Convert.ToDecimal(cell.GetDouble(), CultureInfo.InvariantCulture); return true; }
        var text = cell.GetFormattedString().Replace("AED", "", StringComparison.OrdinalIgnoreCase).Replace(",", "").Trim();
        return decimal.TryParse(text, NumberStyles.Number, CultureInfo.InvariantCulture, out amount);
    }

    public async Task<FinResult<FinImportResult>> RunAsync(string kind, Stream file, bool commit, CancellationToken ct)
    {
        XLWorkbook book;
        try { book = new XLWorkbook(file); }
        catch (Exception ex) when (ex is not OperationCanceledException) { return FinResult<FinImportResult>.Invalid("file", "That file could not be read. Use an Excel .xlsx file."); }

        using (book)
        {
            var sheet = book.Worksheets.FirstOrDefault();
            var headerRow = sheet?.FirstRowUsed();
            if (sheet is null || headerRow is null) return FinResult<FinImportResult>.Invalid("file", "The file is empty.");

            // Columns are found by their heading, so their order does not matter.
            var columns = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            foreach (var cell in headerRow.CellsUsed()) columns.TryAdd(cell.GetString().Trim(), cell.Address.ColumnNumber);
            var partyHeader = Headers(kind)[1];
            var missing = new[] { "Date", partyHeader, "Category", "Account", "Amount" }.Where(h => !columns.ContainsKey(h)).ToList();
            if (missing.Count > 0) return FinResult<FinImportResult>.Invalid("file", $"The first row must have these headings: {string.Join(", ", Headers(kind)[..5])}. Missing: {string.Join(", ", missing)}.");

            var dataRows = sheet.RowsUsed().Where(r => r.RowNumber() > headerRow.RowNumber()).ToList();
            if (dataRows.Count == 0) return FinResult<FinImportResult>.Invalid("file", "The file has no rows under the headings.");
            if (dataRows.Count > MaxRows) return FinResult<FinImportResult>.Invalid("file", $"Import at most {MaxRows} rows at a time.");

            var categories = await db.FinCategories.AsNoTracking().Where(c => c.Kind == kind).ToListAsync(ct);
            var accounts = await db.FinAccounts.AsNoTracking().ToListAsync(ct);
            var today = FinanceRules.Today(time);
            var lockedCache = new Dictionary<(int, int), string?>();

            string? Cell(IXLRow r, string heading) => columns.TryGetValue(heading, out var c) ? Text(r.Cell(c)) : null;
            var parsed = new List<(IXLRow Row, DateOnly? Date, string? Party, FinCategory? Category, FinAccount? Account, decimal? Amount, string? Reference, string? Notes, List<string> Problems)>();
            foreach (var row in dataRows)
            {
                var problems = new List<string>();
                DateOnly? date = null;
                if (!TryDate(row.Cell(columns["Date"]), out var d)) problems.Add("The date is missing or not a date.");
                else if (d > today) problems.Add("The date is in the future.");
                else date = d;

                var party = Cell(row, partyHeader);
                if (party is null) problems.Add(kind == FinEntryKinds.Income ? "Who it was received from is missing." : "Who was paid is missing.");
                else if (party.Length > 120) problems.Add("The name is longer than 120 characters.");

                var categoryName = Cell(row, "Category");
                var category = categoryName is null ? null : categories.FirstOrDefault(c => string.Equals(c.Name, categoryName, StringComparison.OrdinalIgnoreCase));
                if (categoryName is null) problems.Add("The category is missing.");
                else if (category is null) problems.Add($"There is no {kind.ToLowerInvariant()} category called \"{categoryName}\".");
                else if (!category.IsActive) problems.Add($"The category \"{category.Name}\" is switched off.");

                var accountName = Cell(row, "Account");
                var account = accountName is null ? null : accounts.FirstOrDefault(a => string.Equals(a.Name, accountName, StringComparison.OrdinalIgnoreCase));
                if (accountName is null) problems.Add("The account is missing.");
                else if (account is null) problems.Add($"There is no account called \"{accountName}\".");
                else if (!account.IsActive) problems.Add($"The account \"{account.Name}\" is switched off.");
                else if (date is { } dd && dd < account.OpeningDate) problems.Add($"{account.Name} opens on {FinanceRules.Format(account.OpeningDate)}. The date cannot be earlier.");

                decimal? amount = null;
                if (!TryAmount(row.Cell(columns["Amount"]), out var a)) problems.Add("The amount is missing or not a number.");
                else if (FinanceRules.AmountError(a) is { } amountError) problems.Add(amountError);
                else amount = a;

                var reference = Cell(row, "Reference");
                if (reference?.Length > 60) problems.Add("The reference is longer than 60 characters.");
                var notes = Cell(row, "Notes");
                if (notes?.Length > 2000) problems.Add("The notes are longer than 2,000 characters.");

                if (date is { } when)
                {
                    var key = (when.Year, when.Month);
                    if (!lockedCache.TryGetValue(key, out var locked)) lockedCache[key] = locked = await periods.LockedMessageAsync(when, ct);
                    if (locked is not null) problems.Add(locked);
                }

                parsed.Add((row, date, party, category, account, amount, reference, notes, problems));
            }

            // A row already recorded (same day, account, amount and name) is skipped, so running the same file twice adds nothing twice.
            var dates = parsed.Where(p => p.Date is not null).Select(p => p.Date!.Value).ToList();
            var existing = new HashSet<(DateOnly, int, decimal, string)>();
            if (dates.Count > 0)
            {
                var from = dates.Min();
                var to = dates.Max();
                var rows = await db.FinEntries.AsNoTracking().Where(e => e.Kind == kind && e.Status != FinStatuses.Voided && e.EntryDate >= from && e.EntryDate <= to)
                    .Select(e => new { e.EntryDate, e.AccountId, e.Amount, e.Party }).ToListAsync(ct);
                foreach (var r in rows) existing.Add((r.EntryDate, r.AccountId, r.Amount, r.Party.ToLowerInvariant()));
            }

            var seen = new HashSet<(DateOnly, int, decimal, string)>();
            var result = new List<FinImportRow>();
            var ready = new List<(DateOnly Date, string Party, FinCategory Category, FinAccount Account, decimal Amount, string? Reference, string? Notes, int Row)>();
            foreach (var p in parsed)
            {
                var status = "Ready";
                var problems = p.Problems;
                if (problems.Count > 0) status = "Error";
                else
                {
                    var key = (p.Date!.Value, p.Account!.Id, p.Amount!.Value, p.Party!.ToLowerInvariant());
                    if (existing.Contains(key)) { status = "Duplicate"; problems = ["Already recorded: same day, account, amount and name. It is skipped."]; }
                    else if (!seen.Add(key)) { status = "Duplicate"; problems = ["The same row appears twice in this file. Only the first is imported."]; }
                    else ready.Add((p.Date.Value, p.Party, p.Category!, p.Account, p.Amount.Value, p.Reference, p.Notes, p.Row.RowNumber()));
                }

                result.Add(new FinImportRow(
                    p.Row.RowNumber(), p.Date is { } d ? FinanceRules.Format(d) : null, p.Party, p.Category?.Name, p.Account?.Name, p.Amount, p.Reference, p.Notes, status, problems));
            }

            var errors = result.Count(r => r.Status == "Error");
            var summary = new FinImportResult(result, ready.Count, result.Count(r => r.Status == "Duplicate"), errors, ready.Sum(r => r.Amount), 0);
            if (!commit) return FinResult<FinImportResult>.Ok(summary);
            if (errors > 0) return FinResult<FinImportResult>.Invalid("file", $"{errors} row{(errors == 1 ? " has a" : "s have")} problem{(errors == 1 ? "" : "s")}. Fix {(errors == 1 ? "it" : "them")} in the file and upload it again. Nothing was imported.");
            if (ready.Count == 0) return FinResult<FinImportResult>.Invalid("file", "There is nothing new to import.");

            var actor = FinanceRules.Actor(http);
            var now = DateTime.UtcNow;
            var batch = Guid.NewGuid().ToString("N")[..10];
            var (sequence, prefix) = kind == FinEntryKinds.Income ? ("FinIncomeNo", "INC-") : ("FinExpenseNo", "EXP-");
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            foreach (var r in ready)
            {
                await using var command = db.Database.GetDbConnection().CreateCommand();
                command.Transaction = transaction.GetDbTransaction();
                command.CommandText = $"SELECT NEXT VALUE FOR {sequence}";   // one of two constants above
                var number = Convert.ToInt32(await command.ExecuteScalarAsync(ct), CultureInfo.InvariantCulture);
                var entry = new FinEntry
                {
                    Kind = kind, EntryNo = prefix + number.ToString("000000"), EntryDate = r.Date, CategoryId = r.Category.Id, Party = r.Party, AccountId = r.Account.Id,
                    Amount = r.Amount, Reference = r.Reference, Notes = r.Notes, CreatedBy = actor, CreatedUtc = now, ExternalSource = Source, ExternalId = $"{batch}-{r.Row}",
                };
                entry.Lines.Add(new FinEntryLine { CategoryId = r.Category.Id, Amount = r.Amount });
                db.FinEntries.Add(entry);
            }

            audit.Write("FinImportCompleted", entityType: nameof(FinEntry), entityId: batch,
                details: new { kind, imported = ready.Count, skippedDuplicates = summary.Duplicates, total = summary.ReadyTotal });
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            return FinResult<FinImportResult>.Ok(summary with { Imported = ready.Count });
        }
    }
}
