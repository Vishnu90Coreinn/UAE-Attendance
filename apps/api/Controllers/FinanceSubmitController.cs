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
        // The shared staff accounts show no balance; the petty cash a person holds shows theirs, so they know what is left.
        (await accounts.ListAsync(false, ct)).Where(a => a.StaffCanUse || (a.HolderUserId is { } h && h == FinanceRules.UserId(http)))
            .Select(a => a.HolderUserId is not null ? a with { OpeningBalance = 0m } : a with { OpeningBalance = 0m, Balance = 0m, AccountNumber = null, Iban = null, BankName = null }).ToList(),
        (await categories.ListAsync(FinEntryKinds.Expense, false, ct)).Where(c => !FinanceRules.IsVatSettlement(c.Id)).ToList(),
        await payees.ListAsync(FinEntryKinds.Expense, false, ct),
        await categories.TaxTypesAsync(ct)));

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
