using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HrPayroll.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class FinanceAccountantControls : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "VatPeriodConfirmed",
                table: "PayrollSettings",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "VatPeriodMonths",
                table: "PayrollSettings",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "VatPeriodStartMonth",
                table: "PayrollSettings",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<decimal>(
                name: "RecoverableTaxPercent",
                table: "FinEntries",
                type: "decimal(5,2)",
                precision: 5,
                scale: 2,
                nullable: false,
                defaultValue: 100m);

            migrationBuilder.AddColumn<decimal>(
                name: "RecoverableTaxPercent",
                table: "FinBills",
                type: "decimal(5,2)",
                precision: 5,
                scale: 2,
                nullable: false,
                defaultValue: 100m);

            migrationBuilder.UpdateData(
                table: "PayrollSettings",
                keyColumn: "Id",
                keyValue: 1,
                columns: new[] { "VatPeriodConfirmed", "VatPeriodMonths", "VatPeriodStartMonth" },
                values: new object[] { false, 3, 1 });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "VatPeriodConfirmed",
                table: "PayrollSettings");

            migrationBuilder.DropColumn(
                name: "VatPeriodMonths",
                table: "PayrollSettings");

            migrationBuilder.DropColumn(
                name: "VatPeriodStartMonth",
                table: "PayrollSettings");

            migrationBuilder.DropColumn(
                name: "RecoverableTaxPercent",
                table: "FinEntries");

            migrationBuilder.DropColumn(
                name: "RecoverableTaxPercent",
                table: "FinBills");
        }
    }
}
