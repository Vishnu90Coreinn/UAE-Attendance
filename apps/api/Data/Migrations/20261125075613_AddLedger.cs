using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HrPayroll.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddLedger : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateSequence<int>(
                name: "LedgerJournalNo");

            migrationBuilder.AddColumn<int>(
                name: "LedgerAccountId",
                table: "FinPartners",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "LedgerAccountId",
                table: "FinCategories",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "LedgerAccountId",
                table: "FinAccounts",
                type: "int",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "Journals",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Number = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    SourceType = table.Column<string>(type: "nvarchar(12)", maxLength: 12, nullable: false),
                    SourceId = table.Column<int>(type: "int", nullable: false),
                    Revision = table.Column<int>(type: "int", nullable: false),
                    Part = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: false),
                    Description = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: false),
                    ReversesJournalId = table.Column<int>(type: "int", nullable: true),
                    CreatedUtc = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Journals", x => x.Id);
                    table.CheckConstraint("CK_Journals_Part", "[Part] IN ('Post', 'Reversal')");
                    table.ForeignKey(
                        name: "FK_Journals_Journals_ReversesJournalId",
                        column: x => x.ReversesJournalId,
                        principalTable: "Journals",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "LedgerAccounts",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Code = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false, collation: "SQL_Latin1_General_CP1_CI_AS"),
                    Name = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    Type = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false, defaultValue: true),
                    IsSystem = table.Column<bool>(type: "bit", nullable: false),
                    CreatedUtc = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LedgerAccounts", x => x.Id);
                    table.CheckConstraint("CK_LedgerAccounts_Type", "[Type] IN ('Asset', 'Liability', 'Equity', 'Revenue', 'Expense')");
                });

            migrationBuilder.CreateTable(
                name: "JournalLines",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    JournalId = table.Column<int>(type: "int", nullable: false),
                    LedgerAccountId = table.Column<int>(type: "int", nullable: false),
                    Debit = table.Column<decimal>(type: "decimal(12,2)", precision: 12, scale: 2, nullable: false),
                    Credit = table.Column<decimal>(type: "decimal(12,2)", precision: 12, scale: 2, nullable: false),
                    Memo = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_JournalLines", x => x.Id);
                    table.CheckConstraint("CK_JournalLines_Side", "([Debit] > 0 AND [Credit] = 0) OR ([Credit] > 0 AND [Debit] = 0)");
                    table.ForeignKey(
                        name: "FK_JournalLines_Journals_JournalId",
                        column: x => x.JournalId,
                        principalTable: "Journals",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_JournalLines_LedgerAccounts_LedgerAccountId",
                        column: x => x.LedgerAccountId,
                        principalTable: "LedgerAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.UpdateData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 1,
                column: "LedgerAccountId",
                value: null);

            migrationBuilder.UpdateData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 2,
                column: "LedgerAccountId",
                value: null);

            migrationBuilder.UpdateData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 3,
                column: "LedgerAccountId",
                value: null);

            migrationBuilder.UpdateData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 4,
                column: "LedgerAccountId",
                value: null);

            migrationBuilder.UpdateData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 5,
                column: "LedgerAccountId",
                value: null);

            migrationBuilder.UpdateData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 6,
                column: "LedgerAccountId",
                value: null);

            migrationBuilder.UpdateData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 7,
                column: "LedgerAccountId",
                value: null);

            migrationBuilder.UpdateData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 8,
                column: "LedgerAccountId",
                value: null);

            migrationBuilder.UpdateData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 9,
                column: "LedgerAccountId",
                value: null);

            migrationBuilder.UpdateData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 10,
                column: "LedgerAccountId",
                value: null);

            migrationBuilder.UpdateData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 11,
                column: "LedgerAccountId",
                value: null);

            migrationBuilder.UpdateData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 12,
                column: "LedgerAccountId",
                value: null);

            migrationBuilder.CreateIndex(
                name: "IX_FinPartners_LedgerAccountId",
                table: "FinPartners",
                column: "LedgerAccountId");

            migrationBuilder.CreateIndex(
                name: "IX_FinCategories_LedgerAccountId",
                table: "FinCategories",
                column: "LedgerAccountId");

            migrationBuilder.CreateIndex(
                name: "IX_FinAccounts_LedgerAccountId",
                table: "FinAccounts",
                column: "LedgerAccountId");

            migrationBuilder.CreateIndex(
                name: "IX_JournalLines_JournalId",
                table: "JournalLines",
                column: "JournalId");

            migrationBuilder.CreateIndex(
                name: "IX_JournalLines_LedgerAccountId",
                table: "JournalLines",
                column: "LedgerAccountId");

            migrationBuilder.CreateIndex(
                name: "IX_Journals_Date",
                table: "Journals",
                column: "Date");

            migrationBuilder.CreateIndex(
                name: "IX_Journals_Number",
                table: "Journals",
                column: "Number",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Journals_ReversesJournalId",
                table: "Journals",
                column: "ReversesJournalId");

            migrationBuilder.CreateIndex(
                name: "IX_Journals_SourceType_SourceId_Revision_Part",
                table: "Journals",
                columns: new[] { "SourceType", "SourceId", "Revision", "Part" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_LedgerAccounts_Code",
                table: "LedgerAccounts",
                column: "Code",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_FinAccounts_LedgerAccounts_LedgerAccountId",
                table: "FinAccounts",
                column: "LedgerAccountId",
                principalTable: "LedgerAccounts",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_FinCategories_LedgerAccounts_LedgerAccountId",
                table: "FinCategories",
                column: "LedgerAccountId",
                principalTable: "LedgerAccounts",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_FinPartners_LedgerAccounts_LedgerAccountId",
                table: "FinPartners",
                column: "LedgerAccountId",
                principalTable: "LedgerAccounts",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_FinAccounts_LedgerAccounts_LedgerAccountId",
                table: "FinAccounts");

            migrationBuilder.DropForeignKey(
                name: "FK_FinCategories_LedgerAccounts_LedgerAccountId",
                table: "FinCategories");

            migrationBuilder.DropForeignKey(
                name: "FK_FinPartners_LedgerAccounts_LedgerAccountId",
                table: "FinPartners");

            migrationBuilder.DropTable(
                name: "JournalLines");

            migrationBuilder.DropTable(
                name: "Journals");

            migrationBuilder.DropTable(
                name: "LedgerAccounts");

            migrationBuilder.DropIndex(
                name: "IX_FinPartners_LedgerAccountId",
                table: "FinPartners");

            migrationBuilder.DropIndex(
                name: "IX_FinCategories_LedgerAccountId",
                table: "FinCategories");

            migrationBuilder.DropIndex(
                name: "IX_FinAccounts_LedgerAccountId",
                table: "FinAccounts");

            migrationBuilder.DropColumn(
                name: "LedgerAccountId",
                table: "FinPartners");

            migrationBuilder.DropColumn(
                name: "LedgerAccountId",
                table: "FinCategories");

            migrationBuilder.DropColumn(
                name: "LedgerAccountId",
                table: "FinAccounts");

            migrationBuilder.DropSequence(
                name: "LedgerJournalNo");
        }
    }
}
