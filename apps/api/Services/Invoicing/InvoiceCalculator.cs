namespace HrPayroll.Api.Services;

/// <summary>
/// All invoice arithmetic lives here (the browser only previews it). Each line is rounded to 2 dp half away from zero,
/// and the invoice totals are the sums of the rounded lines, so the printed lines always add up to the printed totals.
/// </summary>
public static class InvoiceCalculator
{
    public const decimal VatRate = 0.05m;

    public static decimal Round(decimal value) => decimal.Round(value, 2, MidpointRounding.AwayFromZero);

    public static (decimal Taxable, decimal Vat, decimal Amount) Line(decimal quantity, decimal rate)
    {
        var taxable = Round(quantity * rate);
        var vat = Round(taxable * VatRate);
        return (taxable, vat, taxable + vat);
    }

    public static (decimal SubTotal, decimal VatTotal, decimal Total) Totals(IEnumerable<(decimal Taxable, decimal Vat, decimal Amount)> lines)
    {
        var list = lines.ToList();
        var sub = list.Sum(l => l.Taxable);
        var vat = list.Sum(l => l.Vat);
        return (sub, vat, sub + vat);
    }
}

/// <summary>Writes an amount as "UAE Dirham Sixty-Three Thousand ... and Twenty-Three Fils".</summary>
public static class AmountInWords
{
    private static readonly string[] Ones =
        ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen",
         "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
    private static readonly string[] Tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
    private static readonly (long Size, string Name)[] Scales = [(1_000_000_000, "Billion"), (1_000_000, "Million"), (1_000, "Thousand")];

    public static string Aed(decimal amount)
    {
        var rounded = InvoiceCalculator.Round(Math.Abs(amount));
        var dirhams = (long)decimal.Truncate(rounded);
        var fils = (int)((rounded - dirhams) * 100m);
        var words = "UAE Dirham " + (dirhams == 0 ? "Zero" : Number(dirhams));
        return fils > 0 ? $"{words} and {Number(fils)} Fils" : words;
    }

    private static string Number(long value)
    {
        var parts = new List<string>();
        foreach (var (size, name) in Scales)
        {
            if (value < size) continue;
            parts.Add(Below1000((int)(value / size)) + " " + name);
            value %= size;
        }
        if (value > 0) parts.Add(Below1000((int)value));
        return string.Join(" ", parts);
    }

    private static string Below1000(int value)
    {
        var parts = new List<string>();
        if (value >= 100) { parts.Add(Ones[value / 100] + " Hundred"); value %= 100; }
        if (value >= 20) parts.Add(Tens[value / 10] + (value % 10 > 0 ? "-" + Ones[value % 10] : ""));
        else if (value > 0) parts.Add(Ones[value]);
        return string.Join(" ", parts);
    }
}
