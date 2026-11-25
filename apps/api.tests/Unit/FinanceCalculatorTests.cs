using System.Text.Json;
using HrPayroll.Api.Services.Finance;

namespace HrPayroll.Api.Tests.Unit;

public class FinanceCalculatorTests
{
    private static readonly JsonElement Vectors = Load();

    private static JsonElement Load()
    {
        // The csproj copies the shared file next to the test assembly; the docs/ copy is the one people edit.
        var copied = Path.Combine(AppContext.BaseDirectory, "finance-test-vectors.json");
        return JsonDocument.Parse(File.ReadAllText(copied)).RootElement;
    }

    public static IEnumerable<object[]> BalanceCases() => Vectors.GetProperty("balances").EnumerateArray().Select(v => new object[] { v.GetProperty("name").GetString()! });
    public static IEnumerable<object[]> PeriodCases() => Vectors.GetProperty("periods").EnumerateArray().Select(v => new object[] { v.GetProperty("name").GetString()! });
    public static IEnumerable<object[]> MoneyCases() => Vectors.GetProperty("money").EnumerateArray().Select((_, i) => new object[] { i });

    private static List<FinMovement> Movements(JsonElement vector) =>
        vector.GetProperty("movements").EnumerateArray().Select(m => new FinMovement(
            m.GetProperty("type").GetString() switch
            {
                "income" => FinMovementType.Income,
                "expense" => FinMovementType.Expense,
                "transferIn" => FinMovementType.TransferIn,
                "transferOut" => FinMovementType.TransferOut,
                "capital" => FinMovementType.Capital,
                "capitalOut" => FinMovementType.CapitalOut,
                var other => throw new InvalidOperationException($"Unknown movement type {other}"),
            },
            m.GetProperty("amount").GetDecimal(),
            m.TryGetProperty("voided", out var voided) && voided.GetBoolean())).ToList();

    [Theory]
    [MemberData(nameof(BalanceCases))]
    public void Balance_MatchesSharedVector(string name)
    {
        var v = Vectors.GetProperty("balances").EnumerateArray().Single(x => x.GetProperty("name").GetString() == name);
        Assert.Equal(v.GetProperty("balance").GetDecimal(), FinanceCalculator.Balance(v.GetProperty("opening").GetDecimal(), Movements(v)));
    }

    [Theory]
    [MemberData(nameof(PeriodCases))]
    public void Period_MatchesSharedVector(string name)
    {
        var v = Vectors.GetProperty("periods").EnumerateArray().Single(x => x.GetProperty("name").GetString() == name);
        var (income, expense, net) = FinanceCalculator.Period(Movements(v));
        Assert.Equal(v.GetProperty("income").GetDecimal(), income);
        Assert.Equal(v.GetProperty("expense").GetDecimal(), expense);
        Assert.Equal(v.GetProperty("net").GetDecimal(), net);
    }

    public static IEnumerable<object[]> ShareCases() => Vectors.GetProperty("shares").EnumerateArray().Select(v => new object[] { v.GetProperty("name").GetString()! });

    [Theory]
    [MemberData(nameof(ShareCases))]
    public void Shares_MatchSharedVector(string name)
    {
        var v = Vectors.GetProperty("shares").EnumerateArray().Single(x => x.GetProperty("name").GetString() == name);
        var amounts = v.GetProperty("amounts").EnumerateArray().Select(x => x.GetDecimal()).ToList();
        var expected = v.GetProperty("shares").EnumerateArray().Select(x => x.GetDecimal()).ToList();
        var shares = FinanceCalculator.Shares(amounts);
        Assert.Equal(expected, shares);
        if (shares.Any(s => s > 0)) Assert.Equal(100.00m, shares.Sum());
    }

    [Theory]
    [MemberData(nameof(MoneyCases))]
    public void IsMoney_MatchesSharedVector(int index)
    {
        var v = Vectors.GetProperty("money").EnumerateArray().ElementAt(index);
        Assert.Equal(v.GetProperty("valid").GetBoolean(), FinanceCalculator.IsMoney(v.GetProperty("value").GetDecimal()));
    }

    [Fact]
    public void Balance_FromSums_EqualsBalance_FromMovements()
    {
        Assert.Equal(1150.25m, FinanceCalculator.Balance(1000m, income: 250.50m, expense: 100.25m, transfersIn: 0m, transfersOut: 0m));
    }
}
