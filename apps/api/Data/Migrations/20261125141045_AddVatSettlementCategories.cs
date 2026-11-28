using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace HrPayroll.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddVatSettlementCategories : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Ids 13 and 14 belong to the two VAT settlement categories. A database where people have already added categories may be using them:
            // move those rows to new ids (and point everything that refers to them at the new id) before the seed rows go in.
            migrationBuilder.Sql(@"
DECLARE @old int, @new int, @name nvarchar(80);
DECLARE moves CURSOR LOCAL FAST_FORWARD FOR SELECT [Id] FROM [FinCategories] WHERE [Id] IN (13, 14);
OPEN moves;
FETCH NEXT FROM moves INTO @old;
WHILE @@FETCH_STATUS = 0
BEGIN
    SELECT @name = [Name] FROM [FinCategories] WHERE [Id] = @old;
    -- the copy takes a temporary name, because a kind and name pair is unique; it gets its own name back once the old row is gone
    INSERT INTO [FinCategories] ([Kind], [Name], [IsActive], [DefaultTaxTypeId], [LedgerAccountId])
        SELECT [Kind], N'moving-' + CAST(@old AS nvarchar(10)), [IsActive], [DefaultTaxTypeId], [LedgerAccountId] FROM [FinCategories] WHERE [Id] = @old;
    SET @new = SCOPE_IDENTITY();
    UPDATE [FinEntries] SET [CategoryId] = @new WHERE [CategoryId] = @old;
    UPDATE [FinEntryLines] SET [CategoryId] = @new WHERE [CategoryId] = @old;
    UPDATE [FinBillLines] SET [CategoryId] = @new WHERE [CategoryId] = @old;
    UPDATE [FinPayees] SET [DefaultCategoryId] = @new WHERE [DefaultCategoryId] = @old;
    DELETE FROM [FinCategories] WHERE [Id] = @old;
    UPDATE [FinCategories] SET [Name] = @name WHERE [Id] = @new;
    FETCH NEXT FROM moves INTO @old;
END
CLOSE moves;
DEALLOCATE moves;");

            migrationBuilder.InsertData(
                table: "FinCategories",
                columns: new[] { "Id", "DefaultTaxTypeId", "IsActive", "Kind", "LedgerAccountId", "Name" },
                values: new object[,]
                {
                    { 13, null, true, "Expense", null, "VAT paid to tax authority" },
                    { 14, null, true, "Income", null, "VAT refund from tax authority" }
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DeleteData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 13);

            migrationBuilder.DeleteData(
                table: "FinCategories",
                keyColumn: "Id",
                keyValue: 14);
        }
    }
}
