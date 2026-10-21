using HrPayroll.Api.Auth;
using HrPayroll.Api.Dtos;

namespace HrPayroll.Api.Services;

/// <summary>
/// The single place that removes pay information from API responses. Site supervisors never see hourly or overtime
/// rates, daily pay or the company overtime rate; managers and administrators see everything. Fails closed: any caller
/// who is not a manager or an administrator gets the redacted view.
/// </summary>
public sealed class WageRedactor(IHttpContextAccessor httpContext)
{
    public bool HidesWages
    {
        get
        {
            var user = httpContext.HttpContext?.User;
            return user is null || !(user.IsInRole(Roles.Manager) || user.IsInRole(Roles.Administrator));
        }
    }

    public WorkerResponse Apply(WorkerResponse worker) =>
        HidesWages ? worker with { HourlyRate = null, OvertimeRate = null, EffectiveOvertimeRate = null } : worker;

    public List<WorkerResponse> Apply(List<WorkerResponse> workers) =>
        HidesWages ? workers.Select(Apply).ToList() : workers;

    public AttendanceDayResponse Apply(AttendanceDayResponse day) =>
        HidesWages
            ? day with { Rows = day.Rows.Select(row => row with { Worker = Apply(row.Worker), DailyPay = null }).ToList() }
            : day;

    public PayrollSettingsResponse Apply(PayrollSettingsResponse settings) =>
        HidesWages ? settings with { OvertimeRatePerHour = null } : settings;
}
