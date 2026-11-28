using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HrPayroll.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddStaffExpenseEntry : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_FinEntries_Status",
                table: "FinEntries");

            migrationBuilder.DropCheckConstraint(
                name: "CK_FinEntries_Voided",
                table: "FinEntries");

            migrationBuilder.AddColumn<bool>(
                name: "CanSubmitExpenses",
                table: "Users",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "StaffCanUse",
                table: "FinAccounts",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddCheckConstraint(
                name: "CK_FinEntries_Status",
                table: "FinEntries",
                sql: "[Status] IN ('Active', 'Voided', 'Pending')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_FinEntries_Voided",
                table: "FinEntries",
                sql: "[Status] IN ('Active', 'Pending') OR [VoidedUtc] IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_FinEntries_Status",
                table: "FinEntries");

            migrationBuilder.DropCheckConstraint(
                name: "CK_FinEntries_Voided",
                table: "FinEntries");

            migrationBuilder.DropColumn(
                name: "CanSubmitExpenses",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "StaffCanUse",
                table: "FinAccounts");

            migrationBuilder.AddCheckConstraint(
                name: "CK_FinEntries_Status",
                table: "FinEntries",
                sql: "[Status] IN ('Active', 'Voided')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_FinEntries_Voided",
                table: "FinEntries",
                sql: "[Status] = 'Active' OR [VoidedUtc] IS NOT NULL");
        }
    }
}
