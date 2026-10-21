namespace HrPayroll.Api.Data.Entities;

/// <summary>A deduction the company uses (for example "Advance / Loan"). Managers add, rename or retire them in Settings.</summary>
public sealed class DeductionType
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public bool IsActive { get; set; } = true;
}

/// <summary>What one worker has deducted for one month, per deduction type. Editable until the month is finalised.</summary>
public sealed class WorkerDeduction
{
    public int Id { get; set; }
    public int WorkerId { get; set; }
    public Worker Worker { get; set; } = null!;
    public int Year { get; set; }
    public int Month { get; set; }
    public int DeductionTypeId { get; set; }
    public DeductionType DeductionType { get; set; } = null!;
    public decimal Amount { get; set; }
    public string Note { get; set; } = "";
    public string UpdatedBy { get; set; } = "";
    public DateTime UpdatedUtc { get; set; }
}

/// <summary>A deduction frozen into a finalised month's snapshot, so the payslip and report never change later.</summary>
public sealed class PayrollDeductionLine
{
    public int Id { get; set; }
    public int PayrollDetailId { get; set; }
    public PayrollDetail Detail { get; set; } = null!;
    public string DeductionTypeName { get; set; } = "";
    public decimal Amount { get; set; }
    public string Note { get; set; } = "";
}
