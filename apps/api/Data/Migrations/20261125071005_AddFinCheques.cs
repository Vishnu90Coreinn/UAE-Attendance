using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HrPayroll.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddFinCheques : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "FinCheques",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Direction = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: false),
                    Serial = table.Column<string>(type: "nvarchar(30)", maxLength: 30, nullable: false, collation: "SQL_Latin1_General_CP1_CI_AS"),
                    Amount = table.Column<decimal>(type: "decimal(12,2)", precision: 12, scale: 2, nullable: false),
                    PartyName = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    IssueDate = table.Column<DateOnly>(type: "date", nullable: false),
                    DueDate = table.Column<DateOnly>(type: "date", nullable: false),
                    AccountId = table.Column<int>(type: "int", nullable: false),
                    Status = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: false),
                    StatusDate = table.Column<DateOnly>(type: "date", nullable: true),
                    StatusNote = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: true),
                    EntryId = table.Column<int>(type: "int", nullable: true),
                    Notes = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: true),
                    CreatedBy = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    CreatedUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    UpdatedUtc = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FinCheques", x => x.Id);
                    table.CheckConstraint("CK_FinCheques_Amount", "[Amount] > 0");
                    table.CheckConstraint("CK_FinCheques_Direction", "[Direction] IN ('Issued', 'Received')");
                    table.CheckConstraint("CK_FinCheques_Status", "[Status] IN ('Issued', 'Delivered', 'Received', 'Deposited', 'Cleared', 'Bounced', 'Cancelled')");
                    table.ForeignKey(
                        name: "FK_FinCheques_FinAccounts_AccountId",
                        column: x => x.AccountId,
                        principalTable: "FinAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_FinCheques_FinEntries_EntryId",
                        column: x => x.EntryId,
                        principalTable: "FinEntries",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_FinCheques_AccountId_Serial",
                table: "FinCheques",
                columns: new[] { "AccountId", "Serial" },
                unique: true,
                filter: "[Direction] = 'Issued'");

            migrationBuilder.CreateIndex(
                name: "IX_FinCheques_DueDate",
                table: "FinCheques",
                column: "DueDate");

            migrationBuilder.CreateIndex(
                name: "IX_FinCheques_EntryId",
                table: "FinCheques",
                column: "EntryId");

            migrationBuilder.CreateIndex(
                name: "IX_FinCheques_Status",
                table: "FinCheques",
                column: "Status");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "FinCheques");
        }
    }
}
