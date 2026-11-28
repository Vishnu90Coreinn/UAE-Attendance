using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace HrPayroll.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddFinPartnersAndCapital : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_FinEntries_Kind",
                table: "FinEntries");

            migrationBuilder.DropCheckConstraint(
                name: "CK_FinCategories_Kind",
                table: "FinCategories");

            migrationBuilder.CreateSequence<int>(
                name: "FinCapitalNo");

            migrationBuilder.CreateSequence<int>(
                name: "FinCapitalOutNo");

            migrationBuilder.AddColumn<int>(
                name: "PartnerId",
                table: "FinEntries",
                type: "int",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "FinPartners",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Name = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false, collation: "SQL_Latin1_General_CP1_CI_AS"),
                    OpeningCapital = table.Column<decimal>(type: "decimal(12,2)", precision: 12, scale: 2, nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false, defaultValue: true),
                    SortOrder = table.Column<int>(type: "int", nullable: false),
                    CreatedUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    UpdatedUtc = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FinPartners", x => x.Id);
                    table.CheckConstraint("CK_FinPartners_OpeningCapital", "[OpeningCapital] >= 0");
                });

            migrationBuilder.InsertData(
                table: "FinCategories",
                columns: new[] { "Id", "IsActive", "Kind", "Name" },
                values: new object[,]
                {
                    { 11, true, "Capital", "Capital contribution" },
                    { 12, true, "CapitalOut", "Capital returned" }
                });

            migrationBuilder.CreateIndex(
                name: "IX_FinEntries_PartnerId",
                table: "FinEntries",
                column: "PartnerId");

            migrationBuilder.AddCheckConstraint(
                name: "CK_FinEntries_Kind",
                table: "FinEntries",
                sql: "[Kind] IN ('Expense', 'Income', 'Capital', 'CapitalOut')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_FinEntries_Partner",
                table: "FinEntries",
                sql: "([Kind] IN ('Capital', 'CapitalOut') AND [PartnerId] IS NOT NULL) OR ([Kind] IN ('Expense', 'Income') AND [PartnerId] IS NULL)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_FinCategories_Kind",
                table: "FinCategories",
                sql: "[Kind] IN ('Expense', 'Income', 'Capital', 'CapitalOut')");

            migrationBuilder.CreateIndex(
                name: "IX_FinPartners_Name",
                table: "FinPartners",
                column: "Name",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_FinEntries_FinPartners_PartnerId",
                table: "FinEntries",
                column: "PartnerId",
                principalTable: "FinPartners",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_FinEntries_FinPartners_PartnerId",
                table: "FinEntries");

            migrationBuilder.DropTable(
                name: "FinPartners");

            migrationBuilder.DropIndex(
                name: "IX_FinEntries_PartnerId",
                table: "FinEntries");

            migrationBuilder.DropCheckConstraint(
                name: "CK_FinEntries_Kind",
                table: "FinEntries");

            migrationBuilder.DropCheckConstraint(
                name: "CK_FinEntries_Partner",
                table: "FinEntries");

            migrationBuilder.DropCheckConstraint(
                name: "CK_FinCategories_Kind",
                table: "FinCategories");

            migrationBuilder.DeleteData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 11);

            migrationBuilder.DeleteData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 12);

            migrationBuilder.DropColumn(
                name: "PartnerId",
                table: "FinEntries");

            migrationBuilder.DropSequence(
                name: "FinCapitalNo");

            migrationBuilder.DropSequence(
                name: "FinCapitalOutNo");

            migrationBuilder.AddCheckConstraint(
                name: "CK_FinEntries_Kind",
                table: "FinEntries",
                sql: "[Kind] IN ('Expense', 'Income')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_FinCategories_Kind",
                table: "FinCategories",
                sql: "[Kind] IN ('Expense', 'Income')");
        }
    }
}
