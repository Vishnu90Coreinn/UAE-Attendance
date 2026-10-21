using System.Text.Json;
using HrPayroll.Api.Services;

namespace HrPayroll.Api.Tests.Unit;

public class PayrollCalculatorTests
{
    private static JsonElement Vectors()
    {
        using var document = JsonDocument.Parse(File.ReadAllText(
            Path.Combine(AppContext.BaseDirectory, "payroll-test-vectors.json")));
        return document.RootElement.Clone();
    }

    private static DailyPay Calculate(JsonElement v) => PayrollCalculator.DailyPay(
        v.GetProperty("status").GetString(), v.GetProperty("basicHours").GetDecimal(),
        v.GetProperty("overtimeHours").GetDecimal(), v.GetProperty("hourlyRate").GetDecimal(),
        v.GetProperty("companyOvertimeRate").GetDecimal(),
        v.GetProperty("workerOvertimeRate").ValueKind == JsonValueKind.Null ? null : v.GetProperty("workerOvertimeRate").GetDecimal());

    private static DailyPay Expected(JsonElement v) => new(v.GetProperty("basicPay").GetDecimal(),
        v.GetProperty("overtimePay").GetDecimal(), v.GetProperty("totalPay").GetDecimal(), v.GetProperty("daysWorked").GetInt32());

    [Fact]
    public void SharedDailyVectors_RoundEachComponentAwayFromZero()
    {
        foreach (var vector in Vectors().GetProperty("daily").EnumerateArray())

            Assert.Equal(Expected(vector.GetProperty("expected")), Calculate(vector));
    }

    [Fact]
    public void SharedMonthVectors_SumRoundedDailyComponents()
    {
        foreach (var vector in Vectors().GetProperty("monthly").EnumerateArray())
        {
            var days = vector.GetProperty("days").EnumerateArray()
                .SelectMany(d => Enumerable.Repeat(Calculate(d), d.GetProperty("repeat").GetInt32())).ToArray();
            var summary = PayrollCalculator.MonthSummary(days, []);
            Assert.Equal(Expected(vector.GetProperty("expected")),
                new DailyPay(summary.BasicPay, summary.OvertimePay, summary.TotalPay, summary.DaysWorked));
        }
    }
}
