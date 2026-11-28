using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HrPayroll.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddFinAttachments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateSequence<int>(
                name: "FinExpenseNo");

            migrationBuilder.CreateSequence<int>(
                name: "FinIncomeNo");

            migrationBuilder.CreateTable(
                name: "FinAttachments",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    EntryId = table.Column<int>(type: "int", nullable: false),
                    FileName = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    ContentType = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    SizeBytes = table.Column<long>(type: "bigint", nullable: false),
                    StoredName = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false),
                    Sha256 = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    UploadedBy = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    UploadedUtc = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FinAttachments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_FinAttachments_FinEntries_EntryId",
                        column: x => x.EntryId,
                        principalTable: "FinEntries",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_FinAttachments_EntryId",
                table: "FinAttachments",
                column: "EntryId");

            migrationBuilder.CreateIndex(
                name: "IX_FinAttachments_StoredName",
                table: "FinAttachments",
                column: "StoredName",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "FinAttachments");

            migrationBuilder.DropSequence(
                name: "FinExpenseNo");

            migrationBuilder.DropSequence(
                name: "FinIncomeNo");
        }
    }
}
