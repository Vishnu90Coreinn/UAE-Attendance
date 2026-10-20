using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HrPayroll.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddOvertimeRates : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "OvertimeRate",
                table: "Workers",
                type: "decimal(9,2)",
                precision: 9,
                scale: 2,
                nullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_Workers_OvertimeRate",
                table: "Workers",
                sql: "[OvertimeRate] IS NULL OR [OvertimeRate] >= 0");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Workers_OvertimeRate",
                table: "Workers");

            migrationBuilder.DropColumn(
                name: "OvertimeRate",
                table: "Workers");
        }
    }
}
