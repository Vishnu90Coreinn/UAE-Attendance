using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HrPayroll.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AttendanceApproval : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ApprovalStatus",
                table: "Attendance",
                type: "nvarchar(10)",
                maxLength: 10,
                nullable: false,
                defaultValue: "Approved");

            migrationBuilder.AddColumn<string>(
                name: "DecidedBy",
                table: "Attendance",
                type: "nvarchar(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "DecidedUtc",
                table: "Attendance",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "RejectionReason",
                table: "Attendance",
                type: "nvarchar(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_Attendance_Approval",
                table: "Attendance",
                sql: "[ApprovalStatus] COLLATE Latin1_General_100_BIN2 IN ('Submitted', 'Approved', 'Rejected')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Attendance_Approval",
                table: "Attendance");

            migrationBuilder.DropColumn(
                name: "ApprovalStatus",
                table: "Attendance");

            migrationBuilder.DropColumn(
                name: "DecidedBy",
                table: "Attendance");

            migrationBuilder.DropColumn(
                name: "DecidedUtc",
                table: "Attendance");

            migrationBuilder.DropColumn(
                name: "RejectionReason",
                table: "Attendance");
        }
    }
}
