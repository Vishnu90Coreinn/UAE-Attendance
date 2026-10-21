using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HrPayroll.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddPayrollSnapshots : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "PayrollPeriods",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Year = table.Column<int>(type: "int", nullable: false),
                    Month = table.Column<int>(type: "int", nullable: false),
                    OvertimeRateApplied = table.Column<decimal>(type: "decimal(9,2)", precision: 9, scale: 2, nullable: false),
                    FinalisedUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    FinalisedBy = table.Column<string>(type: "nvarchar(60)", maxLength: 60, nullable: false),
                    CompanyName = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    Tagline = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    ContactEmail = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    PreparedByLabel = table.Column<string>(type: "nvarchar(60)", maxLength: 60, nullable: false),
                    ApprovedByLabel = table.Column<string>(type: "nvarchar(60)", maxLength: 60, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PayrollPeriods", x => x.Id);
                    table.CheckConstraint("CK_PayrollPeriods_Month", "[Year] BETWEEN 1 AND 9999 AND [Month] BETWEEN 1 AND 12");
                });

            migrationBuilder.CreateTable(
                name: "PayrollDetails",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    PeriodId = table.Column<int>(type: "int", nullable: false),
                    WorkerId = table.Column<int>(type: "int", nullable: false),
                    WorkerCode = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    WorkerName = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    Designation = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false),
                    HourlyRate = table.Column<decimal>(type: "decimal(9,2)", precision: 9, scale: 2, nullable: false),
                    OvertimeRate = table.Column<decimal>(type: "decimal(9,2)", precision: 9, scale: 2, nullable: false),
                    DaysWorked = table.Column<int>(type: "int", nullable: false),
                    BasicHours = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    OvertimeHours = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    BasicPay = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    OvertimePay = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    TotalPay = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PayrollDetails", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PayrollDetails_PayrollPeriods_PeriodId",
                        column: x => x.PeriodId,
                        principalTable: "PayrollPeriods",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_PayrollDetails_Workers_WorkerId",
                        column: x => x.WorkerId,
                        principalTable: "Workers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PayrollDetails_PeriodId_WorkerId",
                table: "PayrollDetails",
                columns: new[] { "PeriodId", "WorkerId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PayrollDetails_WorkerId",
                table: "PayrollDetails",
                column: "WorkerId");

            migrationBuilder.CreateIndex(
                name: "IX_PayrollPeriods_Year_Month",
                table: "PayrollPeriods",
                columns: new[] { "Year", "Month" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PayrollDetails");

            migrationBuilder.DropTable(
                name: "PayrollPeriods");
        }
    }
}
