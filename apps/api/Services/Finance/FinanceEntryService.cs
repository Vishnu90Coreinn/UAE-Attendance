using System.Security.Cryptography;
using System.Text.Json;
using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace HrPayroll.Api.Services.Finance;

public sealed record FinEntryFilter(string? From, string? To, int? CategoryId, int? AccountId, decimal? Min, decimal? Max, string? Search, bool IncludeVoided, int? PartnerId = null, int? PayeeId = null, string? CreatedBy = null);

/// <summary>Expenses and income (one table, two kinds): recording them with their receipts, and listing them with filters.</summary>
public sealed class FinanceEntryService(AppDbContext db, IAuditLogger audit, IHttpContextAccessor http, TimeProvider time, IReceiptStore store, FinancePeriodService periods)
{
    private const int ListCap = 500;
    private const int MaxLines = 20;
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    private sealed record LineInput(int? CategoryId, decimal? Amount, string? Note);

    private static string KindWord(string kind) => kind switch
    {
        FinEntryKinds.Income => "income", FinEntryKinds.Capital => "capital contribution", FinEntryKinds.CapitalOut => "capital return", _ => "expense",
    };

    /// <summary>"FinIncomeVoided", "FinCapitalCreated" and so on: the audit action for one kind and one verb.</summary>
    private static string AuditName(string kind, string verb) =>
        "Fin" + (kind switch { FinEntryKinds.Income => "Income", FinEntryKinds.Capital => "Capital", FinEntryKinds.CapitalOut => "CapitalReturn", _ => "Expense" }) + verb;

    private static (string Sequence, string Prefix) Numbering(string kind) => kind switch
    {
        FinEntryKinds.Income => ("FinIncomeNo", "INC-"), FinEntryKinds.Capital => ("FinCapitalNo", "CAP-"), FinEntryKinds.CapitalOut => ("FinCapitalOutNo", "RTN-"), _ => ("FinExpenseNo", "EXP-"),
    };

    private static FinEntryResponse ToResponse(FinEntry e, IEnumerable<FinAttachment> files, string? replacesNo = null, string? replacedByNo = null) => new(
        e.Id, e.Kind, e.EntryNo, FinanceRules.Format(e.EntryDate), e.CategoryId, e.Category.Name, e.Party, e.AccountId, e.Account.Name,
        e.Amount, e.Reference, e.Notes, e.Status, e.VoidReason, e.CreatedBy, e.CreatedUtc,
        files.Select(f => new FinAttachmentResponse(f.Id, f.FileName, f.ContentType, f.SizeBytes)).ToList(),
        e.VoidedBy, e.VoidedUtc, e.ReplacesEntryId, replacesNo, replacedByNo, e.PartnerId, e.PayeeId,
        e.Lines.OrderByDescending(l => l.Amount).ThenBy(l => l.Id).Select(l => new FinEntryLineResponse(l.CategoryId, l.Category.Name, l.Amount, l.Note)).ToList(),
        e.TaxTypeId, e.TaxRate, e.TaxAmount, e.TaxInclusive, e.InvoiceId, e.BillId, e.RecoverableTaxPercent);

    /// <summary>EntryNo of the entry each given entry replaces, and of the entry that replaced it.</summary>
    private async Task<(Dictionary<int, string> Replaces, Dictionary<int, string> ReplacedBy)> ChainAsync(IReadOnlyCollection<FinEntry> rows, CancellationToken ct)
    {
        var ids = rows.Select(r => r.Id).ToList();
        var replacedBy = await db.FinEntries.AsNoTracking().Where(e => e.ReplacesEntryId != null && ids.Contains(e.ReplacesEntryId.Value))
            .Select(e => new { Original = e.ReplacesEntryId!.Value, e.EntryNo }).ToDictionaryAsync(x => x.Original, x => x.EntryNo, ct);
        var originalIds = rows.Where(r => r.ReplacesEntryId != null).Select(r => r.ReplacesEntryId!.Value).ToList();
        var replaces = await db.FinEntries.AsNoTracking().Where(e => originalIds.Contains(e.Id)).ToDictionaryAsync(e => e.Id, e => e.EntryNo, ct);
        return (replaces, replacedBy);
    }

    public Task<FinEntryList> ListAsync(string kind, FinEntryFilter f, CancellationToken ct) => ListAsync([kind], f, ct);

    /// <summary>Capital in and capital out are listed together; the total is then what is left: put in, less paid back.</summary>
    public async Task<FinEntryList> ListAsync(IReadOnlyCollection<string> kinds, FinEntryFilter f, CancellationToken ct)
    {
        var query = db.FinEntries.AsNoTracking().Include(e => e.Category).Include(e => e.Account).Include(e => e.Lines).ThenInclude(l => l.Category).Where(e => kinds.Contains(e.Kind));
        if (f.PartnerId is { } partner) query = query.Where(e => e.PartnerId == partner);
        if (f.CreatedBy is { } by) query = query.Where(e => e.CreatedBy == by);
        if (FinanceRules.TryParseDate(f.From, out var from)) query = query.Where(e => e.EntryDate >= from);
        if (FinanceRules.TryParseDate(f.To, out var to)) query = query.Where(e => e.EntryDate <= to);
        if (f.CategoryId is { } c) query = query.Where(e => e.CategoryId == c || e.Lines.Any(l => l.CategoryId == c));
        if (f.AccountId is { } a) query = query.Where(e => e.AccountId == a);
        if (f.Min is { } min) query = query.Where(e => e.Amount >= min);
        if (f.Max is { } max) query = query.Where(e => e.Amount <= max);
        if (f.PayeeId is { } payee) query = query.Where(e => e.PayeeId == payee);
        if (FinanceRules.Clean(f.Search) is { } q)
            query = query.Where(e => e.Party.Contains(q) || (e.Reference != null && e.Reference.Contains(q)) || (e.Notes != null && e.Notes.Contains(q)) || e.EntryNo.Contains(q));

        var active = query.Where(e => e.Status == FinStatuses.Active);
        var total = (await active.Where(e => e.Kind != FinEntryKinds.CapitalOut).SumAsync(e => (decimal?)e.Amount, ct) ?? 0m)
            - (await active.Where(e => e.Kind == FinEntryKinds.CapitalOut).SumAsync(e => (decimal?)e.Amount, ct) ?? 0m);
        var count = await active.CountAsync(ct);
        var pending = query.Where(e => e.Status == FinStatuses.Pending);
        var pendingCount = await pending.CountAsync(ct);
        var pendingTotal = await pending.SumAsync(e => (decimal?)e.Amount, ct) ?? 0m;
        var shown = f.IncludeVoided ? query : query.Where(e => e.Status != FinStatuses.Voided);
        var rows = await shown.OrderByDescending(e => e.EntryDate).ThenByDescending(e => e.Id).Take(ListCap + 1).ToListAsync(ct);
        var truncated = rows.Count > ListCap;
        rows = rows.Take(ListCap).ToList();

        var ids = rows.Select(r => r.Id).ToList();
        var files = (await db.FinAttachments.AsNoTracking().Where(x => ids.Contains(x.EntryId)).OrderBy(x => x.Id).ToListAsync(ct)).ToLookup(x => x.EntryId);
        var (replaces, replacedBy) = await ChainAsync(rows, ct);
        return new(rows.Select(r => ToResponse(r, files[r.Id], r.ReplacesEntryId is { } o ? replaces.GetValueOrDefault(o) : null, replacedBy.GetValueOrDefault(r.Id))).ToList(), total, count, truncated, pendingCount, pendingTotal);
    }

    public async Task<FinResult<FinEntryResponse>> GetAsync(string kind, int id, CancellationToken ct)
    {
        var entry = await db.FinEntries.AsNoTracking().Include(e => e.Category).Include(e => e.Account).Include(e => e.Lines).ThenInclude(l => l.Category).SingleOrDefaultAsync(e => e.Id == id && e.Kind == kind, ct);
        if (entry is null) return FinResult<FinEntryResponse>.NotFound($"The {KindWord(kind)} was not found.");
        var files = await db.FinAttachments.AsNoTracking().Where(x => x.EntryId == id).OrderBy(x => x.Id).ToListAsync(ct);
        var (replaces, replacedBy) = await ChainAsync([entry], ct);
        return FinResult<FinEntryResponse>.Ok(ToResponse(entry, files, entry.ReplacesEntryId is { } o ? replaces.GetValueOrDefault(o) : null, replacedBy.GetValueOrDefault(id)));
    }

    /// <summary>Whether the entry was entered by this person.</summary>
    public Task<bool> IsCreatedByAsync(int entryId, string actor, CancellationToken ct) => db.FinEntries.AsNoTracking().AnyAsync(e => e.Id == entryId && e.CreatedBy == actor, ct);

    /// <summary>Which kind an entry is, or null when there is no such entry.</summary>
    public async Task<string?> KindOfAsync(int id, CancellationToken ct) =>
        await db.FinEntries.AsNoTracking().Where(e => e.Id == id).Select(e => e.Kind).SingleOrDefaultAsync(ct);

    /// <summary>The names people have typed before, newest first, to suggest while typing "paid to" or "received from".</summary>
    public async Task<List<string>> PartiesAsync(string kind, CancellationToken ct) =>
        await db.FinEntries.AsNoTracking().Where(e => e.Kind == kind)
            .GroupBy(e => e.Party).Select(g => new { Party = g.Key, Last = g.Max(e => e.Id) })
            .OrderByDescending(g => g.Last).Take(50).Select(g => g.Party).ToListAsync(ct);

    public Task<FinResult<FinEntryResponse>> CreateAsync(string kind, FinExpenseForm form, CancellationToken ct) => SaveAsync(kind, form, null, ct);

    /// <summary>A staff member's expense: saved as Pending, with a number, until a Manager approves or rejects it. Counts in nothing meanwhile.</summary>
    public Task<FinResult<FinEntryResponse>> SubmitAsync(FinExpenseForm form, CancellationToken ct) => SaveAsync(FinEntryKinds.Expense, form, null, ct, pending: true);

    public async Task<FinResult<FinEntryResponse>> ApproveAsync(int id, CancellationToken ct)
    {
        var entry = await db.FinEntries.Include(e => e.Account).SingleOrDefaultAsync(e => e.Id == id && e.Kind == FinEntryKinds.Expense, ct);
        if (entry is null) return FinResult<FinEntryResponse>.NotFound("The expense was not found.");
        if (entry.Status != FinStatuses.Pending) return FinResult<FinEntryResponse>.Conflict($"{entry.EntryNo} is not waiting for approval.");
        if (await periods.LockedMessageAsync(entry.EntryDate, ct) is { } locked) return FinResult<FinEntryResponse>.Conflict(locked + " Reject it and have it entered again with a date in an open month.");
        if (entry.EntryDate < entry.Account.OpeningDate) return FinResult<FinEntryResponse>.Conflict($"{entry.Account.Name} opens on {FinanceRules.Format(entry.Account.OpeningDate)}. Reject it and have it entered again.");

        entry.Status = FinStatuses.Active;
        audit.Write("FinExpenseApproved", entityType: nameof(FinEntry), entityId: entry.Id.ToString(), details: new { entry.EntryNo, entry.Amount, submittedBy = entry.CreatedBy });
        await db.SaveChangesAsync(ct);
        return await GetAsync(FinEntryKinds.Expense, id, ct);
    }

    public async Task<FinResult<FinEntryResponse>> RejectAsync(int id, string? reason, CancellationToken ct)
    {
        var text = FinanceRules.Clean(reason);
        if (text is null) return FinResult<FinEntryResponse>.Invalid("reason", "Enter the reason. It is shown to the person who submitted it.");
        if (text.Length > 280) return FinResult<FinEntryResponse>.Invalid("reason", "Use 280 characters or fewer.");
        var entry = await db.FinEntries.SingleOrDefaultAsync(e => e.Id == id && e.Kind == FinEntryKinds.Expense, ct);
        if (entry is null) return FinResult<FinEntryResponse>.NotFound("The expense was not found.");
        if (entry.Status != FinStatuses.Pending) return FinResult<FinEntryResponse>.Conflict($"{entry.EntryNo} is not waiting for approval.");

        entry.Status = FinStatuses.Voided;
        entry.VoidReason = "Rejected: " + text;
        entry.VoidedBy = FinanceRules.Actor(http);
        entry.VoidedUtc = DateTime.UtcNow;
        audit.Write("FinExpenseRejected", entityType: nameof(FinEntry), entityId: entry.Id.ToString(), details: new { entry.EntryNo, entry.Amount, submittedBy = entry.CreatedBy, reason = text });
        await db.SaveChangesAsync(ct);
        return await GetAsync(FinEntryKinds.Expense, id, ct);
    }

    /// <summary>Corrects an entry: the original is voided and a replacement that points back at it is added, in one transaction.</summary>
    public async Task<FinResult<FinEntryResponse>> CorrectAsync(string kind, int id, FinExpenseForm form, CancellationToken ct)
    {
        var original = await db.FinEntries.SingleOrDefaultAsync(e => e.Id == id && e.Kind == kind, ct);
        if (original is null) return FinResult<FinEntryResponse>.NotFound($"The {KindWord(kind)} was not found.");
        if (original.Status == FinStatuses.Pending) return FinResult<FinEntryResponse>.Conflict($"{original.EntryNo} is waiting for approval. Approve or reject it first.");
        if (original.Status != FinStatuses.Active) return FinResult<FinEntryResponse>.Conflict($"{original.EntryNo} is already voided and cannot be corrected.");
        if (await db.FinEntries.AnyAsync(e => e.ReplacesEntryId == id, ct)) return FinResult<FinEntryResponse>.Conflict($"{original.EntryNo} has already been corrected.");
        if (await LinkedChequeMessageAsync(original.Id, original.EntryNo, ct) is { } linked) return FinResult<FinEntryResponse>.Conflict(linked);
        if (original.InvoiceId is not null) return FinResult<FinEntryResponse>.Conflict($"{original.EntryNo} is a payment on a tax invoice. Remove the payment on the invoice and record it again.");
        if (original.BillId is not null) return FinResult<FinEntryResponse>.Conflict($"{original.EntryNo} is a payment on a supplier bill. Take the payment back on the bill and pay it again.");
        return await SaveAsync(kind, form, original, ct);
    }

    /// <summary>An entry paid by a cheque that is still live (not cancelled or bounced) cannot be voided or corrected: the cheque has to be dealt with first.</summary>
    private async Task<string?> LinkedChequeMessageAsync(int entryId, string entryNo, CancellationToken ct)
    {
        var serial = await db.FinCheques.AsNoTracking().Where(c => c.EntryId == entryId && c.Status != FinChequeStatuses.Cancelled && c.Status != FinChequeStatuses.Bounced).Select(c => c.Serial).FirstOrDefaultAsync(ct);
        return serial is null ? null : $"{entryNo} is linked to cheque {serial}. Cancel the cheque, or take the link off it while it is still open, before voiding or correcting this.";
    }

    public async Task<FinResult<FinEntryResponse>> VoidAsync(string kind, int id, string? reason, CancellationToken ct)
    {
        var text = FinanceRules.Clean(reason);
        if (text is null) return FinResult<FinEntryResponse>.Invalid("reason", $"Enter the reason for voiding this {KindWord(kind)}.");
        if (text.Length > 300) return FinResult<FinEntryResponse>.Invalid("reason", "Use 300 characters or fewer.");
        var entry = await db.FinEntries.Include(e => e.Category).Include(e => e.Account).Include(e => e.Lines).ThenInclude(l => l.Category).SingleOrDefaultAsync(e => e.Id == id && e.Kind == kind, ct);
        if (entry is null) return FinResult<FinEntryResponse>.NotFound($"The {KindWord(kind)} was not found.");
        if (entry.Status == FinStatuses.Pending) return FinResult<FinEntryResponse>.Conflict($"{entry.EntryNo} is waiting for approval. Approve or reject it instead.");
        if (entry.Status != FinStatuses.Active) return FinResult<FinEntryResponse>.Conflict($"{entry.EntryNo} is already voided.");
        if (await periods.LockedMessageAsync(entry.EntryDate, ct) is { } locked) return FinResult<FinEntryResponse>.Conflict(locked);
        if (await LinkedChequeMessageAsync(entry.Id, entry.EntryNo, ct) is { } linked) return FinResult<FinEntryResponse>.Conflict(linked);
        if (entry.InvoiceId is not null) return FinResult<FinEntryResponse>.Conflict($"{entry.EntryNo} is a payment on a tax invoice. Remove the payment on the invoice instead.");
        if (entry.BillId is not null) return FinResult<FinEntryResponse>.Conflict($"{entry.EntryNo} is a payment on a supplier bill. Take the payment back on the bill instead.");

        entry.Status = FinStatuses.Voided;
        entry.VoidReason = text;
        entry.VoidedBy = FinanceRules.Actor(http);
        entry.VoidedUtc = DateTime.UtcNow;
        audit.Write(AuditName(kind, "Voided"), entityType: nameof(FinEntry), entityId: entry.Id.ToString(),
            details: new { entry.EntryNo, entry.Amount, reason = text });
        await db.SaveChangesAsync(ct);
        return await GetAsync(kind, id, ct);
    }

    private async Task<FinResult<FinEntryResponse>> SaveAsync(string kind, FinExpenseForm form, FinEntry? replaces, CancellationToken ct, bool pending = false)
    {
        var errors = new Dictionary<string, string[]>();
        if (FinanceRules.AmountError(form.Amount) is { } amountError) errors["amount"] = [amountError];
        var capital = FinEntryKinds.IsCapital(kind);
        var party = FinanceRules.Clean(form.Party);
        FinPartner? partner = null;
        FinPayee? payee = null;
        if (capital)
        {
            if (form.PartnerId is null) errors["partnerId"] = ["Choose the partner."];
            else
            {
                partner = await db.FinPartners.SingleOrDefaultAsync(p => p.Id == form.PartnerId, ct);
                if (partner is null || !partner.IsActive) errors["partnerId"] = ["Choose an active partner."];
            }

            party = partner?.Name;
        }
        else
        {
            if (form.PayeeId is { } payeeId)
            {
                payee = await db.FinPayees.AsNoTracking().SingleOrDefaultAsync(p => p.Id == payeeId, ct);
                if (payee is null || !payee.IsActive || payee.Kind != kind) errors["payeeId"] = ["Choose an active payee of the right type."];
                else party = payee.Name;
            }

            var partyLabel = kind == FinEntryKinds.Income ? "who it was received from" : "who was paid";
            if (party is null) errors["party"] = [$"Enter {partyLabel}."];
            else if (party.Length > 120) errors["party"] = ["Use 120 characters or fewer."];
        }
        if (FinanceRules.Clean(form.Reference)?.Length > 60) errors["reference"] = ["Use 60 characters or fewer."];
        if (FinanceRules.Clean(form.Notes)?.Length > 2000) errors["notes"] = ["Use 2,000 characters or fewer."];

        DateOnly date = default;
        if (!FinanceRules.TryParseDate(form.EntryDate, out date)) errors["entryDate"] = ["Enter the date."];
        else if (date > FinanceRules.Today(time)) errors["entryDate"] = ["The date cannot be in the future."];

        FinCategory? category = null;
        var lineRows = new List<FinEntryLine>();
        if (capital) category = await db.FinCategories.SingleAsync(c => c.Kind == kind, ct);
        else
        {
            var inputs = new List<LineInput>();
            if (!string.IsNullOrWhiteSpace(form.LinesJson))
            {
                try { inputs = JsonSerializer.Deserialize<List<LineInput>>(form.LinesJson, JsonOptions) ?? []; }
                catch (JsonException) { errors["lines"] = ["The category lines could not be read."]; }
                if (inputs.Count == 0 && !errors.ContainsKey("lines")) errors["lines"] = ["Add at least one category line."];
            }
            else if (form.CategoryId is null) errors["categoryId"] = ["Choose a category."];
            else inputs.Add(new LineInput(form.CategoryId, form.Amount, null));

            var key = inputs.Count > 1 || !string.IsNullOrWhiteSpace(form.LinesJson) ? "lines" : "categoryId";
            if (inputs.Count > MaxLines) errors["lines"] = [$"Use at most {MaxLines} lines."];
            else if (inputs.Count > 0)
            {
                var ids = inputs.Where(i => i.CategoryId is not null).Select(i => i.CategoryId!.Value).Distinct().ToList();
                var found = await db.FinCategories.Where(c => ids.Contains(c.Id) && c.Kind == kind).ToDictionaryAsync(c => c.Id, ct);
                foreach (var input in inputs)
                {
                    if (input.CategoryId is null || !found.TryGetValue(input.CategoryId.Value, out var lineCategory) || !lineCategory.IsActive || lineCategory.IsSystem)   // system categories are posted by the app, never picked by hand
                    {
                        errors[key] = [key == "lines" ? "Choose an active category on every line." : "Choose an active category."];
                        break;
                    }

                    if (FinanceRules.AmountError(input.Amount) is { } lineAmountError)
                    {
                        if (key == "lines") errors[key] = [$"Every line needs a valid amount: {lineAmountError}"];
                        break;   // a single line shares the entry's amount, whose error is already reported
                    }

                    if (FinanceRules.Clean(input.Note)?.Length > 200) { errors["lines"] = ["A line note takes 200 characters or fewer."]; break; }
                    lineRows.Add(new FinEntryLine { CategoryId = lineCategory.Id, Category = lineCategory, Amount = input.Amount!.Value, Note = FinanceRules.Clean(input.Note) });
                }

                if (!errors.ContainsKey(key) && !errors.ContainsKey("amount") && lineRows.Sum(l => l.Amount) != form.Amount)
                    errors["lines"] = [$"The lines add up to AED {lineRows.Sum(l => l.Amount):N2} but the amount is AED {form.Amount:N2}."];
                if (lineRows.Count > 0) category = lineRows.OrderByDescending(l => l.Amount).First().Category;
            }

            // Settling VAT with the tax authority is booked by a Manager; staff entry and split lines do not offer it.
            var vatLine = lineRows.Any(l => FinanceRules.IsVatSettlement(l.CategoryId));
            if (((category is not null && FinanceRules.IsVatSettlement(category.Id) && pending) || (vatLine && lineRows.Count > 1)) && !errors.ContainsKey("categoryId"))
                errors["categoryId"] = [pending ? "Choose one of the expense categories offered to you." : "A VAT payment or refund cannot be split across categories."];
        }

        FinAccount? account = null;
        if (form.AccountId is null) errors["accountId"] = [kind == FinEntryKinds.Income ? "Choose the account the money went into." : "Choose the account it was paid from."];
        else
        {
            account = await db.FinAccounts.SingleOrDefaultAsync(a => a.Id == form.AccountId, ct);
            if (account is null || !account.IsActive) errors["accountId"] = ["Choose an active account."];
            else if (pending && !account.StaffCanUse && !(account.HolderUserId is { } holderId && holderId == FinanceRules.UserId(http))) errors["accountId"] = ["Choose one of the accounts you may pay from."];
        }

        if (account is not null && !errors.ContainsKey("entryDate") && date < account.OpeningDate)
            errors["entryDate"] = [$"{account.Name} opens on {FinanceRules.Format(account.OpeningDate)}. The date cannot be earlier."];

        // When correcting, the receipts being kept come from the original entry.
        var kept = new List<FinAttachment>();
        if (replaces is not null && form.KeepAttachmentIds is { Count: > 0 } keepIds)
        {
            kept = await db.FinAttachments.AsNoTracking().Where(a => a.EntryId == replaces.Id && keepIds.Contains(a.Id)).ToListAsync(ct);
            if (kept.Count != keepIds.Distinct().Count()) errors["files"] = ["One of the receipts to keep does not belong to this entry."];
        }

        // VAT: the amount typed becomes the cash that moves, the net and the tax. A split's lines scale with it when the VAT is added on top.
        var amount = form.Amount ?? 0m;
        decimal taxAmount = 0m, taxRate = 0m;
        var inclusive = form.TaxInclusive ?? true;
        var recovery = form.RecoverableTaxPercent;
        if (recovery < 0m || recovery > 100m || !FinanceCalculator.IsMoney(recovery)) errors["recoverableTaxPercent"] = ["Use a VAT recovery percentage from 0 to 100, with at most 2 decimals."];
        if (kind != FinEntryKinds.Expense && recovery != 100m) errors["recoverableTaxPercent"] = ["VAT recovery applies only to purchases."];
        // How much VAT can be reclaimed is an accounting decision: a staff submission is saved in full, and a Manager corrects it if it is blocked.
        if (pending && recovery != 100m) errors["recoverableTaxPercent"] = ["Only a Manager sets the VAT recovery percentage."];
        FinTaxType? taxType = null;
        if (!capital && !errors.ContainsKey("amount"))
        {
            var taxId = form.TaxTypeId is 0 || (category is not null && FinanceRules.IsVatSettlement(category.Id)) ? null : form.TaxTypeId ?? (category is { NoVat: true } ? null : category?.DefaultTaxTypeId);   // settling VAT, and a category that never carries VAT, record none
            if (taxId is { } id)
            {
                taxType = await db.FinTaxTypes.AsNoTracking().SingleOrDefaultAsync(t => t.Id == id, ct);
                if (taxType is null || !taxType.IsActive) errors["taxTypeId"] = ["Choose an active VAT type."];
            }

            if (taxType is not null)
            {
                (amount, _, taxAmount) = FinanceCalculator.Vat(form.Amount!.Value, taxType.Treatment, taxType.Rate, inclusive);
                taxRate = taxType.Rate;
                if (FinanceRules.AmountError(amount) is { } grossError) errors["amount"] = [grossError];
                else if (amount != form.Amount && lineRows.Count > 0)
                {
                    var scaled = FinanceCalculator.Allocate(amount, lineRows.Select(l => l.Amount).ToList());
                    for (var i = 0; i < lineRows.Count; i++) lineRows[i].Amount = scaled[i];
                }
            }
        }

        // Receipts: read and judge every file before anything is saved.
        var incoming = new List<(string Name, byte[] Bytes, string ContentType, string Extension)>();
        var files = form.Files?.ToList() ?? [];
        if (files.Count + kept.Count > ReceiptFile.MaxFiles) errors["files"] = [$"Attach at most {ReceiptFile.MaxFiles} files."];
        else if (!errors.ContainsKey("files"))
        {
            foreach (var file in files)
            {
                if (file.Length == 0 || file.Length > ReceiptFile.MaxBytes)
                {
                    errors["files"] = [$"{file.FileName}: each file must be larger than 0 and at most 5 MB."];
                    break;
                }

                await using var stream = file.OpenReadStream();
                var bytes = new byte[file.Length];
                await stream.ReadExactlyAsync(bytes, ct);
                if (ReceiptFile.Detect(bytes) is not { } kindOfFile)
                {
                    errors["files"] = [$"{file.FileName}: attach a PDF, JPEG or PNG file."];
                    break;
                }

                incoming.Add((ReceiptFile.CleanName(file.FileName, kindOfFile.Extension), bytes, kindOfFile.ContentType, kindOfFile.Extension));
            }
        }

        if (kind == FinEntryKinds.Expense && incoming.Count + kept.Count == 0 && !errors.ContainsKey("files"))
            errors["files"] = ["Attach the receipt or supplier invoice."];
        if (errors.Count > 0) return FinResult<FinEntryResponse>.Invalid(errors);

        // A locked month takes nothing new, and nothing may leave it either.
        if (await periods.LockedMessageAsync(date, ct) is { } lockedNew) return FinResult<FinEntryResponse>.Conflict(lockedNew);
        if (replaces is not null && await periods.LockedMessageAsync(replaces.EntryDate, ct) is { } lockedOld) return FinResult<FinEntryResponse>.Conflict(lockedOld);

        var stored = new List<string>();
        try
        {
            var actor = FinanceRules.Actor(http);
            var now = DateTime.UtcNow;
            var attachments = new List<FinAttachment>();
            foreach (var k in kept)
                attachments.Add(new FinAttachment { FileName = k.FileName, ContentType = k.ContentType, SizeBytes = k.SizeBytes, StoredName = k.StoredName, Sha256 = k.Sha256, UploadedBy = k.UploadedBy, UploadedUtc = k.UploadedUtc });
            foreach (var (name, bytes, contentType, extension) in incoming)
            {
                var storedName = await store.SaveAsync(bytes, extension, ct);
                stored.Add(storedName);
                attachments.Add(new FinAttachment
                {
                    FileName = name, ContentType = contentType, SizeBytes = bytes.Length, StoredName = storedName,
                    Sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(), UploadedBy = actor, UploadedUtc = now,
                });
            }

            var entry = new FinEntry
            {
                Kind = kind, EntryNo = "PENDING", EntryDate = date, CategoryId = category!.Id, Party = party!, AccountId = account!.Id,
                Amount = amount, Reference = FinanceRules.Clean(form.Reference), Notes = FinanceRules.Clean(form.Notes),
                TaxTypeId = taxType?.Id, TaxRate = taxRate, TaxAmount = taxAmount, TaxInclusive = inclusive, RecoverableTaxPercent = recovery,
                CreatedBy = actor, CreatedUtc = now, ReplacesEntryId = replaces?.Id, PartnerId = partner?.Id, PayeeId = payee?.Id, Lines = lineRows,
                Status = pending ? FinStatuses.Pending : FinStatuses.Active,
            };

            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            var (sequence, prefix) = Numbering(kind);
            await using var command = db.Database.GetDbConnection().CreateCommand();
            command.Transaction = transaction.GetDbTransaction();
            command.CommandText = $"SELECT NEXT VALUE FOR {sequence}";   // the sequence name is one of two constants above
            var number = Convert.ToInt32(await command.ExecuteScalarAsync(ct), System.Globalization.CultureInfo.InvariantCulture);
            entry.EntryNo = prefix + number.ToString("000000");
            if (replaces is not null)
            {
                // Claim the original inside the transaction: of two simultaneous corrections only one finds it still Active.
                var claimed = await db.FinEntries.Where(e => e.Id == replaces.Id && e.Status == FinStatuses.Active)
                    .ExecuteUpdateAsync(s => s.SetProperty(e => e.Status, FinStatuses.Voided).SetProperty(e => e.VoidReason, $"Corrected: replaced by {entry.EntryNo}")
                        .SetProperty(e => e.VoidedBy, actor).SetProperty(e => e.VoidedUtc, now), ct);
                if (claimed == 0)
                {
                    foreach (var name in stored) store.Delete(name);
                    return FinResult<FinEntryResponse>.Conflict($"{replaces.EntryNo} was changed by someone else and cannot be corrected.");
                }
            }

            db.FinEntries.Add(entry);
            await db.SaveChangesAsync(ct);
            foreach (var a in attachments) a.EntryId = entry.Id;
            db.FinAttachments.AddRange(attachments);
            if (replaces is not null)
            {
                replaces.Status = FinStatuses.Voided;
                replaces.VoidReason = $"Corrected: replaced by {entry.EntryNo}";
                replaces.VoidedBy = actor;
                replaces.VoidedUtc = now;
                audit.Write(AuditName(kind, "Corrected"), entityType: nameof(FinEntry), entityId: replaces.Id.ToString(),
                    details: new { original = replaces.EntryNo, replacement = entry.EntryNo, before = new { replaces.Amount, date = FinanceRules.Format(replaces.EntryDate), replaces.Party }, after = new { entry.Amount, date = FinanceRules.Format(date), entry.Party } });
            }

            audit.Write(pending ? "FinExpenseSubmitted" : AuditName(kind, "Created"), entityType: nameof(FinEntry), entityId: entry.Id.ToString(),
                details: new { entry.EntryNo, category = category.Name, account = account.Name, entry.Amount, date = FinanceRules.Format(date), receipts = attachments.Count, replaces = replaces?.EntryNo });
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);

            entry.Category = category;
            entry.Account = account;
            return FinResult<FinEntryResponse>.Created(ToResponse(entry, attachments, replaces?.EntryNo));
        }
        catch
        {
            foreach (var name in stored) store.Delete(name);   // no orphan files when the database refuses
            throw;
        }
    }

    /// <summary>A receipt's details and its file, or null when either is missing.</summary>
    public async Task<(FinAttachment Attachment, Stream Content)?> OpenAttachmentAsync(int id, CancellationToken ct)
    {
        var attachment = await db.FinAttachments.AsNoTracking().SingleOrDefaultAsync(a => a.Id == id, ct);
        if (attachment is null) return null;
        var stream = store.Open(attachment.StoredName);
        return stream is null ? null : (attachment, stream);
    }
}
