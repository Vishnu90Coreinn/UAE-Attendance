using HrPayroll.Api.Auth;
using HrPayroll.Api.Dtos;
using HrPayroll.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace HrPayroll.Api.Controllers;

[Route("api/invoice-clients")]
public sealed class InvoiceClientsController(InvoiceClientService clients) : InvoiceBaseController
{
    [HttpGet]
    [Authorize(Policy = Policies.ManagerAdminOrHr)]
    public async Task<IActionResult> List([FromQuery] bool includeInactive, CancellationToken ct) => Ok(await clients.ListAsync(includeInactive, ct));

    [HttpPost]
    [Authorize(Policy = Policies.ManagerOrAdmin)]
    public async Task<IActionResult> Create(InvoiceClientRequest request, CancellationToken ct) => Map(await clients.CreateAsync(request, ct));

    [HttpPut("{id:int}")]
    [Authorize(Policy = Policies.ManagerOrAdmin)]
    public async Task<IActionResult> Update(int id, InvoiceClientRequest request, CancellationToken ct) => Map(await clients.UpdateAsync(id, request, ct));
}
