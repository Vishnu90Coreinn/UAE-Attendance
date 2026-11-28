using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HrPayroll.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddRecurringJournals : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "RecurringJournals",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Description = table.Column<string>(type: "nvarchar(250)", maxLength: 250, nullable: false),
                    DayOfMonth = table.Column<int>(type: "int", nullable: false),
                    StartMonth = table.Column<DateOnly>(type: "date", nullable: false),
                    EndMonth = table.Column<DateOnly>(type: "date", nullable: true),
                    IsActive = table.Column<bool>(type: "bit", nullable: false),
                    CreatedBy = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    CreatedUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    StoppedBy = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    StoppedUtc = table.Column<DateTime>(type: "datetime2", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RecurringJournals", x => x.Id);
                    table.CheckConstraint("CK_RecurringJournals_Day", "[DayOfMonth] BETWEEN 1 AND 31");
                });

            migrationBuilder.CreateTable(
                name: "RecurringJournalLines",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    RecurringJournalId = table.Column<int>(type: "int", nullable: false),
                    LedgerAccountId = table.Column<int>(type: "int", nullable: false),
                    Debit = table.Column<decimal>(type: "decimal(12,2)", precision: 12, scale: 2, nullable: false),
                    Credit = table.Column<decimal>(type: "decimal(12,2)", precision: 12, scale: 2, nullable: false),
                    Memo = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RecurringJournalLines", x => x.Id);
                    table.CheckConstraint("CK_RecurringJournalLines_Side", "[Debit] >= 0 AND [Credit] >= 0 AND (([Debit] > 0 AND [Credit] = 0) OR ([Debit] = 0 AND [Credit] > 0))");
                    table.ForeignKey(
                        name: "FK_RecurringJournalLines_LedgerAccounts_LedgerAccountId",
                        column: x => x.LedgerAccountId,
                        principalTable: "LedgerAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_RecurringJournalLines_RecurringJournals_RecurringJournalId",
                        column: x => x.RecurringJournalId,
                        principalTable: "RecurringJournals",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "RecurringJournalRuns",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    RecurringJournalId = table.Column<int>(type: "int", nullable: false),
                    Month = table.Column<DateOnly>(type: "date", nullable: false),
                    JournalId = table.Column<int>(type: "int", nullable: false),
                    PostedUtc = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RecurringJournalRuns", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RecurringJournalRuns_RecurringJournals_RecurringJournalId",
                        column: x => x.RecurringJournalId,
                        principalTable: "RecurringJournals",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_RecurringJournalLines_LedgerAccountId",
                table: "RecurringJournalLines",
                column: "LedgerAccountId");

            migrationBuilder.CreateIndex(
                name: "IX_RecurringJournalLines_RecurringJournalId",
                table: "RecurringJournalLines",
                column: "RecurringJournalId");

            migrationBuilder.CreateIndex(
                name: "IX_RecurringJournalRuns_RecurringJournalId_Month",
                table: "RecurringJournalRuns",
                columns: new[] { "RecurringJournalId", "Month" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "RecurringJournalLines");

            migrationBuilder.DropTable(
                name: "RecurringJournalRuns");

            migrationBuilder.DropTable(
                name: "RecurringJournals");
        }
    }
}
