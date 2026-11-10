using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HrPayroll.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class CertificateRequests : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CertificateRequests",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    WorkerId = table.Column<int>(type: "int", nullable: false),
                    LetterType = table.Column<string>(type: "nvarchar(15)", maxLength: 15, nullable: false),
                    Reason = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    Status = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    RequestedBy = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    RequestedUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    DetailsJson = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    PreparedBy = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    PreparedUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    ReviewedBy = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    ReviewedUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    ReviewNote = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    IssuedLetterId = table.Column<int>(type: "int", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CertificateRequests", x => x.Id);
                    table.CheckConstraint("CK_CertificateRequests_Status", "[Status] IN ('Requested','PendingApproval','Returned','Approved')");
                    table.CheckConstraint("CK_CertificateRequests_Type", "[LetterType] IN ('Salary','Service','BankTransfer','Noc')");
                    table.ForeignKey(
                        name: "FK_CertificateRequests_IssuedLetters_IssuedLetterId",
                        column: x => x.IssuedLetterId,
                        principalTable: "IssuedLetters",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CertificateRequests_Workers_WorkerId",
                        column: x => x.WorkerId,
                        principalTable: "Workers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CertificateRequests_IssuedLetterId",
                table: "CertificateRequests",
                column: "IssuedLetterId");

            migrationBuilder.CreateIndex(
                name: "IX_CertificateRequests_RequestedBy",
                table: "CertificateRequests",
                column: "RequestedBy");

            migrationBuilder.CreateIndex(
                name: "IX_CertificateRequests_Status",
                table: "CertificateRequests",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_CertificateRequests_WorkerId",
                table: "CertificateRequests",
                column: "WorkerId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CertificateRequests");
        }
    }
}
