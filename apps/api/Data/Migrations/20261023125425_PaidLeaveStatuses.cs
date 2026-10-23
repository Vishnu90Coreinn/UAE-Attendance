using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HrPayroll.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class PaidLeaveStatuses : Migration
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

            migrationBuilder.AlterColumn<string>(
                name: "Status",
                table: "Attendance",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(10)",
                oldMaxLength: 10);

            // The earlier unpaid "Leave" status becomes Annual Leave; its hours stay 0, so those days remain unpaid.
            migrationBuilder.Sql("UPDATE [Attendance] SET [Status] = 'Annual Leave' WHERE [Status] = 'Leave'");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Attendance_Status",
                table: "Attendance",
                sql: "[Status] COLLATE Latin1_General_100_BIN2 IN ('Present', 'Absent', 'Annual Leave', 'Sick Leave', 'Emergency Leave')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Attendance_StatusHours",
                table: "Attendance",
                sql: "([Status] = 'Absent' AND [BasicHours] = 0 AND [OvertimeHours] = 0) OR ([Status] = 'Present' AND [BasicHours] > 0) OR ([Status] IN ('Annual Leave', 'Sick Leave', 'Emergency Leave') AND [OvertimeHours] = 0)");
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

            // The previous model had unpaid leave only: one "Leave" value that always has zero hours.
            migrationBuilder.Sql("UPDATE [Attendance] SET [Status] = 'Leave', [BasicHours] = 0 WHERE [Status] IN ('Annual Leave', 'Emergency Leave')");
            migrationBuilder.Sql("UPDATE [Attendance] SET [BasicHours] = 0 WHERE [Status] = 'Sick Leave'");

            migrationBuilder.AlterColumn<string>(
                name: "Status",
                table: "Attendance",
                type: "nvarchar(10)",
                maxLength: 10,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(20)",
                oldMaxLength: 20);

            migrationBuilder.AddCheckConstraint(
                name: "CK_Attendance_Status",
                table: "Attendance",
                sql: "[Status] COLLATE Latin1_General_100_BIN2 IN ('Present', 'Absent', 'Leave', 'Sick Leave')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Attendance_StatusHours",
                table: "Attendance",
                sql: "([Status] <> 'Present' AND [BasicHours] = 0 AND [OvertimeHours] = 0) OR ([Status] = 'Present' AND [BasicHours] > 0)");
        }
    }
}
