using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HrPayroll.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddLeaveRequests : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "LeaveRequests",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    WorkerId = table.Column<int>(type: "int", nullable: false),
                    LeaveType = table.Column<string>(type: "nvarchar(30)", maxLength: 30, nullable: false),
                    StartDate = table.Column<DateOnly>(type: "date", nullable: false),
                    EndDate = table.Column<DateOnly>(type: "date", nullable: false),
                    Days = table.Column<int>(type: "int", nullable: false, computedColumnSql: "DATEDIFF(day, [StartDate], [EndDate]) + 1", stored: true),
                    Status = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: false),
                    CreatedBy = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                    CreatedUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    DecidedBy = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: true),
                    DecidedUtc = table.Column<DateTime>(type: "datetime2", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LeaveRequests", x => x.Id);
                    table.CheckConstraint("CK_LeaveRequests_Dates", "[EndDate] >= [StartDate]");
                    table.CheckConstraint("CK_LeaveRequests_Status", "DATALENGTH([Status]) = DATALENGTH(RTRIM([Status])) AND [Status] COLLATE Latin1_General_100_BIN2 IN ('Pending','Approved','Rejected')");
                    table.CheckConstraint("CK_LeaveRequests_Type", "DATALENGTH([LeaveType]) = DATALENGTH(RTRIM([LeaveType])) AND [LeaveType] COLLATE Latin1_General_100_BIN2 IN ('Annual Leave','Sick Leave','Unpaid Leave','Emergency Leave')");
                    table.ForeignKey(
                        name: "FK_LeaveRequests_Workers_WorkerId",
                        column: x => x.WorkerId,
                        principalTable: "Workers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_LeaveRequests_WorkerId_StartDate_EndDate",
                table: "LeaveRequests",
                columns: new[] { "WorkerId", "StartDate", "EndDate" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "LeaveRequests");
        }
    }
}
