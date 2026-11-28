using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HrPayroll.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddInvoiceVatTreatment : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "VatTreatment",
                table: "Invoices",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "Standard");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Invoices_VatTreatment",
                table: "Invoices",
                sql: "[VatTreatment] IN ('Standard','ZeroRated','Exempt') AND ([VatTreatment] = 'Standard' OR [VatTotal] = 0)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Invoices_VatTreatment",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "VatTreatment",
                table: "Invoices");
        }
    }
}
