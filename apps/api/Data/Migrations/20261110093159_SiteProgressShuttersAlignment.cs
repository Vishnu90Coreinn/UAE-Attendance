using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HrPayroll.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class SiteProgressShuttersAlignment : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_SiteProgressFloors_Counts",
                table: "SiteProgressFloors");

            migrationBuilder.DropCheckConstraint(
                name: "CK_SiteProgressFloors_Wir",
                table: "SiteProgressFloors");

            migrationBuilder.AlterColumn<string>(
                name: "WirStatus",
                table: "SiteProgressFloors",
                type: "nvarchar(24)",
                maxLength: 24,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(20)",
                oldMaxLength: 20);

            migrationBuilder.AddColumn<string>(
                name: "Alignment",
                table: "SiteProgressFloors",
                type: "nvarchar(12)",
                maxLength: 12,
                nullable: false,
                defaultValue: "NotComplete");

            migrationBuilder.AddColumn<int>(
                name: "Shutters",
                table: "SiteProgressFloors",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddCheckConstraint(
                name: "CK_SiteProgressFloors_Alignment",
                table: "SiteProgressFloors",
                sql: "[Alignment] IN ('NotComplete','UnderProcess','Complete')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_SiteProgressFloors_Counts",
                table: "SiteProgressFloors",
                sql: "[Frames] >= 0 AND [Glass] >= 0 AND [Shutters] >= 0");

            migrationBuilder.AddCheckConstraint(
                name: "CK_SiteProgressFloors_Wir",
                table: "SiteProgressFloors",
                sql: "[WirStatus] IN ('Pending','Submitted','AlignmentNotComplete','AlignmentUnderProcess','AlignmentComplete','Approved','ApprovedWithComments','Rejected')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_SiteProgressFloors_Alignment",
                table: "SiteProgressFloors");

            migrationBuilder.DropCheckConstraint(
                name: "CK_SiteProgressFloors_Counts",
                table: "SiteProgressFloors");

            migrationBuilder.DropCheckConstraint(
                name: "CK_SiteProgressFloors_Wir",
                table: "SiteProgressFloors");

            migrationBuilder.DropColumn(
                name: "Alignment",
                table: "SiteProgressFloors");

            migrationBuilder.DropColumn(
                name: "Shutters",
                table: "SiteProgressFloors");

            migrationBuilder.AlterColumn<string>(
                name: "WirStatus",
                table: "SiteProgressFloors",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(24)",
                oldMaxLength: 24);

            migrationBuilder.AddCheckConstraint(
                name: "CK_SiteProgressFloors_Counts",
                table: "SiteProgressFloors",
                sql: "[Frames] >= 0 AND [Glass] >= 0");

            migrationBuilder.AddCheckConstraint(
                name: "CK_SiteProgressFloors_Wir",
                table: "SiteProgressFloors",
                sql: "[WirStatus] IN ('Pending','Submitted','Approved','ApprovedWithComments','Rejected')");
        }
    }
}
