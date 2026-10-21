using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HrPayroll.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddAttendance : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Attendance",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    WorkerId = table.Column<int>(type: "int", nullable: false),
                    WorkDate = table.Column<DateOnly>(type: "date", nullable: false),
                    Status = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: false),
                    BasicHours = table.Column<decimal>(type: "decimal(4,2)", precision: 4, scale: 2, nullable: false),
                    OvertimeHours = table.Column<decimal>(type: "decimal(4,2)", precision: 4, scale: 2, nullable: false),
                    UpdatedUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    UpdatedBy = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Attendance", x => x.Id);
                    table.CheckConstraint("CK_Attendance_Hours", "[BasicHours] >= 0 AND [OvertimeHours] >= 0 AND [BasicHours] + [OvertimeHours] <= 24");
                    table.CheckConstraint("CK_Attendance_Status", "[Status] COLLATE Latin1_General_100_BIN2 IN ('Present', 'Absent')");
                    table.CheckConstraint("CK_Attendance_StatusHours", "([Status] = 'Absent' AND [BasicHours] = 0 AND [OvertimeHours] = 0) OR ([Status] = 'Present' AND [BasicHours] > 0)");
                    table.ForeignKey(
                        name: "FK_Attendance_Workers_WorkerId",
                        column: x => x.WorkerId,
                        principalTable: "Workers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Attendance_WorkDate",
                table: "Attendance",
                column: "WorkDate");

            migrationBuilder.CreateIndex(
                name: "IX_Attendance_WorkerId_WorkDate",
                table: "Attendance",
                columns: new[] { "WorkerId", "WorkDate" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Attendance");
        }
    }
}
