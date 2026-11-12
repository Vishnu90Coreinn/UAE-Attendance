using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HrPayroll.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AttendanceNotApprovedIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_Attendance_WorkDate_NotApproved",
                table: "Attendance",
                column: "WorkDate",
                filter: "[ApprovalStatus] <> 'Approved'")
                .Annotation("SqlServer:Include", new[] { "ApprovalStatus" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Attendance_WorkDate_NotApproved",
                table: "Attendance");
        }
    }
}
