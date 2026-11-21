using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HrPayroll.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class StaffLeaveDocuments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "StaffLeaveAttachments",
                columns: table => new
                {
                    StaffLeaveRequestId = table.Column<int>(type: "int", nullable: false),
                    Data = table.Column<byte[]>(type: "varbinary(max)", nullable: false),
                    UploadedUtc = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StaffLeaveAttachments", x => x.StaffLeaveRequestId);
                    table.ForeignKey(
                        name: "FK_StaffLeaveAttachments_StaffLeaveRequests_StaffLeaveRequestId",
                        column: x => x.StaffLeaveRequestId,
                        principalTable: "StaffLeaveRequests",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "StaffLeaveAttachments");
        }
    }
}
