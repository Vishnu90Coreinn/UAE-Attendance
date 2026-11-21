using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace HrPayroll.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class StaffAttendanceAndLeave : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Users_Role",
                table: "Users");

            migrationBuilder.AddColumn<string>(
                name: "Category",
                table: "Workers",
                type: "nvarchar(12)",
                maxLength: 12,
                nullable: false,
                defaultValue: "Worker");

            migrationBuilder.AddColumn<int>(
                name: "UserId",
                table: "Workers",
                type: "int",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "PublicHolidays",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    Name = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PublicHolidays", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "StaffLeaveTypes",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Name = table.Column<string>(type: "nvarchar(60)", maxLength: 60, nullable: false, collation: "SQL_Latin1_General_CP1_CI_AS"),
                    YearlyDays = table.Column<int>(type: "int", nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false, defaultValue: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StaffLeaveTypes", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "StaffPunches",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    WorkerId = table.Column<int>(type: "int", nullable: false),
                    Kind = table.Column<string>(type: "nvarchar(3)", maxLength: 3, nullable: false),
                    TimestampUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    WorkDate = table.Column<DateOnly>(type: "date", nullable: false),
                    Latitude = table.Column<double>(type: "float", nullable: true),
                    Longitude = table.Column<double>(type: "float", nullable: true),
                    AccuracyMeters = table.Column<double>(type: "float", nullable: true),
                    DistanceMeters = table.Column<double>(type: "float", nullable: true),
                    OutsideOffice = table.Column<bool>(type: "bit", nullable: false),
                    Source = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: false),
                    Reason = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: true),
                    CreatedBy = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    IsVoided = table.Column<bool>(type: "bit", nullable: false),
                    VoidReason = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: true),
                    VoidedBy = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    VoidedUtc = table.Column<DateTime>(type: "datetime2", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StaffPunches", x => x.Id);
                    table.CheckConstraint("CK_StaffPunches_Kind", "[Kind] IN ('In', 'Out')");
                    table.ForeignKey(
                        name: "FK_StaffPunches_Workers_WorkerId",
                        column: x => x.WorkerId,
                        principalTable: "Workers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "StaffSettings",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false),
                    ShiftStart = table.Column<TimeOnly>(type: "time(0)", nullable: false),
                    ShiftEnd = table.Column<TimeOnly>(type: "time(0)", nullable: false),
                    LateGraceMinutes = table.Column<int>(type: "int", nullable: false),
                    EarlyGraceMinutes = table.Column<int>(type: "int", nullable: false),
                    WeeklyOff = table.Column<int>(type: "int", nullable: false),
                    OfficeLatitude = table.Column<double>(type: "float", nullable: true),
                    OfficeLongitude = table.Column<double>(type: "float", nullable: true),
                    OfficeRadiusMeters = table.Column<int>(type: "int", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StaffSettings", x => x.Id);
                    table.CheckConstraint("CK_StaffSettings_Singleton", "[Id] = 1");
                });

            migrationBuilder.CreateTable(
                name: "StaffLeaveRequests",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    WorkerId = table.Column<int>(type: "int", nullable: false),
                    LeaveTypeId = table.Column<int>(type: "int", nullable: false),
                    StartDate = table.Column<DateOnly>(type: "date", nullable: false),
                    EndDate = table.Column<DateOnly>(type: "date", nullable: false),
                    Days = table.Column<int>(type: "int", nullable: false),
                    Reason = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    Status = table.Column<string>(type: "nvarchar(12)", maxLength: 12, nullable: false),
                    CreatedBy = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    CreatedUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    DecidedBy = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    DecidedUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    DecisionNote = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StaffLeaveRequests", x => x.Id);
                    table.CheckConstraint("CK_StaffLeaveRequests_Dates", "[EndDate] >= [StartDate]");
                    table.ForeignKey(
                        name: "FK_StaffLeaveRequests_StaffLeaveTypes_LeaveTypeId",
                        column: x => x.LeaveTypeId,
                        principalTable: "StaffLeaveTypes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_StaffLeaveRequests_Workers_WorkerId",
                        column: x => x.WorkerId,
                        principalTable: "Workers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "StaffPunchSelfies",
                columns: table => new
                {
                    PunchId = table.Column<long>(type: "bigint", nullable: false),
                    Data = table.Column<byte[]>(type: "varbinary(max)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StaffPunchSelfies", x => x.PunchId);
                    table.ForeignKey(
                        name: "FK_StaffPunchSelfies_StaffPunches_PunchId",
                        column: x => x.PunchId,
                        principalTable: "StaffPunches",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.InsertData(
                table: "StaffLeaveTypes",
                columns: new[] { "Id", "IsActive", "Name", "YearlyDays" },
                values: new object[,]
                {
                    { 1, true, "Annual Leave", 30 },
                    { 2, true, "Sick Leave", 15 },
                    { 3, true, "Emergency Leave", 5 },
                    { 4, true, "Unpaid Leave", 365 }
                });

            migrationBuilder.InsertData(
                table: "StaffSettings",
                columns: new[] { "Id", "EarlyGraceMinutes", "LateGraceMinutes", "OfficeLatitude", "OfficeLongitude", "OfficeRadiusMeters", "ShiftEnd", "ShiftStart", "WeeklyOff" },
                values: new object[] { 1, 15, 15, null, null, null, new TimeOnly(17, 0, 0), new TimeOnly(9, 0, 0), 0 });

            migrationBuilder.CreateIndex(
                name: "IX_Workers_Category",
                table: "Workers",
                column: "Category");

            migrationBuilder.CreateIndex(
                name: "IX_Workers_UserId",
                table: "Workers",
                column: "UserId",
                unique: true,
                filter: "[UserId] IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Workers_Category",
                table: "Workers",
                sql: "[Category] IN ('Worker', 'Employee')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Users_Role",
                table: "Users",
                sql: "[Role] IN ('Administrator', 'Manager', 'Supervisor', 'HR', 'Viewer', 'Employee')");

            migrationBuilder.CreateIndex(
                name: "IX_PublicHolidays_Date",
                table: "PublicHolidays",
                column: "Date",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_StaffLeaveRequests_LeaveTypeId",
                table: "StaffLeaveRequests",
                column: "LeaveTypeId");

            migrationBuilder.CreateIndex(
                name: "IX_StaffLeaveRequests_Status",
                table: "StaffLeaveRequests",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_StaffLeaveRequests_WorkerId_StartDate",
                table: "StaffLeaveRequests",
                columns: new[] { "WorkerId", "StartDate" });

            migrationBuilder.CreateIndex(
                name: "IX_StaffLeaveTypes_Name",
                table: "StaffLeaveTypes",
                column: "Name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_StaffPunches_TimestampUtc",
                table: "StaffPunches",
                column: "TimestampUtc");

            migrationBuilder.CreateIndex(
                name: "IX_StaffPunches_WorkerId_WorkDate",
                table: "StaffPunches",
                columns: new[] { "WorkerId", "WorkDate" });

            migrationBuilder.AddForeignKey(
                name: "FK_Workers_Users_UserId",
                table: "Workers",
                column: "UserId",
                principalTable: "Users",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Workers_Users_UserId",
                table: "Workers");

            migrationBuilder.DropTable(
                name: "PublicHolidays");

            migrationBuilder.DropTable(
                name: "StaffLeaveRequests");

            migrationBuilder.DropTable(
                name: "StaffPunchSelfies");

            migrationBuilder.DropTable(
                name: "StaffSettings");

            migrationBuilder.DropTable(
                name: "StaffLeaveTypes");

            migrationBuilder.DropTable(
                name: "StaffPunches");

            migrationBuilder.DropIndex(
                name: "IX_Workers_Category",
                table: "Workers");

            migrationBuilder.DropIndex(
                name: "IX_Workers_UserId",
                table: "Workers");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Workers_Category",
                table: "Workers");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Users_Role",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "Category",
                table: "Workers");

            migrationBuilder.DropColumn(
                name: "UserId",
                table: "Workers");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Users_Role",
                table: "Users",
                sql: "[Role] IN ('Administrator', 'Manager', 'Supervisor', 'HR', 'Viewer')");
        }
    }
}
