namespace HrPayroll.Api.Services.Finance;

public enum FinMovementType { Income, Expense, TransferIn, TransferOut }

/// <summary>One recorded amount against an account. A voided movement counts nowhere.</summary>
public readonly record struct FinMovement(FinMovementType Type, decimal Amount, bool Voided = false);

/// <summary>
/// The only place finance arithmetic lives. Pure: nothing here touches the database. The browser never works out a
/// balance; shared vectors in <c>docs/finance-test-vectors.json</c> pin the rules.
/// </summary>
public static class FinanceCalculator
{
    /// <summary>Opening balance + income - expense + transfers in - transfers out. A transfer is never income or expense.</summary>
    public static decimal Balance(decimal opening, decimal income, decimal expense, decimal transfersIn, decimal transfersOut) =>
        opening + income - expense + transfersIn - transfersOut;

    public static decimal Balance(decimal opening, IEnumerable<FinMovement> movements)
    {
        decimal income = 0, expense = 0, transfersIn = 0, transfersOut = 0;
        foreach (var m in movements)
        {
            if (m.Voided) continue;
            switch (m.Type)
            {
                case FinMovementType.Income: income += m.Amount; break;
                case FinMovementType.Expense: expense += m.Amount; break;
                case FinMovementType.TransferIn: transfersIn += m.Amount; break;
                case FinMovementType.TransferOut: transfersOut += m.Amount; break;
            }
        }

        return Balance(opening, income, expense, transfersIn, transfersOut);
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

    /// <summary>True for an amount of AED with at most two decimals.</summary>
    public static bool IsMoney(decimal value) => decimal.Round(value, 2, MidpointRounding.AwayFromZero) == value;
}
