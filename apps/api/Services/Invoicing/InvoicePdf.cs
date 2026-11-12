using System.Globalization;
using HrPayroll.Api.Dtos;
using UglyToad.PdfPig.Content;
using UglyToad.PdfPig.Writer;

namespace HrPayroll.Api.Services;

/// <summary>
/// A4 tax invoice built with PdfPig and the embedded Noto Sans (Latin only). The Arabic company name is shown on screen and
/// in the browser's print view but is left out of the PDF; any other text outside Latin raises
/// <see cref="PdfTextNotSupportedException"/> so the caller can answer 422 instead of printing "?".
/// </summary>
public sealed class InvoicePdf
{
    private const double Left = 36;
    private const double Right = 559;
    private static readonly double[] ColumnRight = [78, 340, 400, 460, 520, 559]; // right edges of #, description (left aligned), area, rate, vat, amount
    private const double Bottom = 60;

    /// <summary>
    /// The uploaded company stamp (seal) is printed beside the authorised signature when one is set. Letters and payslips
    /// do not print it.
    /// </summary>
    public byte[] Generate(InvoiceResponse invoice, byte[]? logo, byte[]? seal = null)
    {
        var c = invoice.Company;
        foreach (var text in new[]
        {
            c.CompanyName, c.CompanySubtitle, c.Mobile, c.Address1, c.Address2, c.Email, c.Trn, c.BankName, c.AccountName, c.AccountNumber, c.Iban,
            invoice.ClientName, invoice.ClientTrn, invoice.ClientAddress, invoice.PaymentTerms, invoice.LpoRef, invoice.Project, invoice.Scope, invoice.Notes,
        }.Concat(invoice.Lines.Select(l => l.Description)))
            PdfText.EnsurePrintable(text);
        try
        {
            using var document = new PdfDocumentBuilder();
            var regular = document.AddTrueTypeFont(PdfText.Font("Regular"));
            var bold = document.AddTrueTypeFont(PdfText.Font("Bold"));
            var images = new Dictionary<byte[], UglyToad.PdfPig.Writer.PdfPageBuilder.AddedImage>();
            var pageNumber = 0;
            PdfCanvas NewPage()
            {
                pageNumber++;
                return new PdfCanvas(document.AddPage(PageSize.A4), regular, bold, images);
            }

            var cv = NewPage();
            var y = Header(cv, invoice, logo);
            y = Parties(cv, invoice, y);
            y = TableHeader(cv, y);
            foreach (var line in invoice.Lines)
            {
                var wrapped = cv.Wrap(line.Description, ColumnRight[1] - ColumnRight[0] - 12, 8.5);
                var height = Math.Max(1, wrapped.Count) * 11 + 8;
                if (y - height < Bottom + 20)
                {
                    cv = NewPage();
                    y = TableHeader(cv, 800);
                }
                cv.Text(line.LineNo.ToString(CultureInfo.InvariantCulture), Left + 8, y - 14, 8.5);
                for (var i = 0; i < wrapped.Count; i++) cv.Text(wrapped[i], ColumnRight[0] + 6, y - 14 - i * 11, 8.5);
                cv.RightText(Num(line.Quantity), ColumnRight[2] - 6, y - 14, 8.5);
                cv.RightText(Num(line.Rate), ColumnRight[3] - 6, y - 14, 8.5);
                cv.RightText(Num(line.Vat), ColumnRight[4] - 6, y - 14, 8.5);
                cv.RightText(Num(line.Amount), ColumnRight[5] - 6, y - 14, 8.5, true);
                y -= height;
                cv.Rule(Left, Right, y, 0.4, PdfStyle.Hairline);
            }

            // The totals follow the last row. The tax summary, bank details and signature go on their own page when they do not
            // fit below, so a long item list does not leave the amounts stranded on a page of their own.
            var totalsTop = y - 18;
            if (y - TotalsHeight < Bottom) { cv = NewPage(); totalsTop = 800; }
            var summaryTop = Totals(cv, invoice, totalsTop);
            if (summaryTop - SummaryHeight < Bottom) { cv = NewPage(); summaryTop = 800; }
            Summary(cv, invoice, summaryTop, seal);
            return document.Build();
        }
        catch (InvalidOperationException ex) when (ex.Message.StartsWith("The font does not contain a character:", StringComparison.Ordinal))
        {
            throw new PdfTextNotSupportedException(ex);
        }
    }

    private static double Header(PdfCanvas cv, InvoiceResponse invoice, byte[]? logo)
    {
        var c = invoice.Company;
        var textLeft = Left;
        if (logo is { Length: > 8 } && (IsPng(logo) || logo[0] == 0xFF))
        {
            if (IsPng(logo)) cv.Image(logo, Left, 757, Left + 70, 808);
            else cv.Jpeg(logo, Left, 757, 70, 51);
            textLeft = Left + 82;
        }
        var y = 797.0;
        foreach (var line in cv.Wrap(c.CompanyName, 280, 11.5, true)) { cv.Text(line, textLeft, y, 11.5, true, PdfStyle.Teal); y -= 13.5; }
        foreach (var line in new[] { c.CompanySubtitle, c.Mobile.Length > 0 ? "Mobile: " + c.Mobile : "", c.Address1, c.Address2, c.Trn.Length > 0 ? "TRN: " + c.Trn : "" })
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            cv.Text(cv.Fit(line, 300, 7.8), textLeft, y, 7.8, false, PdfStyle.Muted);
            y -= 10.5;
        }
        cv.RightText("TAX INVOICE", Right, 797, 16, true, PdfStyle.Teal);
        cv.RightText(invoice.Number ?? "DRAFT", Right, 780, 10, true);
        var badge = invoice.Status == "Draft" ? "DRAFT" : invoice.Status == "Cancelled" ? "CANCELLED" : invoice.DisplayStatus switch { "Paid" => "PAID", "PartPaid" => "PART PAID", _ => invoice.IsOverdue ? "OVERDUE" : "" };
        if (badge.Length > 0)
        {
            var width = cv.Width(badge, 7, true) + 18;
            cv.Outline(Right - width, 758, width, 14, 0.9, PdfStyle.Amber);
            cv.Text(badge, Right - width + 9, 762.5, 7, true, PdfStyle.Amber);
        }
        var rule = Math.Min(751, y - 2);
        PdfLetterhead.Accent(cv, rule);
        return rule;
    }

    private static double Parties(PdfCanvas cv, InvoiceResponse invoice, double top)
    {
        var y = top - 16;
        const double height = 104;
        cv.Fill(Left, y - height, 255, height, PdfStyle.Panel);
        cv.Fill(Left + 268, y - height, Right - Left - 268, height, PdfStyle.Panel);
        cv.Text("BILL TO", Left + 12, y - 16, 6.8, true, PdfStyle.Muted);
        var by = y - 30;
        foreach (var line in cv.Wrap(invoice.ClientName, 230, 9.5, true).Take(2)) { cv.Text(line, Left + 12, by, 9.5, true); by -= 12; }
        if (invoice.ClientTrn.Length > 0) { cv.Text("TRN: " + invoice.ClientTrn, Left + 12, by, 8.5); by -= 11; }
        foreach (var line in cv.Wrap(invoice.ClientAddress, 230, 8.5).Take(3)) { if (line.Length > 0) { cv.Text(line, Left + 12, by, 8.5, false, PdfStyle.Muted); by -= 11; } }

        var x = Left + 268 + 12;
        var rows = new[]
        {
            ("Invoice date", invoice.InvoiceDate.ToString("dd MMM yyyy", CultureInfo.InvariantCulture)),
            ("Terms", invoice.PaymentTerms),
            ("Due date", invoice.DueDate.ToString("dd MMM yyyy", CultureInfo.InvariantCulture)),
            ("LPO ref", invoice.LpoRef),
            ("Project", invoice.Project),
            ("Scope", invoice.Scope),
        };
        var ry = y - 16;
        foreach (var (label, value) in rows)
        {
            cv.Text(label, x, ry, 8, false, PdfStyle.Muted);
            cv.Text(cv.Fit(value.Length == 0 ? "-" : value, 175, 8.5, true), x + 70, ry, 8.5, true);
            ry -= 14;
        }
        return y - height;
    }

    private static double TableHeader(PdfCanvas cv, double top)
    {
        var y = top - 14;
        cv.Fill(Left, y - 22, Right - Left, 22, PdfStyle.Teal);
        cv.Text("#", Left + 8, y - 15, 8, true, PdfStyle.White);
        cv.Text("Item & description", ColumnRight[0] + 6, y - 15, 8, true, PdfStyle.White);
        cv.RightText("Area", ColumnRight[2] - 6, y - 15, 8, true, PdfStyle.White);
        cv.RightText("Rate (AED)", ColumnRight[3] - 6, y - 15, 8, true, PdfStyle.White);
        cv.RightText("VAT 5%", ColumnRight[4] - 6, y - 15, 8, true, PdfStyle.White);
        cv.RightText("Amount", ColumnRight[5] - 6, y - 15, 8, true, PdfStyle.White);
        return y - 22;
    }

    private const double StampBox = 92;

    /// <summary>Draws the stamp centred over the signature line, keeping its shape. Silently skipped when the image cannot be read.</summary>
    private static void DrawStamp(PdfCanvas cv, byte[] seal, double signatureY)
    {
        var size = LetterPdf.ImageSize.Read(seal);
        if (size is null) return;
        var scale = Math.Min(StampBox / size.Value.Width, StampBox / size.Value.Height);
        var w = size.Value.Width * scale;
        var h = size.Value.Height * scale;
        var left = (400 + Right) / 2 - w / 2;
        var bottom = signatureY + 4;
        try
        {
            if (size.Value.Jpeg) cv.Jpeg(seal, left, bottom, w, h);
            else cv.Image(seal, left, bottom, left + w, bottom + h);
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or NotSupportedException)
        {
            // An image the PDF writer cannot embed is left off rather than failing the whole invoice.
        }
    }

    /// <summary>Height needed for the words and the amount rows (including the paid and balance rows of an issued invoice).</summary>
    private const double TotalsHeight = 170;

    /// <summary>Height needed for the tax summary, bank details and signature block.</summary>
    private const double SummaryHeight = 240;

    /// <summary>Draws the amount in words and the totals. Returns the y position the tax summary starts from.</summary>
    private static double Totals(PdfCanvas cv, InvoiceResponse invoice, double top)
    {
        var y = top;
        cv.Text("Total in words", Left, y, 7.6, true, PdfStyle.Muted);
        var wy = y - 12;
        foreach (var line in cv.Wrap(invoice.TotalInWords, 250, 8.5, true)) { cv.Text(line, Left, wy, 8.5, true); wy -= 11; }

        const double labelX = 350;
        void Row(string label, string value, bool strong = false, bool band = false)
        {
            if (band) cv.Fill(labelX - 8, y - 6, Right - labelX + 8, 20, PdfStyle.Panel);
            cv.Text(label, labelX, y, 9, strong);
            cv.RightText(value, Right - 6, y, 9, strong);
            y -= 20;
        }
        Row("Sub total", Num(invoice.SubTotal));
        Row("VAT total (5%)", Num(invoice.VatTotal));
        Row("Total", "AED " + Num(invoice.Total), true, true);
        if (invoice.Status == "Issued")
        {
            Row("Paid", Num(invoice.AmountPaid));
            Row("Balance due", "AED " + Num(invoice.BalanceDue), true, true);
        }

        return Math.Min(y, wy) - 14;
    }

    /// <summary>The tax summary, notes, bank details and the signature block (with the stamp, when one is uploaded).</summary>
    private static void Summary(PdfCanvas cv, InvoiceResponse invoice, double top, byte[]? seal)
    {
        var c = invoice.Company;
        var y = top;
        cv.Text("Tax summary", Left, y, 8.5, true, PdfStyle.Teal);
        y -= 8;
        cv.Fill(Left, y - 18, Right - Left, 18, PdfStyle.Panel);
        cv.Text("Tax details", Left + 8, y - 12, 8, true);
        cv.RightText("Taxable amount (AED)", 440, y - 12, 8, true);
        cv.RightText("Tax amount (AED)", Right - 8, y - 12, 8, true);
        y -= 18;
        cv.Text("Standard rate (5%)", Left + 8, y - 13, 8.5);
        cv.RightText(Num(invoice.SubTotal), 440, y - 13, 8.5);
        cv.RightText(Num(invoice.VatTotal), Right - 8, y - 13, 8.5);
        y -= 20;
        cv.Rule(Left, Right, y, 0.4, PdfStyle.Hairline);
        var taxBottom = y;

        y -= 18;
        if (invoice.Notes.Length > 0)
        {
            cv.Text("Notes", Left, y, 8.5, true, PdfStyle.Teal);
            y -= 11;
            foreach (var line in cv.Wrap(invoice.Notes, Right - Left, 8.5)) { cv.Text(line, Left, y, 8.5); y -= 11; }
            y -= 8;
        }

        cv.Text("Bank details for payment", Left, y, 8.5, true, PdfStyle.Teal);
        y -= 12;
        foreach (var (label, value) in new[] { ("Bank", c.BankName), ("Account name", c.AccountName), ("Account no.", c.AccountNumber), ("IBAN", c.Iban) })
        {
            if (value.Length == 0) continue;
            cv.Text(label, Left, y, 8, false, PdfStyle.Muted);
            cv.Text(cv.Fit(value, 230, 8.5, true), Left + 70, y, 8.5, true);
            y -= 12;
        }
        var sy = Math.Max(y - 16, 110);
        // With a stamp, the signature line moves down so the stamp sits above it without touching the tax summary.
        if (seal is { Length: > 0 }) sy = Math.Max(Math.Min(sy, taxBottom - StampBox - 14), 110);
        if (seal is { Length: > 0 }) DrawStamp(cv, seal, sy);
        cv.Rule(400, Right, sy, 0.6, PdfStyle.Ink);
        cv.Text("Authorized signature", 400, sy - 11, 7.6, false, PdfStyle.Muted);
        cv.Text(cv.Fit(c.CompanyName, 159, 7, false), 400, sy - 21, 7, false, PdfStyle.Muted);
    }

    private static bool IsPng(byte[] data) => data.Length > 8 && data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47;

    private static string Num(decimal value) => value.ToString("N2", CultureInfo.InvariantCulture);
}
