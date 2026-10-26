using System.Globalization;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Dtos;
using Microsoft.Extensions.Configuration;
using UglyToad.PdfPig.Content;
using UglyToad.PdfPig.Writer;

namespace HrPayroll.Api.Services;

/// <summary>One A4 page with a worker's profile: details, contact, onboarding checklist, notes and signature lines.</summary>
public sealed class WorkerProfilePdf(IConfiguration configuration)
{
    private const double Left = PdfLetterhead.Left;
    private const double Right = PdfLetterhead.Right;

    public byte[] Generate(Worker worker, PayrollCompany company, bool includeRates)
    {
        foreach (var text in new[]
                 {
                     worker.WorkerCode, worker.FullName, worker.Designation, worker.Department, worker.EmiratesId,
                     worker.PassportNumber, worker.Phone, worker.Email, worker.EmergencyContact, worker.WorkLocation, worker.Notes,
                 })
        {
            if (text is not null) PdfText.EnsurePrintable(text);
        }

        try
        {
            using var document = new PdfDocumentBuilder();
            var regular = document.AddTrueTypeFont(PdfText.Font("Regular"));
            var bold = document.AddTrueTypeFont(PdfText.Font("Bold"));
            var page = document.AddPage(PageSize.A4);
            Draw(new PdfCanvas(page, regular, bold), worker, company, includeRates, PdfText.Asset("logo.png"));
            return document.Build();
        }
        catch (InvalidOperationException ex) when (ex.Message.StartsWith("The font does not contain a character:", StringComparison.Ordinal))
        {
            throw new PdfTextNotSupportedException(ex);
        }
    }

    private void Draw(PdfCanvas cv, Worker worker, PayrollCompany company, bool includeRates, byte[] logo)
    {
        var details = PdfText.Letterhead(configuration, company.ContactEmail);
        var rule = PdfLetterhead.Draw(cv, logo, company, details, "EMPLOYEE RECORD", "Confidential personnel file", null);

        // Identity banner: name and role, status pill, employee number.
        var y = rule - 18;
        const double bannerHeight = 66;
        cv.Fill(Left, y - bannerHeight, Right - Left, bannerHeight, PdfStyle.Panel);
        cv.Text(cv.Fit(worker.FullName, 340, 15, true), Left + 18, y - 29, 15, true, PdfStyle.Teal);
        cv.Text(cv.Fit(worker.Designation, 340, 9.5), Left + 18, y - 45, 9.5, false, PdfStyle.Muted);

        var statusColor = worker.IsActive ? PdfStyle.Teal : PdfStyle.Amber;
        var statusText = worker.IsActive ? "ACTIVE" : "INACTIVE";
        var pillWidth = cv.Width(statusText, 7, true) + 18;
        cv.Outline(Right - 16 - pillWidth, y - 25, pillWidth, 14, 0.9, statusColor);
        cv.Text(statusText, Right - 16 - pillWidth + 9, y - 21, 7, true, statusColor);
        cv.RightText("EMPLOYEE NO.", Right - 16, y - 40, 6.8, true, PdfStyle.Muted);
        cv.RightText(worker.WorkerCode, Right - 16, y - 55, 11, true);
        y -= bannerHeight + 12;

        var missing = new List<string>();
        if (string.IsNullOrWhiteSpace(worker.EmiratesId)) missing.Add("Emirates ID");
        if (string.IsNullOrWhiteSpace(worker.PassportNumber)) missing.Add("Passport number");
        if (string.IsNullOrWhiteSpace(worker.Phone)) missing.Add("Phone");
        if (string.IsNullOrWhiteSpace(worker.EmergencyContact)) missing.Add("Emergency contact");
        if (missing.Count > 0)
        {
            cv.Outline(Left, y - 22, Right - Left, 22, 0.8, PdfStyle.Amber);
            cv.Text("INCOMPLETE RECORD", Left + 10, y - 14.5, 7, true, PdfStyle.Amber);
            cv.Text(cv.Fit("Missing: " + string.Join(", ", missing), 380, 8), Left + 108, y - 14.5, 8);
            y -= 22 + 14;
        }
        else
        {
            y -= 12;
        }

        static string Date(DateOnly? d) => d?.ToString("dd MMM yyyy", CultureInfo.InvariantCulture) ?? "";
        static string Or(string? s) => string.IsNullOrWhiteSpace(s) ? "" : s.Trim();

        void SectionTitle(string title)
        {
            cv.Fill(Left, y - 3, 3, 13, PdfStyle.Teal);
            cv.Text(title, Left + 10, y, 9, true, PdfStyle.Teal);
            y -= 10;
        }

        // A bordered two-column panel of label-over-value fields, with hairlines between rows.
        void FieldPanel(string title, (string Label, string Value)[] fields)
        {
            SectionTitle(title);
            const double rowHeight = 36;
            var rows = (fields.Length + 1) / 2;
            var height = rows * rowHeight;
            cv.Outline(Left, y - height, Right - Left, height, 0.6, PdfStyle.Hairline);
            cv.VRule(Left + (Right - Left) / 2, y - height, y, 0.4, PdfStyle.Hairline);
            for (var i = 0; i < fields.Length; i++)
            {
                var row = i / 2;
                var x = Left + 12 + (i % 2) * ((Right - Left) / 2);
                var top = y - row * rowHeight;
                if (i % 2 == 0 && row > 0) cv.Rule(Left, Right, top, 0.4, PdfStyle.Hairline);
                if (fields[i].Label.Length == 0) continue;
                cv.Text(fields[i].Label.ToUpperInvariant(), x, top - 13, 6.6, true, PdfStyle.Muted);
                if (fields[i].Value.Length == 0) cv.Text("Not recorded", x, top - 27, 9, false, PdfStyle.Muted);
                else cv.Text(cv.Fit(fields[i].Value, 230, 9.5, true), x, top - 27, 9.5, true);
            }
            y -= height + 20;
        }

        var employment = new List<(string, string)>
        {
            ("Department", Or(worker.Department)), ("Joining date", Date(worker.JoinDate)),
            ("Emirates ID", Or(worker.EmiratesId)), ("Passport number", Or(worker.PassportNumber)),
            ("Site / work location", Or(worker.WorkLocation)), ("Employment status", worker.IsActive ? "Active" : "Inactive"),
        };
        if (includeRates)
        {
            employment.Add(("Base hourly rate (AED)", PdfText.Number(worker.HourlyRate)));
            employment.Add(("Overtime rate (AED/hr)", worker.OvertimeRate is { } ot ? PdfText.Number(ot) : "Company rate"));
        }
        FieldPanel("PERSONAL & EMPLOYMENT", [.. employment]);

        FieldPanel("CONTACT", [
            ("Phone", Or(worker.Phone)), ("Email", Or(worker.Email)),
            ("Emergency contact", Or(worker.EmergencyContact)), ("", ""),
        ]);

        // Onboarding checklist: progress bar, then done / pending rows in two columns.
        var items = new (string Label, bool Done)[]
        {
            ("Labor contract signed", worker.ContractSigned), ("Safety PPE gear issued", worker.SafetyGearIssued),
            ("Visa & medical fitness", worker.VisaMedicalCleared), ("Factory / site orientation", worker.SiteOrientationDone),
            ("WPS payroll registered", worker.WpsRegistered), ("ID badge printed & issued", worker.BadgeIssued),
        };
        var done = items.Count(i => i.Done);
        SectionTitle("ONBOARDING CHECKLIST");
        cv.RightText($"{done} of {items.Length} complete", Right, y + 10, 8, true, PdfStyle.Muted);
        y -= 4;
        cv.Fill(Left, y - 5, Right - Left, 5, PdfStyle.Hairline);
        if (done > 0) cv.Fill(Left, y - 5, (Right - Left) * done / items.Length, 5, PdfStyle.Teal);
        y -= 14;
        const double itemHeight = 26;
        var listHeight = items.Length / 2 * itemHeight;
        cv.Outline(Left, y - listHeight, Right - Left, listHeight, 0.6, PdfStyle.Hairline);
        cv.VRule(Left + (Right - Left) / 2, y - listHeight, y, 0.4, PdfStyle.Hairline);
        for (var i = 0; i < items.Length; i++)
        {
            var (label, isDone) = items[i];
            var colLeft = Left + (i % 2) * ((Right - Left) / 2);
            var top = y - (i / 2) * itemHeight;
            if (i % 2 == 0 && i > 0) cv.Rule(Left, Right, top, 0.4, PdfStyle.Hairline);
            if (isDone) cv.Fill(colLeft + 12, top - 18, 10, 10, PdfStyle.Teal);
            else cv.Outline(colLeft + 12, top - 18, 10, 10, 0.8, PdfStyle.Muted);
            cv.Text(label, colLeft + 30, top - 16, 9, false);
            cv.RightText(isDone ? "Completed" : "Pending", colLeft + (Right - Left) / 2 - 12, top - 16, 7.6, true,
                isDone ? PdfStyle.Teal : PdfStyle.Muted);
        }
        y -= listHeight + 20;

        // Notes.
        SectionTitle("NOTES & REMARKS");
        const double notesHeight = 62;
        cv.Outline(Left, y - notesHeight, Right - Left, notesHeight, 0.6, PdfStyle.Hairline);
        var hasNotes = !string.IsNullOrWhiteSpace(worker.Notes);
        if (hasNotes)
        {
            var noteLines = cv.Wrap(worker.Notes!, Right - Left - 24, 9);
            for (var i = 0; i < Math.Min(noteLines.Count, 4); i++)
            {
                cv.Text(noteLines[i], Left + 12, y - 16 - i * 12.5, 9);
            }
        }
        else
        {
            // Ruled lines so remarks can be handwritten on the printed copy.
            for (var i = 1; i <= 3; i++)
            {
                cv.Rule(Left + 12, Right - 12, y - i * 17, 0.4, PdfStyle.Hairline);
            }
        }

        // Signatures sit at a fixed height above the footer.
        const double signatureY = 118;
        cv.Rule(Left, 266, signatureY, 0.6, PdfStyle.Ink);
        cv.Text("HR / Operations Authorized Approval", Left, signatureY - 11, 7.6, false, PdfStyle.Muted);
        cv.Rule(310, Right, signatureY, 0.6, PdfStyle.Ink);
        cv.Text("Employee Acknowledgment", 310, signatureY - 11, 7.6, false, PdfStyle.Muted);
        cv.Text("Date:", Left, signatureY - 34, 7.6, false, PdfStyle.Muted);
        cv.Rule(Left + 26, 160, signatureY - 36, 0.4, PdfStyle.Hairline);
        cv.Text("Date:", 310, signatureY - 34, 7.6, false, PdfStyle.Muted);
        cv.Rule(336, 434, signatureY - 36, 0.4, PdfStyle.Hairline);

        cv.Rule(Left, Right, 58, 0.5, PdfStyle.Hairline);
        cv.Text("Confidential: employee record for internal company use only.", Left, 44, 7, false, PdfStyle.Muted);
        cv.RightText($"{worker.WorkerCode}  |  Printed {PdfText.CompanyTime(DateTime.UtcNow).ToString("dd MMM yyyy", CultureInfo.InvariantCulture)}",
            Right, 44, 7, false, PdfStyle.Muted);
    }
}
