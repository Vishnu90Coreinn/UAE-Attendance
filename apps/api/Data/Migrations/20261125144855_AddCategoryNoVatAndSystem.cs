using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HrPayroll.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddCategoryNoVatAndSystem : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsSystem",
                table: "FinCategories",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "NoVat",
                table: "FinCategories",
                type: "bit",
                nullable: false,
                defaultValue: false);

            // Categories the app made for itself before this column existed are marked now, so they leave every entry form.
            migrationBuilder.Sql("UPDATE [FinCategories] SET [IsSystem] = 1, [NoVat] = 1 WHERE [Name] IN (N'Invoice payments', N'Supplier bill payments')");

            migrationBuilder.UpdateData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 1,
                columns: new[] { "IsSystem", "NoVat" },
                values: new object[] { false, false });

            migrationBuilder.UpdateData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 2,
                columns: new[] { "IsSystem", "NoVat" },
                values: new object[] { false, true });

            migrationBuilder.UpdateData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 3,
                columns: new[] { "IsSystem", "NoVat" },
                values: new object[] { false, true });

            migrationBuilder.UpdateData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 4,
                columns: new[] { "IsSystem", "NoVat" },
                values: new object[] { false, true });

            migrationBuilder.UpdateData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 5,
                columns: new[] { "IsSystem", "NoVat" },
                values: new object[] { false, false });

            migrationBuilder.UpdateData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 6,
                columns: new[] { "IsSystem", "NoVat" },
                values: new object[] { false, false });

            migrationBuilder.UpdateData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 7,
                columns: new[] { "IsSystem", "NoVat" },
                values: new object[] { false, false });

            migrationBuilder.UpdateData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 8,
                columns: new[] { "IsSystem", "NoVat" },
                values: new object[] { false, false });

            migrationBuilder.UpdateData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 9,
                columns: new[] { "IsSystem", "NoVat" },
                values: new object[] { false, false });

            migrationBuilder.UpdateData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 10,
                columns: new[] { "IsSystem", "NoVat" },
                values: new object[] { false, false });

            migrationBuilder.UpdateData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 11,
                columns: new[] { "IsSystem", "NoVat" },
                values: new object[] { false, false });

            migrationBuilder.UpdateData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 12,
                columns: new[] { "IsSystem", "NoVat" },
                values: new object[] { false, false });

            migrationBuilder.UpdateData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 13,
                columns: new[] { "IsSystem", "NoVat" },
                values: new object[] { false, false });

            migrationBuilder.UpdateData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 14,
                columns: new[] { "IsSystem", "NoVat" },
                values: new object[] { false, false });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "IsSystem",
                table: "FinCategories");

            migrationBuilder.DropColumn(
                name: "NoVat",
                table: "FinCategories");
        }
    }
}
