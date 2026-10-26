using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HrPayroll.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class WorkerOnboardingChecklist : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "BadgeIssued",
                table: "Workers",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "ContractSigned",
                table: "Workers",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "SafetyGearIssued",
                table: "Workers",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "SiteOrientationDone",
                table: "Workers",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "VisaMedicalCleared",
                table: "Workers",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "WpsRegistered",
                table: "Workers",
                type: "bit",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "BadgeIssued",
                table: "Workers");

            migrationBuilder.DropColumn(
                name: "ContractSigned",
                table: "Workers");

            migrationBuilder.DropColumn(
                name: "SafetyGearIssued",
                table: "Workers");

            migrationBuilder.DropColumn(
                name: "SiteOrientationDone",
                table: "Workers");

            migrationBuilder.DropColumn(
                name: "VisaMedicalCleared",
                table: "Workers");

            migrationBuilder.DropColumn(
                name: "WpsRegistered",
                table: "Workers");
        }
    }
}
