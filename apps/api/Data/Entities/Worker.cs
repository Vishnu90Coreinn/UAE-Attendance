namespace HrPayroll.Api.Data.Entities;

public class Worker
{
    public int Id { get; set; }
    public string WorkerCode { get; set; } = "";
    public string FullName { get; set; } = "";
    public string Designation { get; set; } = "";
    public decimal HourlyRate { get; set; }

    /// <summary>
    /// The fixed monthly salary, paid in full for a 30-day month whatever the calendar length. <see cref="HourlyRate"/> is
    /// derived from it (salary / 240). 0 means none was recorded, so the rate x 240 is used instead.
    /// </summary>
    public decimal MonthlySalary { get; set; }

    public decimal EffectiveSalary => MonthlySalary > 0 ? MonthlySalary : decimal.Round(HourlyRate * 240m, 2, MidpointRounding.AwayFromZero);

    /// <summary>The worker's own overtime rate per hour; null means "use the company rate" (<c>PayrollSettings.OvertimeRatePerHour</c>). 0 means no overtime pay.</summary>
    public decimal? OvertimeRate { get; set; }

    public bool IsActive { get; set; } = true;
    public DateOnly? JoinDate { get; set; }

    // Optional profile details; null means "not recorded".
    public string? Department { get; set; }
    public string? EmiratesId { get; set; }
    public string? PassportNumber { get; set; }
    public string? Phone { get; set; }
    public string? Email { get; set; }
    public string? EmergencyContact { get; set; }
    public string? WorkLocation { get; set; }
    public string? Notes { get; set; }

    // Phase 2 (HR certificates): nationality, the fixed allowances printed on salary letters, and bank details.
    public string? Nationality { get; set; }
    public decimal HousingAllowance { get; set; }
    public decimal TransportAllowance { get; set; }
    public decimal OtherAllowance { get; set; }
    public string? BankName { get; set; }
    public string? BankAccountNumber { get; set; }
    public string? Iban { get; set; }

    // Money-exchange payout details: the exchange house, the card number and the account held there.
    public string? ExchangeName { get; set; }
    public string? CardNumber { get; set; }
    public string? ExchangeAccountNumber { get; set; }

    // Onboarding checklist.
    public bool ContractSigned { get; set; }
    public bool VisaMedicalCleared { get; set; }
    public bool SafetyGearIssued { get; set; }
    public bool SiteOrientationDone { get; set; }
    public bool WpsRegistered { get; set; }
    public bool BadgeIssued { get; set; }

    public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedUtc { get; set; } = DateTime.UtcNow;
}
