using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HrPayroll.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddFinCustodyAccounts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_FinAccounts_Kind",
                table: "FinAccounts");

            migrationBuilder.AddColumn<int>(
                name: "HolderUserId",
                table: "FinAccounts",
                type: "int",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_FinAccounts_HolderUserId",
                table: "FinAccounts",
                column: "HolderUserId",
                unique: true,
                filter: "[HolderUserId] IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "CK_FinAccounts_Kind",
                table: "FinAccounts",
                sql: "[Kind] IN ('Bank', 'Cash', 'Custody')");

            migrationBuilder.AddForeignKey(
                name: "FK_FinAccounts_Users_HolderUserId",
                table: "FinAccounts",
                column: "HolderUserId",
                principalTable: "Users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_FinAccounts_Users_HolderUserId",
                table: "FinAccounts");

            migrationBuilder.DropIndex(
                name: "IX_FinAccounts_HolderUserId",
                table: "FinAccounts");

            migrationBuilder.DropCheckConstraint(
                name: "CK_FinAccounts_Kind",
                table: "FinAccounts");

            migrationBuilder.DropColumn(
                name: "HolderUserId",
                table: "FinAccounts");

            migrationBuilder.AddCheckConstraint(
                name: "CK_FinAccounts_Kind",
                table: "FinAccounts",
                sql: "[Kind] IN ('Bank', 'Cash')");
        }
    }
}
