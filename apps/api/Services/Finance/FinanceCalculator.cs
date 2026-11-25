namespace HrPayroll.Api.Services.Finance;

public enum FinMovementType { Income, Expense, TransferIn, TransferOut, Capital, CapitalOut }

/// <summary>One recorded amount against an account. A voided movement counts nowhere.</summary>
public readonly record struct FinMovement(FinMovementType Type, decimal Amount, bool Voided = false);

/// <summary>
/// The only place finance arithmetic lives. Pure: nothing here touches the database. The browser never works out a
/// balance; shared vectors in <c>docs/finance-test-vectors.json</c> pin the rules.
/// </summary>
public static class FinanceCalculator
{
    /// <summary>
    /// Opening balance + income - expense + transfers in - transfers out + capital put in less capital paid back (<paramref name="capital"/> is that net figure).
    /// A transfer is never income or expense, and capital is never income or expense either.
    /// </summary>
    public static decimal Balance(decimal opening, decimal income, decimal expense, decimal transfersIn, decimal transfersOut, decimal capital = 0m) =>
        opening + income - expense + transfersIn - transfersOut + capital;

    public static decimal Balance(decimal opening, IEnumerable<FinMovement> movements)
    {
        decimal income = 0, expense = 0, transfersIn = 0, transfersOut = 0, capital = 0;
        foreach (var m in movements)
        {
            if (m.Voided) continue;
            switch (m.Type)
            {
                case FinMovementType.Capital: capital += m.Amount; break;
                case FinMovementType.CapitalOut: capital -= m.Amount; break;
                case FinMovementType.Income: income += m.Amount; break;
                case FinMovementType.Expense: expense += m.Amount; break;
                case FinMovementType.TransferIn: transfersIn += m.Amount; break;
                case FinMovementType.TransferOut: transfersOut += m.Amount; break;
            }
        }

        return Balance(opening, income, expense, transfersIn, transfersOut, capital);
    }

    /// <summary>Income, expense and the net result of a period. Transfers and voided rows are left out.</summary>
    public static (decimal Income, decimal Expense, decimal Net) Period(IEnumerable<FinMovement> movements)
    {
        decimal income = 0, expense = 0;
        foreach (var m in movements)
        {
            if (m.Voided) continue;
            if (m.Type == FinMovementType.Income) income += m.Amount;
            else if (m.Type == FinMovementType.Expense) expense += m.Amount;
        }

        return (income, expense, income - expense);
    }

    /// <summary>
    /// Each amount's share of the total as a percentage with <paramref name="decimals"/> decimals (two by default), adding up to exactly 100
    /// (the largest remainders get the spare units). An amount of zero or less has no share; with nothing to share every share is 0.
    /// </summary>
    public static decimal[] Shares(IReadOnlyList<decimal> amounts, int decimals = 2)
    {
        var positive = amounts.Select(a => a > 0 ? a : 0m).ToArray();
        var whole = positive.Sum();
        var result = new decimal[amounts.Count];
        if (whole <= 0) return result;

        // Work in whole units of the last decimal (hundredths of a percent for two decimals) so the arithmetic is exact.
        var unit = (decimal)Math.Pow(10, decimals);
        var scale = 100m * unit;
        var exact = positive.Select(a => a * scale / whole).ToArray();
        var floors = exact.Select(Math.Floor).ToArray();
        var spare = scale - floors.Sum();
        foreach (var i in Enumerable.Range(0, exact.Length).OrderByDescending(i => exact[i] - floors[i]).ThenBy(i => i).Take((int)spare))
            floors[i] += 1;
        for (var i = 0; i < result.Length; i++) result[i] = floors[i] / unit;
        return result;
    }

    /// <summary>True for an amount of AED with at most two decimals.</summary>
    public static bool IsMoney(decimal value) => decimal.Round(value, 2, MidpointRounding.AwayFromZero) == value;
}
