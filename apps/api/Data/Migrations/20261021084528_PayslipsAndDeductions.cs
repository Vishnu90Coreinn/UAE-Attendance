using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace HrPayroll.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class PayslipsAndDeductions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateOnly>(
                name: "JoinDate",
                table: "Workers",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "TotalDeductions",
                table: "PayrollDetails",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.CreateTable(
                name: "DeductionTypes",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Name = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false, collation: "SQL_Latin1_General_CP1_CI_AS"),
                    IsActive = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DeductionTypes", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "PayrollDeductionLines",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    PayrollDetailId = table.Column<int>(type: "int", nullable: false),
                    DeductionTypeName = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    Amount = table.Column<decimal>(type: "decimal(9,2)", precision: 9, scale: 2, nullable: false),
                    Note = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PayrollDeductionLines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PayrollDeductionLines_PayrollDetails_PayrollDetailId",
                        column: x => x.PayrollDetailId,
                        principalTable: "PayrollDetails",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "WorkerDeductions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    WorkerId = table.Column<int>(type: "int", nullable: false),
                    Year = table.Column<int>(type: "int", nullable: false),
                    Month = table.Column<int>(type: "int", nullable: false),
                    DeductionTypeId = table.Column<int>(type: "int", nullable: false),
                    Amount = table.Column<decimal>(type: "decimal(9,2)", precision: 9, scale: 2, nullable: false),
                    Note = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    UpdatedBy = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    UpdatedUtc = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WorkerDeductions", x => x.Id);
                    table.CheckConstraint("CK_WorkerDeductions_Amount", "[Amount] > 0");
                    table.CheckConstraint("CK_WorkerDeductions_Month", "[Month] BETWEEN 1 AND 12");
                    table.ForeignKey(
                        name: "FK_WorkerDeductions_DeductionTypes_DeductionTypeId",
                        column: x => x.DeductionTypeId,
                        principalTable: "DeductionTypes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_WorkerDeductions_Workers_WorkerId",
                        column: x => x.WorkerId,
                        principalTable: "Workers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.InsertData(
                table: "DeductionTypes",
                columns: new[] { "Id", "IsActive", "Name" },
                values: new object[,]
                {
                    { 1, true, "Advance / Loan" },
                    { 2, true, "Other Deductions" }
                });

            migrationBuilder.CreateIndex(
                name: "IX_DeductionTypes_Name",
                table: "DeductionTypes",
                column: "Name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PayrollDeductionLines_PayrollDetailId",
                table: "PayrollDeductionLines",
                column: "PayrollDetailId");

            migrationBuilder.CreateIndex(
                name: "IX_WorkerDeductions_DeductionTypeId",
                table: "WorkerDeductions",
                column: "DeductionTypeId");

            migrationBuilder.CreateIndex(
                name: "IX_WorkerDeductions_WorkerId_Year_Month_DeductionTypeId",
                table: "WorkerDeductions",
                columns: new[] { "WorkerId", "Year", "Month", "DeductionTypeId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PayrollDeductionLines");

            migrationBuilder.DropTable(
                name: "WorkerDeductions");

            migrationBuilder.DropTable(
                name: "DeductionTypes");

            migrationBuilder.DropColumn(
                name: "JoinDate",
                table: "Workers");

            migrationBuilder.DropColumn(
                name: "TotalDeductions",
                table: "PayrollDetails");
        }
    }
}
