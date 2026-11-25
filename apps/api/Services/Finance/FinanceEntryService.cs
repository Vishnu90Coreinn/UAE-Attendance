using System.Security.Cryptography;
using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace HrPayroll.Api.Services.Finance;

public sealed record FinEntryFilter(string? From, string? To, int? CategoryId, int? AccountId, decimal? Min, decimal? Max, string? Search, bool IncludeVoided);

/// <summary>Expenses and income (one table, two kinds): recording them with their receipts, and listing them with filters.</summary>
public sealed class FinanceEntryService(AppDbContext db, IAuditLogger audit, IHttpContextAccessor http, TimeProvider time, IReceiptStore store, FinancePeriodService periods)
{
    private const int ListCap = 500;

    private static string KindWord(string kind) => kind == FinEntryKinds.Income ? "income" : "expense";

    private static FinEntryResponse ToResponse(FinEntry e, IEnumerable<FinAttachment> files, string? replacesNo = null, string? replacedByNo = null) => new(
        e.Id, e.Kind, e.EntryNo, FinanceRules.Format(e.EntryDate), e.CategoryId, e.Category.Name, e.Party, e.AccountId, e.Account.Name,
        e.Amount, e.Reference, e.Notes, e.Status, e.VoidReason, e.CreatedBy, e.CreatedUtc,
        files.Select(f => new FinAttachmentResponse(f.Id, f.FileName, f.ContentType, f.SizeBytes)).ToList(),
        e.VoidedBy, e.VoidedUtc, e.ReplacesEntryId, replacesNo, replacedByNo);

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

    public async Task<FinEntryList> ListAsync(string kind, FinEntryFilter f, CancellationToken ct)
    {
        var query = db.FinEntries.AsNoTracking().Include(e => e.Category).Include(e => e.Account).Where(e => e.Kind == kind);
        if (FinanceRules.TryParseDate(f.From, out var from)) query = query.Where(e => e.EntryDate >= from);
        if (FinanceRules.TryParseDate(f.To, out var to)) query = query.Where(e => e.EntryDate <= to);
        if (f.CategoryId is { } c) query = query.Where(e => e.CategoryId == c);
        if (f.AccountId is { } a) query = query.Where(e => e.AccountId == a);
        if (f.Min is { } min) query = query.Where(e => e.Amount >= min);
        if (f.Max is { } max) query = query.Where(e => e.Amount <= max);
        if (FinanceRules.Clean(f.Search) is { } q)
            query = query.Where(e => e.Party.Contains(q) || (e.Reference != null && e.Reference.Contains(q)) || (e.Notes != null && e.Notes.Contains(q)) || e.EntryNo.Contains(q));

        var active = query.Where(e => e.Status == FinStatuses.Active);
        var total = await active.SumAsync(e => (decimal?)e.Amount, ct) ?? 0m;
        var count = await active.CountAsync(ct);
        var shown = f.IncludeVoided ? query : active;
        var rows = await shown.OrderByDescending(e => e.EntryDate).ThenByDescending(e => e.Id).Take(ListCap + 1).ToListAsync(ct);
        var truncated = rows.Count > ListCap;
        rows = rows.Take(ListCap).ToList();

        var ids = rows.Select(r => r.Id).ToList();
        var files = (await db.FinAttachments.AsNoTracking().Where(x => ids.Contains(x.EntryId)).OrderBy(x => x.Id).ToListAsync(ct)).ToLookup(x => x.EntryId);
        var (replaces, replacedBy) = await ChainAsync(rows, ct);
        return new(rows.Select(r => ToResponse(r, files[r.Id], r.ReplacesEntryId is { } o ? replaces.GetValueOrDefault(o) : null, replacedBy.GetValueOrDefault(r.Id))).ToList(), total, count, truncated);
    }

    public async Task<FinResult<FinEntryResponse>> GetAsync(string kind, int id, CancellationToken ct)
    {
        var entry = await db.FinEntries.AsNoTracking().Include(e => e.Category).Include(e => e.Account).SingleOrDefaultAsync(e => e.Id == id && e.Kind == kind, ct);
        if (entry is null) return FinResult<FinEntryResponse>.NotFound($"The {KindWord(kind)} was not found.");
        var files = await db.FinAttachments.AsNoTracking().Where(x => x.EntryId == id).OrderBy(x => x.Id).ToListAsync(ct);
        var (replaces, replacedBy) = await ChainAsync([entry], ct);
        return FinResult<FinEntryResponse>.Ok(ToResponse(entry, files, entry.ReplacesEntryId is { } o ? replaces.GetValueOrDefault(o) : null, replacedBy.GetValueOrDefault(id)));
    }

    /// <summary>The names people have typed before, newest first, to suggest while typing "paid to" or "received from".</summary>
    public async Task<List<string>> PartiesAsync(string kind, CancellationToken ct) =>
        await db.FinEntries.AsNoTracking().Where(e => e.Kind == kind)
            .GroupBy(e => e.Party).Select(g => new { Party = g.Key, Last = g.Max(e => e.Id) })
            .OrderByDescending(g => g.Last).Take(50).Select(g => g.Party).ToListAsync(ct);

    public Task<FinResult<FinEntryResponse>> CreateAsync(string kind, FinExpenseForm form, CancellationToken ct) => SaveAsync(kind, form, null, ct);

    /// <summary>Corrects an entry: the original is voided and a replacement that points back at it is added, in one transaction.</summary>
    public async Task<FinResult<FinEntryResponse>> CorrectAsync(string kind, int id, FinExpenseForm form, CancellationToken ct)
    {
        var original = await db.FinEntries.SingleOrDefaultAsync(e => e.Id == id && e.Kind == kind, ct);
        if (original is null) return FinResult<FinEntryResponse>.NotFound($"The {KindWord(kind)} was not found.");
        if (original.Status != FinStatuses.Active) return FinResult<FinEntryResponse>.Conflict($"{original.EntryNo} is already voided and cannot be corrected.");
        if (await db.FinEntries.AnyAsync(e => e.ReplacesEntryId == id, ct)) return FinResult<FinEntryResponse>.Conflict($"{original.EntryNo} has already been corrected.");
        return await SaveAsync(kind, form, original, ct);
    }

    public async Task<FinResult<FinEntryResponse>> VoidAsync(string kind, int id, string? reason, CancellationToken ct)
    {
        var text = FinanceRules.Clean(reason);
        if (text is null) return FinResult<FinEntryResponse>.Invalid("reason", $"Enter the reason for voiding this {KindWord(kind)}.");
        if (text.Length > 300) return FinResult<FinEntryResponse>.Invalid("reason", "Use 300 characters or fewer.");
        var entry = await db.FinEntries.Include(e => e.Category).Include(e => e.Account).SingleOrDefaultAsync(e => e.Id == id && e.Kind == kind, ct);
        if (entry is null) return FinResult<FinEntryResponse>.NotFound($"The {KindWord(kind)} was not found.");
        if (entry.Status != FinStatuses.Active) return FinResult<FinEntryResponse>.Conflict($"{entry.EntryNo} is already voided.");
        if (await periods.LockedMessageAsync(entry.EntryDate, ct) is { } locked) return FinResult<FinEntryResponse>.Conflict(locked);

        entry.Status = FinStatuses.Voided;
        entry.VoidReason = text;
        entry.VoidedBy = FinanceRules.Actor(http);
        entry.VoidedUtc = DateTime.UtcNow;
        audit.Write(kind == FinEntryKinds.Income ? "FinIncomeVoided" : "FinExpenseVoided", entityType: nameof(FinEntry), entityId: entry.Id.ToString(),
            details: new { entry.EntryNo, entry.Amount, reason = text });
        await db.SaveChangesAsync(ct);
        return await GetAsync(kind, id, ct);
    }

    private async Task<FinResult<FinEntryResponse>> SaveAsync(string kind, FinExpenseForm form, FinEntry? replaces, CancellationToken ct)
    {
        var errors = new Dictionary<string, string[]>();
        if (FinanceRules.AmountError(form.Amount) is { } amountError) errors["amount"] = [amountError];
        var party = FinanceRules.Clean(form.Party);
        var partyLabel = kind == FinEntryKinds.Income ? "who it was received from" : "who was paid";
        if (party is null) errors["party"] = [$"Enter {partyLabel}."];
        else if (party.Length > 120) errors["party"] = ["Use 120 characters or fewer."];
        if (FinanceRules.Clean(form.Reference)?.Length > 60) errors["reference"] = ["Use 60 characters or fewer."];
        if (FinanceRules.Clean(form.Notes)?.Length > 2000) errors["notes"] = ["Use 2,000 characters or fewer."];

        DateOnly date = default;
        if (!FinanceRules.TryParseDate(form.EntryDate, out date)) errors["entryDate"] = ["Enter the date."];
        else if (date > FinanceRules.Today(time)) errors["entryDate"] = ["The date cannot be in the future."];

        FinCategory? category = null;
        if (form.CategoryId is null) errors["categoryId"] = ["Choose a category."];
        else
        {
            category = await db.FinCategories.SingleOrDefaultAsync(c => c.Id == form.CategoryId && c.Kind == kind, ct);
            if (category is null || !category.IsActive) errors["categoryId"] = ["Choose an active category."];
        }

        FinAccount? account = null;
        if (form.AccountId is null) errors["accountId"] = [kind == FinEntryKinds.Income ? "Choose the account the money went into." : "Choose the account it was paid from."];
        else
        {
            account = await db.FinAccounts.SingleOrDefaultAsync(a => a.Id == form.AccountId, ct);
            if (account is null || !account.IsActive) errors["accountId"] = ["Choose an active account."];
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
                Amount = form.Amount!.Value, Reference = FinanceRules.Clean(form.Reference), Notes = FinanceRules.Clean(form.Notes),
                CreatedBy = actor, CreatedUtc = now, ReplacesEntryId = replaces?.Id,
            };

            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            var sequence = kind == FinEntryKinds.Income ? "FinIncomeNo" : "FinExpenseNo";
            await using var command = db.Database.GetDbConnection().CreateCommand();
            command.Transaction = transaction.GetDbTransaction();
            command.CommandText = $"SELECT NEXT VALUE FOR {sequence}";   // the sequence name is one of two constants above
            var number = Convert.ToInt32(await command.ExecuteScalarAsync(ct), System.Globalization.CultureInfo.InvariantCulture);
            entry.EntryNo = (kind == FinEntryKinds.Income ? "INC-" : "EXP-") + number.ToString("000000");
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
                audit.Write(kind == FinEntryKinds.Income ? "FinIncomeCorrected" : "FinExpenseCorrected", entityType: nameof(FinEntry), entityId: replaces.Id.ToString(),
                    details: new { original = replaces.EntryNo, replacement = entry.EntryNo, before = new { replaces.Amount, date = FinanceRules.Format(replaces.EntryDate), replaces.Party }, after = new { entry.Amount, date = FinanceRules.Format(date), entry.Party } });
            }

            audit.Write(kind == FinEntryKinds.Income ? "FinIncomeCreated" : "FinExpenseCreated", entityType: nameof(FinEntry), entityId: entry.Id.ToString(),
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
