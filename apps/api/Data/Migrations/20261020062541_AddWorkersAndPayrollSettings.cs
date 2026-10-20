using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HrPayroll.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddWorkersAndPayrollSettings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "PayrollSettings",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false),
                    CompanyName = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    Tagline = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    ContactEmail = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    OvertimeRatePerHour = table.Column<decimal>(type: "decimal(9,2)", precision: 9, scale: 2, nullable: false),
                    MaxBasicHoursPerDay = table.Column<decimal>(type: "decimal(4,2)", precision: 4, scale: 2, nullable: false),
                    ShiftDescription = table.Column<string>(type: "nvarchar(60)", maxLength: 60, nullable: false),
                    PreparedByLabel = table.Column<string>(type: "nvarchar(60)", maxLength: 60, nullable: false),
                    ApprovedByLabel = table.Column<string>(type: "nvarchar(60)", maxLength: 60, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PayrollSettings", x => x.Id);
                    table.CheckConstraint("CK_PayrollSettings_SingleRow", "[Id] = 1");
                });

            migrationBuilder.CreateTable(
                name: "Workers",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    WorkerCode = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false, collation: "SQL_Latin1_General_CP1_CI_AS"),
                    FullName = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    Designation = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false),
                    HourlyRate = table.Column<decimal>(type: "decimal(9,2)", precision: 9, scale: 2, nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false, defaultValue: true),
                    CreatedUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    UpdatedUtc = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Workers", x => x.Id);
                    table.CheckConstraint("CK_Workers_HourlyRate", "[HourlyRate] > 0");
                });

            migrationBuilder.InsertData(
                table: "PayrollSettings",
                columns: new[] { "Id", "ApprovedByLabel", "CompanyName", "ContactEmail", "MaxBasicHoursPerDay", "OvertimeRatePerHour", "PreparedByLabel", "ShiftDescription", "Tagline" },
                values: new object[] { 1, "General Manager", "DE AKS BE GLASS & ALUMINIUM CO. L.L.C S.O.C", "hr@dxbaluminium.ae", 8m, 2.22m, "HR Department", "06:00 AM - 05:30 PM", "Glass & Aluminum Installation & Maintenance Services" });

            migrationBuilder.CreateIndex(
                name: "IX_Workers_WorkerCode",
                table: "Workers",
                column: "WorkerCode",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PayrollSettings");

            migrationBuilder.DropTable(
                name: "Workers");
        }
    }
}
