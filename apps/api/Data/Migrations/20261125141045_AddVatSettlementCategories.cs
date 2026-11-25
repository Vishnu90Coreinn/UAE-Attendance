using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace HrPayroll.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddVatSettlementCategories : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.InsertData(
                table: "FinCategories",
                columns: new[] { "Id", "DefaultTaxTypeId", "IsActive", "Kind", "LedgerAccountId", "Name" },
                values: new object[,]
                {
                    { 13, null, true, "Expense", null, "VAT paid to tax authority" },
                    { 14, null, true, "Income", null, "VAT refund from tax authority" }
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DeleteData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 13);

            migrationBuilder.DeleteData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 14);
        }
    }
}
