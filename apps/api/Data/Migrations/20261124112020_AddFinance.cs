using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace HrPayroll.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddFinance : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "FinAccounts",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Name = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false, collation: "SQL_Latin1_General_CP1_CI_AS"),
                    Kind = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: false),
                    BankName = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: true),
                    AccountNumber = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: true),
                    Iban = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: true),
                    OpeningBalance = table.Column<decimal>(type: "decimal(12,2)", precision: 12, scale: 2, nullable: false),
                    OpeningDate = table.Column<DateOnly>(type: "date", nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false, defaultValue: true),
                    SortOrder = table.Column<int>(type: "int", nullable: false),
                    CreatedUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    UpdatedUtc = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FinAccounts", x => x.Id);
                    table.CheckConstraint("CK_FinAccounts_Kind", "[Kind] IN ('Bank', 'Cash')");
                });

            migrationBuilder.CreateTable(
                name: "FinCategories",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Kind = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: false),
                    Name = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false, collation: "SQL_Latin1_General_CP1_CI_AS"),
                    IsActive = table.Column<bool>(type: "bit", nullable: false, defaultValue: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FinCategories", x => x.Id);
                    table.CheckConstraint("CK_FinCategories_Kind", "[Kind] IN ('Expense', 'Income')");
                });

            migrationBuilder.CreateTable(
                name: "FinTransfers",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    TransferNo = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    TransferDate = table.Column<DateOnly>(type: "date", nullable: false),
                    FromAccountId = table.Column<int>(type: "int", nullable: false),
                    ToAccountId = table.Column<int>(type: "int", nullable: false),
                    Amount = table.Column<decimal>(type: "decimal(12,2)", precision: 12, scale: 2, nullable: false),
                    Reference = table.Column<string>(type: "nvarchar(60)", maxLength: 60, nullable: true),
                    Notes = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: true),
                    Status = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: false),
                    VoidReason = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: true),
                    VoidedBy = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    VoidedUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    ReplacesTransferId = table.Column<int>(type: "int", nullable: true),
                    CreatedBy = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    CreatedUtc = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FinTransfers", x => x.Id);
                    table.CheckConstraint("CK_FinTransfers_Accounts", "[FromAccountId] <> [ToAccountId]");
                    table.CheckConstraint("CK_FinTransfers_Amount", "[Amount] > 0");
                    table.CheckConstraint("CK_FinTransfers_Status", "[Status] IN ('Active', 'Voided')");
                    table.CheckConstraint("CK_FinTransfers_Voided", "[Status] = 'Active' OR [VoidedUtc] IS NOT NULL");
                    table.ForeignKey(
                        name: "FK_FinTransfers_FinAccounts_FromAccountId",
                        column: x => x.FromAccountId,
                        principalTable: "FinAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_FinTransfers_FinAccounts_ToAccountId",
                        column: x => x.ToAccountId,
                        principalTable: "FinAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_FinTransfers_FinTransfers_ReplacesTransferId",
                        column: x => x.ReplacesTransferId,
                        principalTable: "FinTransfers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "FinEntries",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Kind = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: false),
                    EntryNo = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    EntryDate = table.Column<DateOnly>(type: "date", nullable: false),
                    CategoryId = table.Column<int>(type: "int", nullable: false),
                    Party = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    AccountId = table.Column<int>(type: "int", nullable: false),
                    Amount = table.Column<decimal>(type: "decimal(12,2)", precision: 12, scale: 2, nullable: false),
                    Reference = table.Column<string>(type: "nvarchar(60)", maxLength: 60, nullable: true),
                    Notes = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: true),
                    Status = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: false),
                    VoidReason = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: true),
                    VoidedBy = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    VoidedUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    ReplacesEntryId = table.Column<int>(type: "int", nullable: true),
                    CreatedBy = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    CreatedUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    ExternalSource = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: true),
                    ExternalId = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FinEntries", x => x.Id);
                    table.CheckConstraint("CK_FinEntries_Amount", "[Amount] > 0");
                    table.CheckConstraint("CK_FinEntries_Kind", "[Kind] IN ('Expense', 'Income')");
                    table.CheckConstraint("CK_FinEntries_Status", "[Status] IN ('Active', 'Voided')");
                    table.CheckConstraint("CK_FinEntries_Voided", "[Status] = 'Active' OR [VoidedUtc] IS NOT NULL");
                    table.ForeignKey(
                        name: "FK_FinEntries_FinAccounts_AccountId",
                        column: x => x.AccountId,
                        principalTable: "FinAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_FinEntries_FinCategories_CategoryId",
                        column: x => x.CategoryId,
                        principalTable: "FinCategories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_FinEntries_FinEntries_ReplacesEntryId",
                        column: x => x.ReplacesEntryId,
                        principalTable: "FinEntries",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.InsertData(
                table: "FinCategories",
                columns: new[] { "Id", "IsActive", "Kind", "Name" },
                values: new object[,]
                {
                    { 1, true, "Expense", "Company expenses" },
                    { 2, true, "Expense", "Government-related procedures for workers" },
                    { 3, true, "Expense", "Salary Advance" },
                    { 4, true, "Expense", "Monthly Salary" },
                    { 5, true, "Expense", "Worker Accommodation Rent" },
                    { 6, true, "Expense", "Worker Transportation" },
                    { 7, true, "Expense", "Office Rent" },
                    { 8, true, "Expense", "Dubai Insurance" },
                    { 9, true, "Expense", "Commission for Labor" },
                    { 10, true, "Income", "Other income" }
                });

            migrationBuilder.CreateIndex(
                name: "IX_FinAccounts_Name",
                table: "FinAccounts",
                column: "Name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_FinCategories_Kind_Name",
                table: "FinCategories",
                columns: new[] { "Kind", "Name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_FinEntries_AccountId_EntryDate",
                table: "FinEntries",
                columns: new[] { "AccountId", "EntryDate" });

            migrationBuilder.CreateIndex(
                name: "IX_FinEntries_CategoryId",
                table: "FinEntries",
                column: "CategoryId");

            migrationBuilder.CreateIndex(
                name: "IX_FinEntries_EntryDate",
                table: "FinEntries",
                column: "EntryDate");

            migrationBuilder.CreateIndex(
                name: "IX_FinEntries_EntryNo",
                table: "FinEntries",
                column: "EntryNo",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_FinEntries_ExternalSource_ExternalId",
                table: "FinEntries",
                columns: new[] { "ExternalSource", "ExternalId" },
                unique: true,
                filter: "[ExternalId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_FinEntries_ReplacesEntryId",
                table: "FinEntries",
                column: "ReplacesEntryId");

            migrationBuilder.CreateIndex(
                name: "IX_FinTransfers_FromAccountId",
                table: "FinTransfers",
                column: "FromAccountId");

            migrationBuilder.CreateIndex(
                name: "IX_FinTransfers_ReplacesTransferId",
                table: "FinTransfers",
                column: "ReplacesTransferId");

            migrationBuilder.CreateIndex(
                name: "IX_FinTransfers_ToAccountId",
                table: "FinTransfers",
                column: "ToAccountId");

            migrationBuilder.CreateIndex(
                name: "IX_FinTransfers_TransferDate",
                table: "FinTransfers",
                column: "TransferDate");

            migrationBuilder.CreateIndex(
                name: "IX_FinTransfers_TransferNo",
                table: "FinTransfers",
                column: "TransferNo",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "FinEntries");

            migrationBuilder.DropTable(
                name: "FinTransfers");

            migrationBuilder.DropTable(
                name: "FinCategories");

            migrationBuilder.DropTable(
                name: "FinAccounts");
        }
    }
}
