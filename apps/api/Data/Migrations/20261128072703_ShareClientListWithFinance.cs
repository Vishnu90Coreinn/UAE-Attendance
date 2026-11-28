using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HrPayroll.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class ShareClientListWithFinance : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "ClientId",
                table: "FinEntries",
                type: "int",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_FinEntries_ClientId",
                table: "FinEntries",
                column: "ClientId");

            migrationBuilder.AddForeignKey(
                name: "FK_FinEntries_InvoiceClients_ClientId",
                table: "FinEntries",
                column: "ClientId",
                principalTable: "InvoiceClients",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            // One customer list from here on. Everyone already named on an invoice, or saved as an income source, joins it
            // (names compare without case, as the list's own unique index does), and what exists is linked. Nothing is deleted:
            // old income payees are only switched off.
            const string ci = "COLLATE SQL_Latin1_General_CP1_CI_AS";
            migrationBuilder.Sql($@"
INSERT INTO InvoiceClients (Name, Trn, Address, IsActive)
SELECT ClientName, ClientTrn, ClientAddress, 1
FROM (SELECT ClientName, ClientTrn, ClientAddress, ROW_NUMBER() OVER (PARTITION BY ClientName {ci} ORDER BY Id DESC) AS Newest
      FROM Invoices WHERE ClientId IS NULL AND ClientName <> '') AS typed
WHERE Newest = 1 AND NOT EXISTS (SELECT 1 FROM InvoiceClients c WHERE c.Name = typed.ClientName {ci});");
            migrationBuilder.Sql($"UPDATE i SET ClientId = c.Id FROM Invoices i JOIN InvoiceClients c ON c.Name = i.ClientName {ci} WHERE i.ClientId IS NULL;");
            migrationBuilder.Sql($@"
INSERT INTO InvoiceClients (Name, Trn, Address, IsActive)
SELECT p.Name, LEFT(ISNULL(p.TaxNumber, ''), 30), '', p.IsActive FROM FinPayees p
WHERE p.Kind = 'Income' AND NOT EXISTS (SELECT 1 FROM InvoiceClients c WHERE c.Name = p.Name {ci});");
            migrationBuilder.Sql($"UPDATE e SET ClientId = c.Id, PayeeId = NULL FROM FinEntries e JOIN FinPayees p ON p.Id = e.PayeeId JOIN InvoiceClients c ON c.Name = p.Name {ci} WHERE p.Kind = 'Income';");
            migrationBuilder.Sql("UPDATE e SET ClientId = i.ClientId FROM FinEntries e JOIN Invoices i ON i.Id = e.InvoiceId WHERE e.Kind = 'Income' AND e.ClientId IS NULL;");
            migrationBuilder.Sql($"UPDATE e SET ClientId = c.Id FROM FinEntries e JOIN InvoiceClients c ON c.Name = e.Party {ci} WHERE e.Kind = 'Income' AND e.ClientId IS NULL;");
            migrationBuilder.Sql("UPDATE FinPayees SET IsActive = 0 WHERE Kind = 'Income';");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_FinEntries_InvoiceClients_ClientId",
                table: "FinEntries");

            migrationBuilder.DropIndex(
                name: "IX_FinEntries_ClientId",
                table: "FinEntries");

            migrationBuilder.DropColumn(
                name: "ClientId",
                table: "FinEntries");
        }
    }
}
