using System.Globalization;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Data;
using HrPayroll.Api.Services.Staff;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Services.Finance;

/// <summary>What a finance service answers: a status, and either a value, field errors or a message.</summary>
public sealed record FinResult<T>(int Status, T? Value = default, Dictionary<string, string[]>? Errors = null, string? Title = null)
{
    public static FinResult<T> Ok(T value) => new(200, value);
    public static FinResult<T> Created(T value) => new(201, value);
    public static FinResult<T> NotFound(string? title = null) => new(404, Title: title);
    public static FinResult<T> Invalid(string field, string message) => new(400, Errors: new() { [field] = [message] });
    public static FinResult<T> Invalid(Dictionary<string, string[]> errors) => new(400, Errors: errors);
    public static FinResult<T> Conflict(string title) => new(409, Title: title);
}

/// <summary>Small rules every finance service shares.</summary>
public static class FinanceRules
{
    /// <summary>The largest amount a decimal(12,2) column can hold.</summary>
    public const decimal MaxAmount = 9_999_999_999.99m;

    /// <summary>Today on UAE time, which is what "not in the future" means for the company.</summary>
    public static DateOnly Today(TimeProvider time) => StaffTime.Today(time);

    public static bool TryParseDate(string? text, out DateOnly date) =>
        DateOnly.TryParseExact(text, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out date);

    public static string Format(DateOnly date) => date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    /// <summary>Null when the amount is fine, otherwise the message to show next to the field.</summary>
    public static string? AmountError(decimal? amount)
    {
        if (amount is null) return "Enter the amount.";
        if (amount <= 0) return "The amount must be more than zero.";
        if (!FinanceCalculator.IsMoney(amount.Value)) return "Use at most 2 decimal places.";
        if (amount > MaxAmount) return "That amount is too large.";
        return null;
    }

    public static string? Clean(string? text) => string.IsNullOrWhiteSpace(text) ? null : text.Trim();

    /// <summary>True for a unique-index violation, which a concurrent request can cause.</summary>
    public static bool IsDuplicate(Exception exception)
    {
        for (Exception? current = exception; current is not null; current = current.InnerException)
            if (current is SqlException { Number: 2601 or 2627 }) return true;
        return false;
    }

    /// <summary>The signed-in user's name, for the "created by" columns.</summary>
    public static string Actor(IHttpContextAccessor http) => http.HttpContext?.User.Identity?.Name ?? "system";
}

/// <summary>
/// Hides the middle of bank account numbers and IBANs from the read-only Partner. Administrators and Managers see them in full.
/// Fails closed: anyone who is neither gets the masked view.
/// </summary>
public sealed class FinanceRedactor(IHttpContextAccessor httpContext)
{
    public bool MasksNumbers
    {
        get
        {
            var user = httpContext.HttpContext?.User;
            return user is null || !(user.IsInRole(Roles.Administrator) || user.IsInRole(Roles.Manager));
        }
    }

    /// <summary>"••••8001": the last four characters only.</summary>
    public static string? Mask(string? value)
    {
        if (string.IsNullOrEmpty(value)) return value;
        return value.Length <= 4 ? new string('•', 4) : "••••" + value[^4..];
    }

    public string? Number(string? value) => MasksNumbers ? Mask(value) : value;
}
