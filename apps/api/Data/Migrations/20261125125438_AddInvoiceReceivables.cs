using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HrPayroll.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddInvoiceReceivables : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "FinEntryId",
                table: "InvoicePayments",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "InvoiceId",
                table: "FinEntries",
                type: "int",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_FinEntries_InvoiceId",
                table: "FinEntries",
                column: "InvoiceId",
                filter: "[InvoiceId] IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_FinEntries_InvoiceId",
                table: "FinEntries");

            migrationBuilder.DropColumn(
                name: "FinEntryId",
                table: "InvoicePayments");

            migrationBuilder.DropColumn(
                name: "InvoiceId",
                table: "FinEntries");
        }
    }
}
