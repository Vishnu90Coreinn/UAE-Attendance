using HrPayroll.Api.Auth;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using HrPayroll.Api.Services;
using HrPayroll.Api.Services.Finance;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace HrPayroll.Api.Controllers;

/// <summary>
/// Expenses entered by office staff a Manager has allowed. They see and add only their own, pick only from the accounts marked for staff,
/// and nothing counts until a Manager approves it.
/// </summary>
[ApiController]
[ServiceFilter(typeof(LedgerSyncFilter))]
[Route("api/finance/my")]
public sealed class FinanceSubmitController(FinanceEntryService entries, FinanceAccountService accounts, FinanceCategoryService categories, FinancePayeeService payees, IHttpContextAccessor http) : ControllerBase
{
    private string Me => FinanceRules.Actor(http);

    private IActionResult Map<T>(FinResult<T> result) => result.Status switch
    {
        200 => Ok(result.Value),
        201 => StatusCode(201, result.Value),
        400 => ValidationProblem(new ValidationProblemDetails(result.Errors!)),
        404 => Problem(statusCode: 404, title: result.Title ?? "Not found."),
        _ => Problem(statusCode: result.Status, title: result.Title),
    };

    [HttpGet("options")]
    [Authorize(Policy = Policies.FinanceSubmit)]
    public async Task<IActionResult> Options(CancellationToken ct) => Ok(new FinMyOptions(
        // Staff get only what the form needs. A shared account shows no money and no bank details at all; the petty cash a person holds shows what is left of it.
        (await accounts.ListAsync(false, ct)).Where(a => a.StaffCanUse || (a.HolderUserId is { } h && h == FinanceRules.UserId(http))).Select(ForStaff).ToList(),
        (await categories.ListAsync(FinEntryKinds.Expense, false, ct)).Where(c => !FinanceRules.IsVatSettlement(c.Id)).Select(c => c with { UseCount = 0 }).ToList(),
        // A saved payee fills in a name and its usual category. Contact details, tax number, notes and how much has been paid stay with the Manager.
        (await payees.ListAsync(FinEntryKinds.Expense, false, ct)).Select(p => p with { Phone = null, TaxNumber = null, Notes = null, EntryCount = 0, Total = 0m }).ToList(),
        await categories.TaxTypesAsync(ct)));

    /// <summary>
    /// What an account looks like to someone entering expenses. Built field by field from what is safe to show, so a money or bank field added to the account later
    /// is not passed on by accident.
    /// </summary>
    private FinAccountResponse ForStaff(FinAccountResponse a)
    {
        var held = a.HolderUserId is { } h && h == FinanceRules.UserId(http);
        var left = held ? a.Balance : 0m;
        return new(a.Id, a.Name, a.Kind, null, null, null, 0m, a.OpeningDate, a.IsActive, a.SortOrder, left, 0, a.StaffCanUse, held ? a.HolderUserId : null, null, 0m, left);
    }

    [HttpGet("expenses")]
    [Authorize(Policy = Policies.FinanceSubmit)]
    public async Task<IActionResult> MyExpenses(CancellationToken ct) =>
        Ok(await entries.ListAsync(FinEntryKinds.Expense, new FinEntryFilter(null, null, null, null, null, null, null, true, CreatedBy: Me), ct));

    [HttpPost("expenses")]
    [Authorize(Policy = Policies.FinanceSubmit)]
    [RequestSizeLimit(30_000_000)]
    public async Task<IActionResult> Submit([FromForm] FinExpenseForm? form, CancellationToken ct) => Map(await entries.SubmitAsync(form ?? new(), ct));

    /// <summary>A receipt on one of the caller's own expenses.</summary>
    [HttpGet("attachments/{id:int}")]
    [Authorize(Policy = Policies.FinanceSubmit)]
    public async Task<IActionResult> Attachment(int id, CancellationToken ct)
    {
        var found = await entries.OpenAttachmentAsync(id, ct);
        if (found is null || !await entries.IsCreatedByAsync(found.Value.Attachment.EntryId, Me, ct)) return Problem(statusCode: 404, title: "The file was not found.");
        Response.Headers.XContentTypeOptions = "nosniff";
        Response.Headers.ContentDisposition = $"inline; filename=\"receipt{Path.GetExtension(found.Value.Attachment.StoredName)}\"";
        return File(found.Value.Content, found.Value.Attachment.ContentType);
    }
}
