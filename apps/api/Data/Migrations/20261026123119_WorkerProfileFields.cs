using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HrPayroll.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class WorkerProfileFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Department",
                table: "Workers",
                type: "nvarchar(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Email",
                table: "Workers",
                type: "nvarchar(120)",
                maxLength: 120,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "EmergencyContact",
                table: "Workers",
                type: "nvarchar(150)",
                maxLength: 150,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "EmiratesId",
                table: "Workers",
                type: "nvarchar(25)",
                maxLength: 25,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Notes",
                table: "Workers",
                type: "nvarchar(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PassportNumber",
                table: "Workers",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Phone",
                table: "Workers",
                type: "nvarchar(25)",
                maxLength: 25,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "WorkLocation",
                table: "Workers",
                type: "nvarchar(120)",
                maxLength: 120,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Department",
                table: "Workers");

            migrationBuilder.DropColumn(
                name: "Email",
                table: "Workers");

            migrationBuilder.DropColumn(
                name: "EmergencyContact",
                table: "Workers");

            migrationBuilder.DropColumn(
                name: "EmiratesId",
                table: "Workers");

            migrationBuilder.DropColumn(
                name: "Notes",
                table: "Workers");

            migrationBuilder.DropColumn(
                name: "PassportNumber",
                table: "Workers");

            migrationBuilder.DropColumn(
                name: "Phone",
                table: "Workers");

            migrationBuilder.DropColumn(
                name: "WorkLocation",
                table: "Workers");
        }
    }
}
