using System.Text.Json;
using HrPayroll.Api.Services.Finance;

namespace HrPayroll.Api.Tests.Unit;

/// <summary>VAT and splitting arithmetic, pinned by the same shared vectors the browser can read.</summary>
public class FinanceVatCalculatorTests
{
    private static readonly JsonElement Vectors = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "finance-test-vectors.json"))).RootElement;

    public static IEnumerable<object[]> VatCases() => Vectors.GetProperty("vat").EnumerateArray().Select(v => new object[] { v.GetProperty("name").GetString()! });
    public static IEnumerable<object[]> AllocateCases() => Vectors.GetProperty("allocate").EnumerateArray().Select(v => new object[] { v.GetProperty("name").GetString()! });

    [Theory]
    [MemberData(nameof(VatCases))]
    public void Vat_MatchesSharedVector(string name)
    {
        var v = Vectors.GetProperty("vat").EnumerateArray().Single(x => x.GetProperty("name").GetString() == name);

        var (cash, net, tax) = FinanceCalculator.Vat(v.GetProperty("typed").GetDecimal(), v.GetProperty("treatment").GetString()!, v.GetProperty("rate").GetDecimal(), v.GetProperty("inclusive").GetBoolean());

        Assert.Equal(v.GetProperty("cash").GetDecimal(), cash);
        Assert.Equal(v.GetProperty("net").GetDecimal(), net);
        Assert.Equal(v.GetProperty("tax").GetDecimal(), tax);
    }

    [Theory]
    [MemberData(nameof(AllocateCases))]
    public void Allocate_MatchesSharedVector_AndAlwaysAddsUpToTheTotal(string name)
    {
        var v = Vectors.GetProperty("allocate").EnumerateArray().Single(x => x.GetProperty("name").GetString() == name);
        var total = v.GetProperty("total").GetDecimal();

        var parts = FinanceCalculator.Allocate(total, v.GetProperty("weights").EnumerateArray().Select(w => w.GetDecimal()).ToList());

        Assert.Equal(v.GetProperty("parts").EnumerateArray().Select(p => p.GetDecimal()), parts);
        if (v.GetProperty("weights").EnumerateArray().Any(w => w.GetDecimal() > 0)) Assert.Equal(total, parts.Sum());
    }

    [Fact]
    public void Vat_IncludedThenAddedBack_NeverLosesAFils()
    {
        // For every price in a wide range, net + VAT equals what was typed when VAT is included.
        for (var cents = 1; cents <= 20_000; cents++)
        {
            var typed = cents / 100m;
            var (cash, net, tax) = FinanceCalculator.Vat(typed, "Standard", 5m, inclusive: true);
            Assert.Equal(typed, net + tax);
            Assert.Equal(typed, cash);
            Assert.True(FinanceCalculator.IsMoney(net) && FinanceCalculator.IsMoney(tax));
        }
    }
}
