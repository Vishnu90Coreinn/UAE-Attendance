using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HrPayroll.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddFinPayeesAndEntryLines : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "PayeeId",
                table: "FinEntries",
                type: "int",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "FinEntryLines",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    EntryId = table.Column<int>(type: "int", nullable: false),
                    CategoryId = table.Column<int>(type: "int", nullable: false),
                    Amount = table.Column<decimal>(type: "decimal(12,2)", precision: 12, scale: 2, nullable: false),
                    Note = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FinEntryLines", x => x.Id);
                    table.CheckConstraint("CK_FinEntryLines_Amount", "[Amount] > 0");
                    table.ForeignKey(
                        name: "FK_FinEntryLines_FinCategories_CategoryId",
                        column: x => x.CategoryId,
                        principalTable: "FinCategories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_FinEntryLines_FinEntries_EntryId",
                        column: x => x.EntryId,
                        principalTable: "FinEntries",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "FinPayees",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Kind = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: false),
                    Name = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false, collation: "SQL_Latin1_General_CP1_CI_AS"),
                    DefaultCategoryId = table.Column<int>(type: "int", nullable: true),
                    Phone = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: true),
                    TaxNumber = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: true),
                    Notes = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    IsActive = table.Column<bool>(type: "bit", nullable: false, defaultValue: true),
                    CreatedUtc = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FinPayees", x => x.Id);
                    table.CheckConstraint("CK_FinPayees_Kind", "[Kind] IN ('Expense', 'Income')");
                    table.ForeignKey(
                        name: "FK_FinPayees_FinCategories_DefaultCategoryId",
                        column: x => x.DefaultCategoryId,
                        principalTable: "FinCategories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_FinEntries_PayeeId",
                table: "FinEntries",
                column: "PayeeId");

            migrationBuilder.CreateIndex(
                name: "IX_FinEntryLines_CategoryId",
                table: "FinEntryLines",
                column: "CategoryId");

            migrationBuilder.CreateIndex(
                name: "IX_FinEntryLines_EntryId",
                table: "FinEntryLines",
                column: "EntryId");

            migrationBuilder.CreateIndex(
                name: "IX_FinPayees_DefaultCategoryId",
                table: "FinPayees",
                column: "DefaultCategoryId");

            migrationBuilder.CreateIndex(
                name: "IX_FinPayees_Kind_Name",
                table: "FinPayees",
                columns: new[] { "Kind", "Name" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_FinEntries_FinPayees_PayeeId",
                table: "FinEntries",
                column: "PayeeId",
                principalTable: "FinPayees",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            // Every expense and income already recorded becomes one line for its own category, so reports can read the lines alone.
            migrationBuilder.Sql("INSERT INTO [FinEntryLines] ([EntryId], [CategoryId], [Amount], [Note]) SELECT [Id], [CategoryId], [Amount], NULL FROM [FinEntries] WHERE [Kind] IN ('Expense', 'Income')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_FinEntries_FinPayees_PayeeId",
                table: "FinEntries");

            migrationBuilder.DropTable(
                name: "FinEntryLines");

            migrationBuilder.DropTable(
                name: "FinPayees");

            migrationBuilder.DropIndex(
                name: "IX_FinEntries_PayeeId",
                table: "FinEntries");

            migrationBuilder.DropColumn(
                name: "PayeeId",
                table: "FinEntries");
        }
    }
}
