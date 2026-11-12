using System.Text.Json;
using HrPayroll.Api.Services;

namespace HrPayroll.Api.Tests.Unit;

public class InvoiceCalculatorTests
{
    private static readonly JsonElement Vectors = Load();

    private static JsonElement Load()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "docs", "invoice-test-vectors.json")))
            directory = directory.Parent;
        Assert.NotNull(directory);
        return JsonDocument.Parse(File.ReadAllText(Path.Combine(directory!.FullName, "docs", "invoice-test-vectors.json"))).RootElement;
    }

    public static IEnumerable<object[]> LineCases() => Vectors.GetProperty("lines").EnumerateArray().Select(v => new object[] { v.GetProperty("name").GetString()! });
    public static IEnumerable<object[]> InvoiceCases() => Vectors.GetProperty("invoices").EnumerateArray().Select(v => new object[] { v.GetProperty("name").GetString()! });
    public static IEnumerable<object[]> WordCases() => Vectors.GetProperty("words").EnumerateArray().Select((_, i) => new object[] { i });

    [Theory]
    [MemberData(nameof(LineCases))]
    public void Line_MatchesSharedVector(string name)
    {
        var v = Vectors.GetProperty("lines").EnumerateArray().Single(x => x.GetProperty("name").GetString() == name);
        var (taxable, vat, amount) = InvoiceCalculator.Line(v.GetProperty("quantity").GetDecimal(), v.GetProperty("rate").GetDecimal());
        Assert.Equal(v.GetProperty("taxable").GetDecimal(), taxable);
        Assert.Equal(v.GetProperty("vat").GetDecimal(), vat);
        Assert.Equal(v.GetProperty("amount").GetDecimal(), amount);
    }

    [Theory]
    [MemberData(nameof(InvoiceCases))]
    public void Totals_MatchSharedVector(string name)
    {
        var v = Vectors.GetProperty("invoices").EnumerateArray().Single(x => x.GetProperty("name").GetString() == name);
        var lines = v.GetProperty("lines").EnumerateArray().Select(l => InvoiceCalculator.Line(l[0].GetDecimal(), l[1].GetDecimal())).ToList();
        var (sub, vat, total) = InvoiceCalculator.Totals(lines);
        Assert.Equal(v.GetProperty("subTotal").GetDecimal(), sub);
        Assert.Equal(v.GetProperty("vatTotal").GetDecimal(), vat);
        Assert.Equal(v.GetProperty("total").GetDecimal(), total);
    }

    [Theory]
    [MemberData(nameof(WordCases))]
    public void Words_MatchSharedVector(int index)
    {
        var v = Vectors.GetProperty("words")[index];
        Assert.Equal(v.GetProperty("words").GetString(), AmountInWords.Aed(v.GetProperty("amount").GetDecimal()));
    }
}
