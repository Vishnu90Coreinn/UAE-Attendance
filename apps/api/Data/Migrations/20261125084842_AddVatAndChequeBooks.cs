using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace HrPayroll.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddVatAndChequeBooks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Journals_Part",
                table: "Journals");

            migrationBuilder.AddColumn<decimal>(
                name: "TaxAmount",
                table: "FinEntries",
                type: "decimal(12,2)",
                precision: 12,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<bool>(
                name: "TaxInclusive",
                table: "FinEntries",
                type: "bit",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<decimal>(
                name: "TaxRate",
                table: "FinEntries",
                type: "decimal(5,2)",
                precision: 5,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<int>(
                name: "TaxTypeId",
                table: "FinEntries",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "DefaultTaxTypeId",
                table: "FinCategories",
                type: "int",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "FinTaxTypes",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Name = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false, collation: "SQL_Latin1_General_CP1_CI_AS"),
                    Treatment = table.Column<string>(type: "nvarchar(13)", maxLength: 13, nullable: false),
                    Rate = table.Column<decimal>(type: "decimal(5,2)", precision: 5, scale: 2, nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false, defaultValue: true),
                    SortOrder = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FinTaxTypes", x => x.Id);
                    table.CheckConstraint("CK_FinTaxTypes_Rate", "[Rate] >= 0 AND [Rate] <= 100");
                    table.CheckConstraint("CK_FinTaxTypes_Treatment", "[Treatment] IN ('Standard', 'ZeroRated', 'Exempt', 'ReverseCharge', 'IntraGcc')");
                });

            migrationBuilder.UpdateData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 1,
                column: "DefaultTaxTypeId",
                value: null);

            migrationBuilder.UpdateData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 2,
                column: "DefaultTaxTypeId",
                value: null);

            migrationBuilder.UpdateData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 3,
                column: "DefaultTaxTypeId",
                value: null);

            migrationBuilder.UpdateData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 4,
                column: "DefaultTaxTypeId",
                value: null);

            migrationBuilder.UpdateData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 5,
                column: "DefaultTaxTypeId",
                value: null);

            migrationBuilder.UpdateData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 6,
                column: "DefaultTaxTypeId",
                value: null);

            migrationBuilder.UpdateData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 7,
                column: "DefaultTaxTypeId",
                value: null);

            migrationBuilder.UpdateData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 8,
                column: "DefaultTaxTypeId",
                value: null);

            migrationBuilder.UpdateData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 9,
                column: "DefaultTaxTypeId",
                value: null);

            migrationBuilder.UpdateData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 10,
                column: "DefaultTaxTypeId",
                value: null);

            migrationBuilder.UpdateData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 11,
                column: "DefaultTaxTypeId",
                value: null);

            migrationBuilder.UpdateData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 12,
                column: "DefaultTaxTypeId",
                value: null);

            migrationBuilder.InsertData(
                table: "FinTaxTypes",
                columns: new[] { "Id", "IsActive", "Name", "Rate", "SortOrder", "Treatment" },
                values: new object[,]
                {
                    { 1, true, "Standard Rated (VAT)", 5m, 1, "Standard" },
                    { 2, true, "Zero Rated", 0m, 2, "ZeroRated" },
                    { 3, true, "Exempt", 0m, 3, "Exempt" },
                    { 4, true, "Reverse Charges (VAT)", 5m, 4, "ReverseCharge" },
                    { 5, true, "Intra GCC", 0m, 5, "IntraGcc" }
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_Journals_Part",
                table: "Journals",
                sql: "[Part] IN ('Post', 'Reversal', 'Clear')");

            migrationBuilder.CreateIndex(
                name: "IX_FinEntries_TaxTypeId",
                table: "FinEntries",
                column: "TaxTypeId");

            migrationBuilder.AddCheckConstraint(
                name: "CK_FinEntries_Tax",
                table: "FinEntries",
                sql: "[TaxAmount] >= 0");

            migrationBuilder.CreateIndex(
                name: "IX_FinCategories_DefaultTaxTypeId",
                table: "FinCategories",
                column: "DefaultTaxTypeId");

            migrationBuilder.CreateIndex(
                name: "IX_FinTaxTypes_Name",
                table: "FinTaxTypes",
                column: "Name",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_FinCategories_FinTaxTypes_DefaultTaxTypeId",
                table: "FinCategories",
                column: "DefaultTaxTypeId",
                principalTable: "FinTaxTypes",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_FinEntries_FinTaxTypes_TaxTypeId",
                table: "FinEntries",
                column: "TaxTypeId",
                principalTable: "FinTaxTypes",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_FinCategories_FinTaxTypes_DefaultTaxTypeId",
                table: "FinCategories");

            migrationBuilder.DropForeignKey(
                name: "FK_FinEntries_FinTaxTypes_TaxTypeId",
                table: "FinEntries");

            migrationBuilder.DropTable(
                name: "FinTaxTypes");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Journals_Part",
                table: "Journals");

            migrationBuilder.DropIndex(
                name: "IX_FinEntries_TaxTypeId",
                table: "FinEntries");

            migrationBuilder.DropCheckConstraint(
                name: "CK_FinEntries_Tax",
                table: "FinEntries");

            migrationBuilder.DropIndex(
                name: "IX_FinCategories_DefaultTaxTypeId",
                table: "FinCategories");

            migrationBuilder.DropColumn(
                name: "TaxAmount",
                table: "FinEntries");

            migrationBuilder.DropColumn(
                name: "TaxInclusive",
                table: "FinEntries");

            migrationBuilder.DropColumn(
                name: "TaxRate",
                table: "FinEntries");

            migrationBuilder.DropColumn(
                name: "TaxTypeId",
                table: "FinEntries");

            migrationBuilder.DropColumn(
                name: "DefaultTaxTypeId",
                table: "FinCategories");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Journals_Part",
                table: "Journals",
                sql: "[Part] IN ('Post', 'Reversal')");
        }
    }
}
