using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HrPayroll.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class MonthlySalary : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "MonthlySalary",
                table: "Workers",
                type: "decimal(10,2)",
                precision: 10,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            // Existing workers: salary = rate x 240 rounded to the nearest 10 AED (6.67 -> 1600, 7.08 -> 1700, 5.83 -> 1400).
            migrationBuilder.Sql("UPDATE Workers SET MonthlySalary = ROUND(HourlyRate * 240 / 10, 0) * 10");

            migrationBuilder.AddColumn<decimal>(
                name: "AbsenceDeduction",
                table: "PayrollDetails",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "MonthlySalary",
                table: "PayrollDetails",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "MonthlySalary",
                table: "Workers");

            migrationBuilder.DropColumn(
                name: "AbsenceDeduction",
                table: "PayrollDetails");

            migrationBuilder.DropColumn(
                name: "MonthlySalary",
                table: "PayrollDetails");
        }
    }
}
