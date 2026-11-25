using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HrPayroll.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddFinMonthLocks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_FinAttachments_StoredName",
                table: "FinAttachments");

            migrationBuilder.CreateTable(
                name: "FinMonthLocks",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Year = table.Column<int>(type: "int", nullable: false),
                    Month = table.Column<int>(type: "int", nullable: false),
                    IsLocked = table.Column<bool>(type: "bit", nullable: false),
                    LockedBy = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    LockedUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    UnlockedBy = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    UnlockedUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    UnlockReason = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FinMonthLocks", x => x.Id);
                    table.CheckConstraint("CK_FinMonthLocks_Month", "[Month] BETWEEN 1 AND 12");
                });

            migrationBuilder.CreateIndex(
                name: "IX_FinAttachments_StoredName",
                table: "FinAttachments",
                column: "StoredName");

            migrationBuilder.CreateIndex(
                name: "IX_FinMonthLocks_Year_Month",
                table: "FinMonthLocks",
                columns: new[] { "Year", "Month" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "FinMonthLocks");

            migrationBuilder.DropIndex(
                name: "IX_FinAttachments_StoredName",
                table: "FinAttachments");

            migrationBuilder.CreateIndex(
                name: "IX_FinAttachments_StoredName",
                table: "FinAttachments",
                column: "StoredName",
                unique: true);
        }
    }
}
