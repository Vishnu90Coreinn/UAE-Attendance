using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HrPayroll.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class ManagerSupervisorRoles : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Users_Role",
                table: "Users");

            // HR Staff become Supervisors. Viewers (read-only) become Supervisors too, but are deactivated so they
            // cannot suddenly enter attendance; an Administrator can reactivate them deliberately.
            migrationBuilder.Sql("UPDATE [Users] SET [Role] = N'Supervisor' WHERE [Role] = N'HR Staff'");
            migrationBuilder.Sql("UPDATE [Users] SET [Role] = N'Supervisor', [IsActive] = 0 WHERE [Role] = N'Viewer'");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Users_Role",
                table: "Users",
                sql: "[Role] IN ('Administrator', 'Manager', 'Supervisor')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Users_Role",
                table: "Users");

            // Lossy by nature: Manager and Supervisor both map back to HR Staff, the closest old role.
            migrationBuilder.Sql("UPDATE [Users] SET [Role] = N'HR Staff' WHERE [Role] IN (N'Manager', N'Supervisor')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Users_Role",
                table: "Users",
                sql: "[Role] IN ('Administrator', 'HR Staff', 'Viewer')");
        }
    }
}
