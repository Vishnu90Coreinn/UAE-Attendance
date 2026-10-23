using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HrPayroll.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AttendanceLeaveStatuses : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Attendance_Status",
                table: "Attendance");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Attendance_StatusHours",
                table: "Attendance");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Attendance_Status",
                table: "Attendance",
                sql: "[Status] COLLATE Latin1_General_100_BIN2 IN ('Present', 'Absent', 'Leave', 'Sick Leave')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Attendance_StatusHours",
                table: "Attendance",
                sql: "([Status] <> 'Present' AND [BasicHours] = 0 AND [OvertimeHours] = 0) OR ([Status] = 'Present' AND [BasicHours] > 0)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Attendance_Status",
                table: "Attendance");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Attendance_StatusHours",
                table: "Attendance");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Attendance_Status",
                table: "Attendance",
                sql: "[Status] COLLATE Latin1_General_100_BIN2 IN ('Present', 'Absent')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Attendance_StatusHours",
                table: "Attendance",
                sql: "([Status] = 'Absent' AND [BasicHours] = 0 AND [OvertimeHours] = 0) OR ([Status] = 'Present' AND [BasicHours] > 0)");
        }
    }
}
