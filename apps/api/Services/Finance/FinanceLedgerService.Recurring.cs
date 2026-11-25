using System.Globalization;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services.Finance;

// Recurring journals: the accountant sets one up once (prepaid rent, depreciation, an accrual) and each month it comes due it is posted as an ordinary manual journal.
// Nothing posts by itself in the background: "post due" is run by a person, so a locked month or a mistake is seen, not hidden.
public sealed partial class FinanceLedgerService
{
    private static readonly SemaphoreSlim RecurringGate = new(1, 1);

    private static bool TryMonth(string? text, out DateOnly month)
    {
        month = default;
        return text is { Length: 7 } && text[4] == '-' && int.TryParse(text[..4], NumberStyles.None, CultureInfo.InvariantCulture, out var y) && int.TryParse(text[5..], NumberStyles.None, CultureInfo.InvariantCulture, out var m)
            && m is >= 1 and <= 12 && y is >= 2000 and <= 2100 && (month = new DateOnly(y, m, 1)) == month;
    }

    private static string Key(DateOnly month) => month.ToString("yyyy-MM", CultureInfo.InvariantCulture);

    private static DateOnly DueDate(RecurringJournal r, DateOnly month) => new(month.Year, month.Month, Math.Min(r.DayOfMonth, DateTime.DaysInMonth(month.Year, month.Month)));

    /// <summary>The months of a template that have not been posted yet and whose day has arrived.</summary>
    private static List<DateOnly> DueMonths(RecurringJournal r, HashSet<DateOnly> posted, DateOnly today)
    {
        var result = new List<DateOnly>();
        if (!r.IsActive) return result;
        for (var m = r.StartMonth; m <= new DateOnly(today.Year, today.Month, 1); m = m.AddMonths(1))
        {
            if (r.EndMonth is { } end && m > end) break;
            if (!posted.Contains(m) && DueDate(r, m) <= today) result.Add(m);
        }

        return result;
    }

    public async Task<List<RecurringJournalResponse>> RecurringAsync(CancellationToken ct)
    {
        var today = FinanceRules.Today(time);
        var templates = await db.RecurringJournals.AsNoTracking().Include(r => r.Lines).ThenInclude(l => l.LedgerAccount).OrderByDescending(r => r.IsActive).ThenBy(r => r.Description).ToListAsync(ct);
        var runs = (await db.RecurringJournalRuns.AsNoTracking().ToListAsync(ct)).GroupBy(r => r.RecurringJournalId).ToDictionary(g => g.Key, g => g.Select(r => r.Month).ToHashSet());
        return templates.Select(r =>
        {
            var posted = runs.GetValueOrDefault(r.Id) ?? [];
            var due = DueMonths(r, posted, today);
            DateOnly? next = null;
            if (r.IsActive)
                for (var m = r.StartMonth; r.EndMonth is null ? m <= today.AddYears(5) : m <= r.EndMonth; m = m.AddMonths(1))
                    if (!posted.Contains(m)) { next = m; break; }

            return new RecurringJournalResponse(r.Id, r.Description, r.DayOfMonth, Key(r.StartMonth), r.EndMonth is { } e ? Key(e) : null, r.IsActive,
                r.Lines.OrderByDescending(l => l.Debit).ThenBy(l => l.Id).Select(l => new JournalLineResponse(l.LedgerAccount.Code, l.LedgerAccount.Name, l.Debit, l.Credit, l.Memo)).ToList(),
                r.Lines.Sum(l => l.Debit), posted.Count, next is { } n ? Key(n) : null, due.Count, r.CreatedBy, r.StoppedBy);
        }).ToList();
    }

    public async Task<FinResult<RecurringJournalResponse>> CreateRecurringAsync(RecurringJournalRequest request, CancellationToken ct)
    {
        var errors = new Dictionary<string, string[]>();
        var description = FinanceRules.Clean(request.Description);
        if (description is null) errors["description"] = ["Enter what this journal is for."];
        else if (description.Length > 200) errors["description"] = ["Use 200 characters or fewer."];
        if (request.DayOfMonth is not (>= 1 and <= 31)) errors["dayOfMonth"] = ["Choose a day from 1 to 31. A shorter month uses its last day."];
        if (!TryMonth(request.StartMonth, out var start)) errors["startMonth"] = ["Choose the first month."];
        DateOnly? end = null;
        if (!string.IsNullOrWhiteSpace(request.EndMonth))
        {
            if (!TryMonth(request.EndMonth, out var e)) errors["endMonth"] = ["Choose the last month."];
            else if (!errors.ContainsKey("startMonth") && e < start) errors["endMonth"] = ["The last month cannot be before the first."];
            else end = e;
        }

        var lines = request.Lines ?? [];
        var rows = new List<(int Account, decimal Debit, decimal Credit, string? Memo)>();
        if (lines.Count < 2) errors["lines"] = ["A journal needs at least two lines."];
        else if (lines.Count > 50) errors["lines"] = ["Use at most 50 lines."];
        else
        {
            var ids = lines.Where(l => l.AccountId is not null).Select(l => l.AccountId!.Value).Distinct().ToList();
            var known = await db.LedgerAccounts.AsNoTracking().Where(a => ids.Contains(a.Id)).ToDictionaryAsync(a => a.Id, ct);
            foreach (var l in lines)
            {
                if (l.AccountId is not { } a || !known.TryGetValue(a, out var acc) || !acc.IsActive) { errors["lines"] = ["Every line needs an active account."]; break; }
                var debit = l.Debit ?? 0m;
                var credit = l.Credit ?? 0m;
                if (debit < 0m || credit < 0m || (debit > 0m) == (credit > 0m)) { errors["lines"] = ["Every line is either a debit or a credit, above zero."]; break; }
                if (!FinanceCalculator.IsMoney(debit) || !FinanceCalculator.IsMoney(credit) || debit > FinanceRules.MaxAmount || credit > FinanceRules.MaxAmount) { errors["lines"] = ["Use at most 2 decimal places, and a smaller amount."]; break; }
                if (FinanceRules.Clean(l.Memo)?.Length > 200) { errors["lines"] = ["A line note takes 200 characters or fewer."]; break; }
                rows.Add((a, debit, credit, FinanceRules.Clean(l.Memo)));
            }

            if (!errors.ContainsKey("lines") && rows.Sum(r => r.Debit) != rows.Sum(r => r.Credit))
                errors["lines"] = [$"The journal does not balance: debits are {rows.Sum(r => r.Debit):N2} and credits are {rows.Sum(r => r.Credit):N2}."];
        }

        if (errors.Count > 0) return FinResult<RecurringJournalResponse>.Invalid(errors);
        var template = new RecurringJournal { Description = description!, DayOfMonth = request.DayOfMonth!.Value, StartMonth = start, EndMonth = end, CreatedBy = FinanceRules.Actor(http), CreatedUtc = DateTime.UtcNow };
        foreach (var r in rows) template.Lines.Add(new RecurringJournalLine { LedgerAccountId = r.Account, Debit = r.Debit, Credit = r.Credit, Memo = r.Memo });
        db.RecurringJournals.Add(template);
        audit.Write("LedgerRecurringCreated", entityType: nameof(RecurringJournal), entityId: "new", details: new { description, day = template.DayOfMonth, start = Key(start), end = end is { } x ? Key(x) : null, debit = rows.Sum(r => r.Debit) });
        await db.SaveChangesAsync(ct);
        return FinResult<RecurringJournalResponse>.Created((await RecurringAsync(ct)).Single(r => r.Id == template.Id));
    }

    public async Task<FinResult<RecurringJournalResponse>> StopRecurringAsync(int id, CancellationToken ct)
    {
        var template = await db.RecurringJournals.SingleOrDefaultAsync(r => r.Id == id, ct);
        if (template is null) return FinResult<RecurringJournalResponse>.NotFound("The recurring journal was not found.");
        if (!template.IsActive) return FinResult<RecurringJournalResponse>.Conflict("It is already stopped.");
        template.IsActive = false;
        template.StoppedBy = FinanceRules.Actor(http);
        template.StoppedUtc = DateTime.UtcNow;
        audit.Write("LedgerRecurringStopped", entityType: nameof(RecurringJournal), entityId: id.ToString(), details: new { template.Description });
        await db.SaveChangesAsync(ct);
        return FinResult<RecurringJournalResponse>.Ok((await RecurringAsync(ct)).Single(r => r.Id == id));
    }

    /// <summary>
    /// Posts every month that has come due, oldest first, as a manual journal. A month that cannot be posted (it is locked) is left for later and reported. Running it twice posts nothing twice.
    /// </summary>
    public async Task<RecurringRunResult> PostDueRecurringAsync(CancellationToken ct)
    {
        await RecurringGate.WaitAsync(ct);
        try
        {
            var today = FinanceRules.Today(time);
            var templates = await db.RecurringJournals.AsNoTracking().Include(r => r.Lines).Where(r => r.IsActive).OrderBy(r => r.Id).ToListAsync(ct);
            var runs = (await db.RecurringJournalRuns.AsNoTracking().ToListAsync(ct)).GroupBy(r => r.RecurringJournalId).ToDictionary(g => g.Key, g => g.Select(r => r.Month).ToHashSet());
            var posted = 0;
            var skipped = new List<RecurringSkip>();
            foreach (var t in templates)
            {
                foreach (var month in DueMonths(t, runs.GetValueOrDefault(t.Id) ?? [], today))
                {
                    var date = DueDate(t, month);
                    var made = await PostManualAsync(new ManualJournalRequest
                    {
                        Date = FinanceRules.Format(date), Description = $"{t.Description} (monthly, {month.ToString("MMMM yyyy", CultureInfo.InvariantCulture)})",
                        Lines = t.Lines.OrderBy(l => l.Id).Select(l => new ManualJournalLineRequest { AccountId = l.LedgerAccountId, Debit = l.Debit > 0m ? l.Debit : null, Credit = l.Credit > 0m ? l.Credit : null, Memo = l.Memo }).ToList(),
                    }, ct);
                    if (made.Status is not (200 or 201))
                    {
                        skipped.Add(new(t.Id, t.Description, Key(month), made.Title ?? string.Join(" ", made.Errors?.Values.SelectMany(v => v) ?? ["It could not be posted."])));
                        continue;
                    }

                    db.RecurringJournalRuns.Add(new RecurringJournalRun { RecurringJournalId = t.Id, Month = month, JournalId = made.Value!.Id, PostedUtc = DateTime.UtcNow });
                    audit.Write("LedgerRecurringPosted", entityType: nameof(RecurringJournal), entityId: t.Id.ToString(), details: new { t.Description, month = Key(month), journal = made.Value.Number });
                    await db.SaveChangesAsync(ct);
                    posted++;
                }
            }

            return new(posted, skipped);
        }
        finally
        {
            RecurringGate.Release();
        }
    }
}
