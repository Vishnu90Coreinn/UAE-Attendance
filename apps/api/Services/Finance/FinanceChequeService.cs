using HrPayroll.Api.Data;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services.Finance;

public sealed record FinChequeFilter(string? Direction, string? Status, bool OpenOnly, string? From, string? To, int? AccountId, string? Search);

/// <summary>
/// The cheque register: cheques written and received, their dates and where each one stands. Tracking only. A cheque changes no balance;
/// the expense or income it paid does. Open cheques are shown as money already committed or expected.
/// </summary>
public sealed class FinanceChequeService(AppDbContext db, IAuditLogger audit, IHttpContextAccessor http, TimeProvider time)
{
    private const int ListCap = 500;
    private const int SummaryDays = 30;

    private FinChequeResponse ToResponse(FinCheque c, string? entryNo, DateOnly today) => new(
        c.Id, c.Direction, c.Serial, c.Amount, c.PartyName, FinanceRules.Format(c.IssueDate), FinanceRules.Format(c.DueDate), c.AccountId, c.Account.Name,
        c.Status, c.StatusDate is { } d ? FinanceRules.Format(d) : null, c.StatusNote, c.EntryId, entryNo, c.Notes, FinChequeStatuses.IsOpen(c.Status),
        c.DueDate > c.IssueDate, FinChequeStatuses.IsOpen(c.Status) && c.DueDate < today, FinChequeStatuses.Next(c.Direction, c.Status), c.CreatedBy, c.CreatedUtc);

    private async Task<Dictionary<int, string>> EntryNumbersAsync(IEnumerable<FinCheque> cheques, CancellationToken ct)
    {
        var ids = cheques.Where(c => c.EntryId != null).Select(c => c.EntryId!.Value).Distinct().ToList();
        return await db.FinEntries.AsNoTracking().Where(e => ids.Contains(e.Id)).ToDictionaryAsync(e => e.Id, e => e.EntryNo, ct);
    }

    public async Task<FinChequeList> ListAsync(FinChequeFilter f, CancellationToken ct)
    {
        var query = db.FinCheques.AsNoTracking().Include(c => c.Account).AsQueryable();
        if (f.Direction is FinChequeDirections.Issued or FinChequeDirections.Received) query = query.Where(c => c.Direction == f.Direction);
        if (f.Status is not null && FinChequeStatuses.All.Contains(f.Status)) query = query.Where(c => c.Status == f.Status);
        if (f.OpenOnly) query = query.Where(c => c.Status == FinChequeStatuses.Issued || c.Status == FinChequeStatuses.Delivered || c.Status == FinChequeStatuses.Received || c.Status == FinChequeStatuses.Deposited);
        if (FinanceRules.TryParseDate(f.From, out var from)) query = query.Where(c => c.DueDate >= from);
        if (FinanceRules.TryParseDate(f.To, out var to)) query = query.Where(c => c.DueDate <= to);
        if (f.AccountId is { } a) query = query.Where(c => c.AccountId == a);
        if (FinanceRules.Clean(f.Search) is { } q) query = query.Where(c => c.Serial.Contains(q) || c.PartyName.Contains(q) || (c.Notes != null && c.Notes.Contains(q)));

        var open = query.Where(c => c.Status == FinChequeStatuses.Issued || c.Status == FinChequeStatuses.Delivered || c.Status == FinChequeStatuses.Received || c.Status == FinChequeStatuses.Deposited);
        var openIssued = await open.Where(c => c.Direction == FinChequeDirections.Issued).SumAsync(c => (decimal?)c.Amount, ct) ?? 0m;
        var openReceived = await open.Where(c => c.Direction == FinChequeDirections.Received).SumAsync(c => (decimal?)c.Amount, ct) ?? 0m;
        var count = await query.CountAsync(ct);
        var rows = await query.OrderBy(c => c.DueDate).ThenBy(c => c.Id).Take(ListCap + 1).ToListAsync(ct);
        var truncated = rows.Count > ListCap;
        rows = rows.Take(ListCap).ToList();
        var numbers = await EntryNumbersAsync(rows, ct);
        var today = FinanceRules.Today(time);
        return new(rows.Select(c => ToResponse(c, c.EntryId is { } e ? numbers.GetValueOrDefault(e) : null, today)).ToList(), count, openIssued, openReceived, truncated);
    }

    public async Task<FinResult<FinChequeResponse>> GetAsync(int id, CancellationToken ct)
    {
        var cheque = await db.FinCheques.AsNoTracking().Include(c => c.Account).SingleOrDefaultAsync(c => c.Id == id, ct);
        if (cheque is null) return FinResult<FinChequeResponse>.NotFound("The cheque was not found.");
        var numbers = await EntryNumbersAsync([cheque], ct);
        return FinResult<FinChequeResponse>.Ok(ToResponse(cheque, cheque.EntryId is { } e ? numbers.GetValueOrDefault(e) : null, FinanceRules.Today(time)));
    }

    public async Task<FinChequeSummary> SummaryAsync(CancellationToken ct)
    {
        var today = FinanceRules.Today(time);
        var soon = today.AddDays(SummaryDays);
        var open = db.FinCheques.AsNoTracking().Include(c => c.Account)
            .Where(c => c.Status == FinChequeStatuses.Issued || c.Status == FinChequeStatuses.Delivered || c.Status == FinChequeStatuses.Received || c.Status == FinChequeStatuses.Deposited);
        var rows = await open.OrderBy(c => c.DueDate).ThenBy(c => c.Id).ToListAsync(ct);

        var overdue = rows.Where(c => c.DueDate < today).ToList();
        var dueSoon = rows.Where(c => c.DueDate >= today && c.DueDate <= soon).ToList();
        var later = rows.Where(c => c.DueDate > soon && c.Direction == FinChequeDirections.Issued).ToList();
        var next = rows.Where(c => c.DueDate >= today).Take(5).ToList();
        var numbers = await EntryNumbersAsync(next, ct);
        return new(
            SummaryDays,
            dueSoon.Where(c => c.Direction == FinChequeDirections.Issued).Sum(c => c.Amount), dueSoon.Count(c => c.Direction == FinChequeDirections.Issued),
            dueSoon.Where(c => c.Direction == FinChequeDirections.Received).Sum(c => c.Amount), dueSoon.Count(c => c.Direction == FinChequeDirections.Received),
            overdue.Count, overdue.Sum(c => c.Amount), later.Sum(c => c.Amount), later.Count,
            next.Select(c => ToResponse(c, c.EntryId is { } e ? numbers.GetValueOrDefault(e) : null, today)).ToList());
    }

    private async Task<(Dictionary<string, string[]> Errors, FinAccount? Account, DateOnly Issue, DateOnly Due, string? Serial, string? Party, string Direction)> ValidateAsync(
        FinChequeRequest r, string direction, int? ownId, CancellationToken ct)
    {
        var errors = new Dictionary<string, string[]>();
        var serial = FinanceRules.Clean(r.Serial);
        var party = FinanceRules.Clean(r.PartyName);
        if (serial is null) errors["serial"] = ["Enter the cheque number."];
        else if (serial.Length > 30) errors["serial"] = ["Use 30 characters or fewer."];
        if (party is null) errors["partyName"] = [direction == FinChequeDirections.Issued ? "Enter the name on the cheque." : "Enter who gave the cheque."];
        else if (party.Length > 120) errors["partyName"] = ["Use 120 characters or fewer."];
        if (FinanceRules.AmountError(r.Amount) is { } amountError) errors["amount"] = [amountError];
        if (FinanceRules.Clean(r.Notes)?.Length > 2000) errors["notes"] = ["Use 2,000 characters or fewer."];

        DateOnly issue = default, due = default;
        if (!FinanceRules.TryParseDate(r.IssueDate, out issue)) errors["issueDate"] = ["Enter the date the cheque was written."];
        if (!FinanceRules.TryParseDate(r.DueDate, out due)) errors["dueDate"] = ["Enter the date on the cheque."];
        else if (!errors.ContainsKey("issueDate") && due < issue) errors["dueDate"] = ["The cheque date cannot be before the day it was written."];

        FinAccount? account = null;
        if (r.AccountId is null) errors["accountId"] = [direction == FinChequeDirections.Issued ? "Choose the bank account the cheque is drawn on." : "Choose the bank account it will be paid into."];
        else
        {
            account = await db.FinAccounts.AsNoTracking().SingleOrDefaultAsync(a => a.Id == r.AccountId, ct);
            if (account is null || !account.IsActive) errors["accountId"] = ["Choose an active account."];
            else if (account.Kind != FinAccountKinds.Bank) errors["accountId"] = ["Cheques belong to a bank account."];
        }

        if (r.EntryId is { } entryId)
        {
            var wanted = direction == FinChequeDirections.Issued ? FinEntryKinds.Expense : FinEntryKinds.Income;
            var entry = await db.FinEntries.AsNoTracking().SingleOrDefaultAsync(e => e.Id == entryId && e.Kind == wanted, ct);
            if (entry is null || entry.Status != FinStatuses.Active) errors["entryId"] = [$"Choose an active {wanted.ToLowerInvariant()} to link."];
            else if (await db.FinCheques.AnyAsync(c => c.EntryId == entryId && c.Id != ownId && c.Status != FinChequeStatuses.Cancelled, ct)) errors["entryId"] = ["That entry is already linked to another cheque."];
        }

        if (errors.Count == 0 && direction == FinChequeDirections.Issued && await db.FinCheques.AnyAsync(c => c.Direction == FinChequeDirections.Issued && c.AccountId == account!.Id && c.Serial == serial && c.Id != ownId, ct))
            errors["serial"] = ["This cheque number is already in the register for that account."];
        return (errors, account, issue, due, serial, party, direction);
    }

    public async Task<FinResult<FinChequeResponse>> CreateAsync(FinChequeRequest request, CancellationToken ct)
    {
        var direction = request.Direction;
        if (direction is not (FinChequeDirections.Issued or FinChequeDirections.Received))
            return FinResult<FinChequeResponse>.Invalid("direction", "Choose Issued (you wrote it) or Received (you were given it).");
        var v = await ValidateAsync(request, direction, null, ct);
        if (v.Errors.Count > 0) return FinResult<FinChequeResponse>.Invalid(v.Errors);

        var now = DateTime.UtcNow;
        var cheque = new FinCheque
        {
            Direction = direction, Serial = v.Serial!, Amount = request.Amount!.Value, PartyName = v.Party!, IssueDate = v.Issue, DueDate = v.Due, AccountId = v.Account!.Id,
            Status = direction == FinChequeDirections.Issued ? FinChequeStatuses.Issued : FinChequeStatuses.Received, EntryId = request.EntryId,
            Notes = FinanceRules.Clean(request.Notes), CreatedBy = FinanceRules.Actor(http), CreatedUtc = now, UpdatedUtc = now,
        };
        db.FinCheques.Add(cheque);
        try
        {
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            await db.SaveChangesAsync(ct);
            audit.Write("FinChequeCreated", entityType: nameof(FinCheque), entityId: cheque.Id.ToString(), details: new { cheque.Direction, cheque.Serial, cheque.Amount, due = FinanceRules.Format(cheque.DueDate), account = v.Account.Name });
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        }
        catch (DbUpdateException ex) when (FinanceRules.IsDuplicate(ex))
        {
            return FinResult<FinChequeResponse>.Invalid("serial", "This cheque number is already in the register for that account.");
        }

        var result = await GetAsync(cheque.Id, ct);
        return FinResult<FinChequeResponse>.Created(result.Value!);
    }

    /// <summary>Fixes the details of a cheque that is still open. A cheque that has cleared, bounced or been cancelled is a record and is not edited.</summary>
    public async Task<FinResult<FinChequeResponse>> UpdateAsync(int id, FinChequeRequest request, CancellationToken ct)
    {
        var cheque = await db.FinCheques.SingleOrDefaultAsync(c => c.Id == id, ct);
        if (cheque is null) return FinResult<FinChequeResponse>.NotFound("The cheque was not found.");
        if (!FinChequeStatuses.IsOpen(cheque.Status)) return FinResult<FinChequeResponse>.Conflict($"Cheque {cheque.Serial} is {cheque.Status.ToLowerInvariant()} and can no longer be edited.");
        var v = await ValidateAsync(request, cheque.Direction, id, ct);
        if (v.Errors.Count > 0) return FinResult<FinChequeResponse>.Invalid(v.Errors);

        var before = new { cheque.Serial, cheque.Amount, cheque.PartyName, due = FinanceRules.Format(cheque.DueDate), cheque.AccountId, cheque.EntryId };
        cheque.Serial = v.Serial!;
        cheque.Amount = request.Amount!.Value;
        cheque.PartyName = v.Party!;
        cheque.IssueDate = v.Issue;
        cheque.DueDate = v.Due;
        cheque.AccountId = v.Account!.Id;
        cheque.EntryId = request.EntryId;
        cheque.Notes = FinanceRules.Clean(request.Notes);
        cheque.UpdatedUtc = DateTime.UtcNow;
        try
        {
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            audit.Write("FinChequeUpdated", entityType: nameof(FinCheque), entityId: id.ToString(),
                details: new { before, after = new { cheque.Serial, cheque.Amount, cheque.PartyName, due = FinanceRules.Format(cheque.DueDate), cheque.AccountId, cheque.EntryId } });
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        }
        catch (DbUpdateException ex) when (FinanceRules.IsDuplicate(ex))
        {
            return FinResult<FinChequeResponse>.Invalid("serial", "This cheque number is already in the register for that account.");
        }

        return await GetAsync(id, ct);
    }

    public async Task<FinResult<FinChequeResponse>> ChangeStatusAsync(int id, FinChequeStatusRequest request, CancellationToken ct)
    {
        var cheque = await db.FinCheques.SingleOrDefaultAsync(c => c.Id == id, ct);
        if (cheque is null) return FinResult<FinChequeResponse>.NotFound("The cheque was not found.");

        var errors = new Dictionary<string, string[]>();
        var next = request.Status;
        var allowed = FinChequeStatuses.Next(cheque.Direction, cheque.Status);
        if (next is null || !allowed.Contains(next))
            return FinResult<FinChequeResponse>.Conflict(allowed.Length == 0
                ? $"Cheque {cheque.Serial} is {cheque.Status.ToLowerInvariant()}, which is final."
                : $"A cheque that is {cheque.Status.ToLowerInvariant()} can become: {string.Join(", ", allowed.Select(s => s.ToLowerInvariant()))}.");

        var note = FinanceRules.Clean(request.Note);
        if (note?.Length > 300) errors["note"] = ["Use 300 characters or fewer."];
        if (next is FinChequeStatuses.Cancelled or FinChequeStatuses.Bounced && note is null) errors["note"] = [next == FinChequeStatuses.Bounced ? "Enter why it bounced." : "Enter why it was cancelled."];
        var today = FinanceRules.Today(time);
        var date = today;
        if (!string.IsNullOrWhiteSpace(request.Date) && !FinanceRules.TryParseDate(request.Date, out date)) errors["date"] = ["Use the date form yyyy-MM-dd."];
        else if (date > today) errors["date"] = ["The date cannot be in the future."];
        else if (date < cheque.IssueDate) errors["date"] = ["The date cannot be before the cheque was written."];
        if (errors.Count > 0) return FinResult<FinChequeResponse>.Invalid(errors);

        var from = cheque.Status;
        cheque.Status = next;
        cheque.StatusDate = date;
        cheque.StatusNote = note;
        cheque.UpdatedUtc = DateTime.UtcNow;
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        audit.Write("FinChequeStatusChanged", entityType: nameof(FinCheque), entityId: id.ToString(), details: new { cheque.Serial, from, to = next, date = FinanceRules.Format(date), note });
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return await GetAsync(id, ct);
    }
}
