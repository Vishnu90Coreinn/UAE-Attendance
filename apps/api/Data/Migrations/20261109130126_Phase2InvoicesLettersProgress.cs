using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HrPayroll.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class Phase2InvoicesLettersProgress : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "BankAccountNumber",
                table: "Workers",
                type: "nvarchar(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BankName",
                table: "Workers",
                type: "nvarchar(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "HousingAllowance",
                table: "Workers",
                type: "decimal(9,2)",
                precision: 9,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<string>(
                name: "Iban",
                table: "Workers",
                type: "nvarchar(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Nationality",
                table: "Workers",
                type: "nvarchar(60)",
                maxLength: 60,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "OtherAllowance",
                table: "Workers",
                type: "decimal(9,2)",
                precision: 9,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "TransportAllowance",
                table: "Workers",
                type: "decimal(9,2)",
                precision: 9,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.CreateTable(
                name: "DocumentSettings",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false),
                    CompanyName = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    CompanySubtitle = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    CompanyNameAr = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: false),
                    Mobile = table.Column<string>(type: "nvarchar(30)", maxLength: 30, nullable: false),
                    Address1 = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    Address2 = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    Email = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    Trn = table.Column<string>(type: "nvarchar(30)", maxLength: 30, nullable: false),
                    BankName = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false),
                    AccountName = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    AccountNumber = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    Iban = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    DefaultPaymentTerms = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    DefaultInvoiceNotes = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: false),
                    NextInvoiceNumber = table.Column<int>(type: "int", nullable: false),
                    SignerName = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false),
                    SignerTitle = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false),
                    Logo = table.Column<byte[]>(type: "varbinary(max)", nullable: true),
                    LogoContentType = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: true),
                    Seal = table.Column<byte[]>(type: "varbinary(max)", nullable: true),
                    SealContentType = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: true),
                    Signature = table.Column<byte[]>(type: "varbinary(max)", nullable: true),
                    SignatureContentType = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: true),
                    UpdatedUtc = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DocumentSettings", x => x.Id);
                    table.CheckConstraint("CK_DocumentSettings_NextInvoiceNumber", "[NextInvoiceNumber] >= 1");
                    table.CheckConstraint("CK_DocumentSettings_SingleRow", "[Id] = 1");
                });

            migrationBuilder.CreateTable(
                name: "InvoiceClients",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Name = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false, collation: "SQL_Latin1_General_CP1_CI_AS"),
                    Trn = table.Column<string>(type: "nvarchar(30)", maxLength: 30, nullable: false),
                    Address = table.Column<string>(type: "nvarchar(250)", maxLength: 250, nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InvoiceClients", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "IssuedLetters",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    RefNo = table.Column<string>(type: "nvarchar(30)", maxLength: 30, nullable: false),
                    Year = table.Column<int>(type: "int", nullable: false),
                    Sequence = table.Column<int>(type: "int", nullable: false),
                    LetterType = table.Column<string>(type: "nvarchar(15)", maxLength: 15, nullable: false),
                    WorkerId = table.Column<int>(type: "int", nullable: false),
                    IssueDate = table.Column<DateOnly>(type: "date", nullable: false),
                    AddressedTo = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    ContentJson = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    IssuedBy = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    IssuedUtc = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_IssuedLetters", x => x.Id);
                    table.CheckConstraint("CK_IssuedLetters_Sequence", "[Sequence] >= 1");
                    table.CheckConstraint("CK_IssuedLetters_Type", "[LetterType] IN ('Salary','Service','BankTransfer','Noc')");
                    table.ForeignKey(
                        name: "FK_IssuedLetters_Workers_WorkerId",
                        column: x => x.WorkerId,
                        principalTable: "Workers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "SiteProjects",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Name = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false, collation: "SQL_Latin1_General_CP1_CI_AS"),
                    IsActive = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SiteProjects", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Invoices",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Number = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: true),
                    Status = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: false),
                    ClientId = table.Column<int>(type: "int", nullable: true),
                    ClientName = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    ClientTrn = table.Column<string>(type: "nvarchar(30)", maxLength: 30, nullable: false),
                    ClientAddress = table.Column<string>(type: "nvarchar(250)", maxLength: 250, nullable: false),
                    InvoiceDate = table.Column<DateOnly>(type: "date", nullable: false),
                    DueDate = table.Column<DateOnly>(type: "date", nullable: false),
                    PaymentTerms = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    LpoRef = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false),
                    Project = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    Scope = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    Notes = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: false),
                    SubTotal = table.Column<decimal>(type: "decimal(14,2)", precision: 14, scale: 2, nullable: false),
                    VatTotal = table.Column<decimal>(type: "decimal(14,2)", precision: 14, scale: 2, nullable: false),
                    Total = table.Column<decimal>(type: "decimal(14,2)", precision: 14, scale: 2, nullable: false),
                    CompanyJson = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    CreatedBy = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    CreatedUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    UpdatedUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    IssuedUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    IssuedBy = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    CancelledUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    CancelReason = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Invoices", x => x.Id);
                    table.CheckConstraint("CK_Invoices_NumberWhenIssued", "([Status] = 'Draft' AND [Number] IS NULL) OR ([Status] <> 'Draft' AND [Number] IS NOT NULL)");
                    table.CheckConstraint("CK_Invoices_Status", "[Status] IN ('Draft','Issued','Cancelled')");
                    table.CheckConstraint("CK_Invoices_Totals", "[SubTotal] >= 0 AND [VatTotal] >= 0 AND [Total] = [SubTotal] + [VatTotal]");
                    table.ForeignKey(
                        name: "FK_Invoices_InvoiceClients_ClientId",
                        column: x => x.ClientId,
                        principalTable: "InvoiceClients",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "SiteProgressReports",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ProjectId = table.Column<int>(type: "int", nullable: false),
                    ReportDate = table.Column<DateOnly>(type: "date", nullable: false),
                    UpdatedBy = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    UpdatedUtc = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SiteProgressReports", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SiteProgressReports_SiteProjects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "SiteProjects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "InvoiceLines",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    InvoiceId = table.Column<int>(type: "int", nullable: false),
                    LineNo = table.Column<int>(type: "int", nullable: false),
                    Description = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    Quantity = table.Column<decimal>(type: "decimal(14,2)", precision: 14, scale: 2, nullable: false),
                    Rate = table.Column<decimal>(type: "decimal(14,2)", precision: 14, scale: 2, nullable: false),
                    Taxable = table.Column<decimal>(type: "decimal(14,2)", precision: 14, scale: 2, nullable: false),
                    Vat = table.Column<decimal>(type: "decimal(14,2)", precision: 14, scale: 2, nullable: false),
                    Amount = table.Column<decimal>(type: "decimal(14,2)", precision: 14, scale: 2, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InvoiceLines", x => x.Id);
                    table.CheckConstraint("CK_InvoiceLines_Amounts", "[Quantity] >= 0 AND [Rate] >= 0");
                    table.ForeignKey(
                        name: "FK_InvoiceLines_Invoices_InvoiceId",
                        column: x => x.InvoiceId,
                        principalTable: "Invoices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "InvoicePayments",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    InvoiceId = table.Column<int>(type: "int", nullable: false),
                    PaidDate = table.Column<DateOnly>(type: "date", nullable: false),
                    Amount = table.Column<decimal>(type: "decimal(14,2)", precision: 14, scale: 2, nullable: false),
                    Method = table.Column<string>(type: "nvarchar(30)", maxLength: 30, nullable: false),
                    Reference = table.Column<string>(type: "nvarchar(60)", maxLength: 60, nullable: false),
                    RecordedBy = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    RecordedUtc = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InvoicePayments", x => x.Id);
                    table.CheckConstraint("CK_InvoicePayments_Amount", "[Amount] > 0");
                    table.ForeignKey(
                        name: "FK_InvoicePayments_Invoices_InvoiceId",
                        column: x => x.InvoiceId,
                        principalTable: "Invoices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SiteProgressFloors",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ReportId = table.Column<int>(type: "int", nullable: false),
                    SortOrder = table.Column<int>(type: "int", nullable: false),
                    Floor = table.Column<string>(type: "nvarchar(60)", maxLength: 60, nullable: false, collation: "SQL_Latin1_General_CP1_CI_AS"),
                    Frames = table.Column<int>(type: "int", nullable: false),
                    Glass = table.Column<int>(type: "int", nullable: false),
                    Completion = table.Column<string>(type: "nvarchar(12)", maxLength: 12, nullable: false),
                    WirStatus = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    Remarks = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SiteProgressFloors", x => x.Id);
                    table.CheckConstraint("CK_SiteProgressFloors_Completion", "[Completion] IN ('NotStarted','InProgress','Completed')");
                    table.CheckConstraint("CK_SiteProgressFloors_Counts", "[Frames] >= 0 AND [Glass] >= 0");
                    table.CheckConstraint("CK_SiteProgressFloors_Wir", "[WirStatus] IN ('Pending','Submitted','Approved','ApprovedWithComments','Rejected')");
                    table.ForeignKey(
                        name: "FK_SiteProgressFloors_SiteProgressReports_ReportId",
                        column: x => x.ReportId,
                        principalTable: "SiteProgressReports",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.InsertData(
                table: "DocumentSettings",
                columns: new[] { "Id", "AccountName", "AccountNumber", "Address1", "Address2", "BankName", "CompanyName", "CompanyNameAr", "CompanySubtitle", "DefaultInvoiceNotes", "DefaultPaymentTerms", "Email", "Iban", "Logo", "LogoContentType", "Mobile", "NextInvoiceNumber", "Seal", "SealContentType", "Signature", "SignatureContentType", "SignerName", "SignerTitle", "Trn", "UpdatedUtc" },
                values: new object[] { 1, "", "", "Um Hurair Second", "Dubai Medical, Dubai, U.A.E.", "", "DE AKS BE GLASS & ALUMINIUM", "دي اكس بي للزجاج وأعمال الألمنيوم وصيانتها ذ.م.م ش.ش.و", "INSTALLATION & MAINTENANCE CO. L.L.C S.O.C", "Thank you for your business!", "Due on Receipt", "hr@dxbaluminium.ae", "", null, null, "+971557884821", 185, null, null, null, null, "", "General Manager / Authorized Signatory", "", new DateTime(2026, 11, 9, 0, 0, 0, 0, DateTimeKind.Utc) });

            migrationBuilder.AddCheckConstraint(
                name: "CK_Workers_Allowances",
                table: "Workers",
                sql: "[HousingAllowance] >= 0 AND [TransportAllowance] >= 0 AND [OtherAllowance] >= 0");

            migrationBuilder.CreateIndex(
                name: "IX_InvoiceClients_Name",
                table: "InvoiceClients",
                column: "Name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_InvoiceLines_InvoiceId_LineNo",
                table: "InvoiceLines",
                columns: new[] { "InvoiceId", "LineNo" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_InvoicePayments_InvoiceId",
                table: "InvoicePayments",
                column: "InvoiceId");

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_ClientId",
                table: "Invoices",
                column: "ClientId");

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_InvoiceDate",
                table: "Invoices",
                column: "InvoiceDate");

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_Number",
                table: "Invoices",
                column: "Number",
                unique: true,
                filter: "[Number] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_IssuedLetters_IssueDate",
                table: "IssuedLetters",
                column: "IssueDate");

            migrationBuilder.CreateIndex(
                name: "IX_IssuedLetters_RefNo",
                table: "IssuedLetters",
                column: "RefNo",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_IssuedLetters_WorkerId",
                table: "IssuedLetters",
                column: "WorkerId");

            migrationBuilder.CreateIndex(
                name: "IX_IssuedLetters_Year_Sequence",
                table: "IssuedLetters",
                columns: new[] { "Year", "Sequence" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SiteProgressFloors_ReportId_Floor",
                table: "SiteProgressFloors",
                columns: new[] { "ReportId", "Floor" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SiteProgressReports_ProjectId_ReportDate",
                table: "SiteProgressReports",
                columns: new[] { "ProjectId", "ReportDate" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SiteProjects_Name",
                table: "SiteProjects",
                column: "Name",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DocumentSettings");

            migrationBuilder.DropTable(
                name: "InvoiceLines");

            migrationBuilder.DropTable(
                name: "InvoicePayments");

            migrationBuilder.DropTable(
                name: "IssuedLetters");

            migrationBuilder.DropTable(
                name: "SiteProgressFloors");

            migrationBuilder.DropTable(
                name: "Invoices");

            migrationBuilder.DropTable(
                name: "SiteProgressReports");

            migrationBuilder.DropTable(
                name: "InvoiceClients");

            migrationBuilder.DropTable(
                name: "SiteProjects");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Workers_Allowances",
                table: "Workers");

            migrationBuilder.DropColumn(
                name: "BankAccountNumber",
                table: "Workers");

            migrationBuilder.DropColumn(
                name: "BankName",
                table: "Workers");

            migrationBuilder.DropColumn(
                name: "HousingAllowance",
                table: "Workers");

            migrationBuilder.DropColumn(
                name: "Iban",
                table: "Workers");

            migrationBuilder.DropColumn(
                name: "Nationality",
                table: "Workers");

            migrationBuilder.DropColumn(
                name: "OtherAllowance",
                table: "Workers");

            migrationBuilder.DropColumn(
                name: "TransportAllowance",
                table: "Workers");
        }
    }
}
