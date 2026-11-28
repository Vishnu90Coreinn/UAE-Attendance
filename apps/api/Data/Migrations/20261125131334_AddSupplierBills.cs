using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HrPayroll.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddSupplierBills : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "BillId",
                table: "FinEntries",
                type: "int",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "FinBills",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    BillNo = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    SupplierName = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    PayeeId = table.Column<int>(type: "int", nullable: true),
                    SupplierRef = table.Column<string>(type: "nvarchar(60)", maxLength: 60, nullable: true),
                    BillDate = table.Column<DateOnly>(type: "date", nullable: false),
                    DueDate = table.Column<DateOnly>(type: "date", nullable: false),
                    Notes = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: true),
                    Status = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: false),
                    TaxTypeId = table.Column<int>(type: "int", nullable: true),
                    TaxRate = table.Column<decimal>(type: "decimal(5,2)", precision: 5, scale: 2, nullable: false),
                    TaxAmount = table.Column<decimal>(type: "decimal(12,2)", precision: 12, scale: 2, nullable: false),
                    Net = table.Column<decimal>(type: "decimal(12,2)", precision: 12, scale: 2, nullable: false),
                    Total = table.Column<decimal>(type: "decimal(12,2)", precision: 12, scale: 2, nullable: false),
                    VoidReason = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: true),
                    VoidedBy = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    VoidedUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    CreatedBy = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    CreatedUtc = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FinBills", x => x.Id);
                    table.CheckConstraint("CK_FinBills_Amounts", "[Net] > 0 AND [Total] >= [Net] AND [TaxAmount] >= 0");
                    table.CheckConstraint("CK_FinBills_Status", "[Status] IN ('Open', 'Voided')");
                    table.ForeignKey(
                        name: "FK_FinBills_FinPayees_PayeeId",
                        column: x => x.PayeeId,
                        principalTable: "FinPayees",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "FinBillLines",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    BillId = table.Column<int>(type: "int", nullable: false),
                    CategoryId = table.Column<int>(type: "int", nullable: false),
                    Amount = table.Column<decimal>(type: "decimal(12,2)", precision: 12, scale: 2, nullable: false),
                    Note = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FinBillLines", x => x.Id);
                    table.CheckConstraint("CK_FinBillLines_Amount", "[Amount] > 0");
                    table.ForeignKey(
                        name: "FK_FinBillLines_FinBills_BillId",
                        column: x => x.BillId,
                        principalTable: "FinBills",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_FinBillLines_FinCategories_CategoryId",
                        column: x => x.CategoryId,
                        principalTable: "FinCategories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_FinEntries_BillId",
                table: "FinEntries",
                column: "BillId",
                filter: "[BillId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_FinBillLines_BillId",
                table: "FinBillLines",
                column: "BillId");

            migrationBuilder.CreateIndex(
                name: "IX_FinBillLines_CategoryId",
                table: "FinBillLines",
                column: "CategoryId");

            migrationBuilder.CreateIndex(
                name: "IX_FinBills_BillDate",
                table: "FinBills",
                column: "BillDate");

            migrationBuilder.CreateIndex(
                name: "IX_FinBills_BillNo",
                table: "FinBills",
                column: "BillNo",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_FinBills_PayeeId",
                table: "FinBills",
                column: "PayeeId");

            migrationBuilder.CreateIndex(
                name: "IX_FinBills_Status",
                table: "FinBills",
                column: "Status");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "FinBillLines");

            migrationBuilder.DropTable(
                name: "FinBills");

            migrationBuilder.DropIndex(
                name: "IX_FinEntries_BillId",
                table: "FinEntries");

            migrationBuilder.DropColumn(
                name: "BillId",
                table: "FinEntries");
        }
    }
}
