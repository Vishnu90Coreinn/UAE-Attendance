using System.Net;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Services.Staff;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>Office employees: category separation, sign-in with a selfie, access rules, leave and retention.</summary>
public class StaffTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private static readonly string Selfie = Convert.ToBase64String([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46]);
    private static readonly object DefaultSettings = new
    {
        shiftStart = "09:00", shiftEnd = "17:00", lateGraceMinutes = 15, earlyGraceMinutes = 15, weeklyOff = 0,
    };

    private async Task<(Worker Employee, string Token, User User)> NewEmployeeAsync(string role = Roles.Employee)
    {
        var user = await TestUsers.CreateAsync(api.ConnectionString, role: role);
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, fullName: "Office Person");
        await using (var db = TestUsers.NewContext(api.ConnectionString))
        {
            var row = await db.Workers.SingleAsync(w => w.Id == worker.Id);
            row.Category = WorkerCategories.Employee;
            row.UserId = user.Id;
            row.JoinDate = new DateOnly(2020, 1, 1);
            await db.SaveChangesAsync();
        }

        return (worker, await TestUsers.LoginAsync(api.Client, user.Username), user);
    }

    private async Task<Worker> NewUnlinkedEmployeeAsync()
    {
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        await using var db = TestUsers.NewContext(api.ConnectionString);
        (await db.Workers.SingleAsync(w => w.Id == worker.Id)).Category = WorkerCategories.Employee;
        await db.SaveChangesAsync();
        return worker;
    }

    private Task<HttpResponseMessage> Punch(string token, object? body = null) =>
        api.SendAsync(HttpMethod.Post, "/api/staff/me/punch", body ?? new { selfieBase64 = Selfie, latitude = 25.2, longitude = 55.27 }, token);

    private static string Today => StaffTime.Today(TimeProvider.System).ToString("yyyy-MM-dd");

    // --- category separation -----------------------------------------------------------------------------------

    [Fact]
    public async Task Employees_AreExcluded_FromTheWorkerAttendanceSheet_AndWorkerLeave()
    {
        var (employee, _, _) = await NewEmployeeAsync();
        var manager = (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;

        var sheet = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/attendance?date=2026-02-10", manager));
        Assert.DoesNotContain(sheet.GetProperty("rows").EnumerateArray(), r => r.GetProperty("workerId").GetInt32() == employee.Id);

        var leave = await api.SendAsync(HttpMethod.Post, "/api/leave",
            new { workerId = employee.Id, leaveType = "Annual Leave", startDate = "2026-03-02", endDate = "2026-03-03" }, manager);
        Assert.Equal(HttpStatusCode.BadRequest, leave.StatusCode);
    }

    [Fact]
    public async Task WorkerList_CanBeFilteredByCategory()
    {
        var (employee, _, _) = await NewEmployeeAsync();
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        var manager = (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;

        var employees = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/workers?category=Employee", manager));
        Assert.Contains(employees.EnumerateArray(), w => w.GetProperty("id").GetInt32() == employee.Id);
        Assert.DoesNotContain(employees.EnumerateArray(), w => w.GetProperty("id").GetInt32() == worker.Id);

        var workers = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/workers?category=Worker", manager));
        Assert.Contains(workers.EnumerateArray(), w => w.GetProperty("id").GetInt32() == worker.Id);
        Assert.DoesNotContain(workers.EnumerateArray(), w => w.GetProperty("id").GetInt32() == employee.Id);

        Assert.Equal(HttpStatusCode.BadRequest, (await api.GetAsync("/api/workers?category=Bogus", manager)).StatusCode);
    }

    [Fact]
    public async Task Manager_CanCreateAnEmployee_WithTheCategory()
    {
        var manager = (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;
        var response = await api.SendAsync(HttpMethod.Post, "/api/workers",
            new { workerCode = TestWorkers.UniqueCode(), fullName = "Accounts Clerk", designation = "Accountant", monthlySalary = 6000, category = "Employee" }, manager);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal("Employee", (await TestWorkers.ReadJsonAsync(response)).GetProperty("category").GetString());
    }

    // --- access ------------------------------------------------------------------------------------------------

    [Theory]
    [InlineData("/api/workers")]
    [InlineData("/api/attendance?date=2026-02-10")]
    [InlineData("/api/leave")]
    [InlineData("/api/staff/dashboard")]
    [InlineData("/api/staff/attendance?date=2026-02-10")]
    public async Task EmployeeRole_CannotUseAnythingBeyondItsOwnPages(string url)
    {
        var (_, token, _) = await NewEmployeeAsync();
        Assert.Equal(HttpStatusCode.Forbidden, (await api.GetAsync(url, token)).StatusCode);
    }

    [Fact]
    public async Task CurrentUser_ReportsTheLinkedEmployee()
    {
        var (employee, token, _) = await NewEmployeeAsync();
        var me = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/auth/me", token));
        Assert.Equal(employee.Id, me.GetProperty("employeeId").GetInt32());
    }

    // --- signing in and out ------------------------------------------------------------------------------------

    [Fact]
    public async Task Punch_RequiresASelfie()
    {
        var (_, token, _) = await NewEmployeeAsync();
        var response = await Punch(token, new { latitude = 25.2, longitude = 55.27 });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Punch_RejectsAFileThatIsNotAJpeg()
    {
        var (_, token, _) = await NewEmployeeAsync();
        var response = await Punch(token, new { selfieBase64 = Convert.ToBase64String([1, 2, 3, 4]) });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Punch_TogglesBetweenSignInAndSignOut_WithTheServerTime()
    {
        var (_, token, _) = await NewEmployeeAsync();
        var first = await TestWorkers.ReadJsonAsync(await Punch(token));
        Assert.Equal("Out", first.GetProperty("nextKind").GetString());
        Assert.Equal("In", first.GetProperty("punches")[0].GetProperty("kind").GetString());
        Assert.True(first.GetProperty("punches")[0].GetProperty("hasSelfie").GetBoolean());

        await Task.Delay(5200); // the same employee cannot punch twice within a few seconds
        var second = await TestWorkers.ReadJsonAsync(await Punch(token));
        Assert.Equal("In", second.GetProperty("nextKind").GetString());
        Assert.Equal("Out", second.GetProperty("punches")[1].GetProperty("kind").GetString());
    }

    [Fact]
    public async Task Punch_TwiceInAMoment_IsRefused()
    {
        var (_, token, _) = await NewEmployeeAsync();
        Assert.Equal(HttpStatusCode.OK, (await Punch(token)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Punch(token)).StatusCode);
    }

    [Fact]
    public async Task Punch_OutsideTheOfficeRadius_IsAcceptedButFlagged()
    {
        var manager = (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;
        var set = await api.SendAsync(HttpMethod.Put, "/api/staff/settings", new
        {
            shiftStart = "09:00", shiftEnd = "17:00", lateGraceMinutes = 15, earlyGraceMinutes = 15, weeklyOff = 0,
            officeLatitude = 25.2048, officeLongitude = 55.2708, officeRadiusMeters = 200,
        }, manager);
        Assert.Equal(HttpStatusCode.OK, set.StatusCode);
        try
        {
            var (_, near, _) = await NewEmployeeAsync();
            var inside = await TestWorkers.ReadJsonAsync(await Punch(near, new { selfieBase64 = Selfie, latitude = 25.2049, longitude = 55.2708 }));
            Assert.False(inside.GetProperty("punches")[0].GetProperty("outsideOffice").GetBoolean());

            var (_, far, _) = await NewEmployeeAsync();
            var outside = await Punch(far, new { selfieBase64 = Selfie, latitude = 25.3, longitude = 55.4 });
            Assert.Equal(HttpStatusCode.OK, outside.StatusCode);
            Assert.True((await TestWorkers.ReadJsonAsync(outside)).GetProperty("punches")[0].GetProperty("outsideOffice").GetBoolean());

            var (_, noGps, _) = await NewEmployeeAsync();
            var missing = await TestWorkers.ReadJsonAsync(await Punch(noGps, new { selfieBase64 = Selfie }));
            Assert.True(missing.GetProperty("punches")[0].GetProperty("outsideOffice").GetBoolean());
        }
        finally
        {
            await api.SendAsync(HttpMethod.Put, "/api/staff/settings", DefaultSettings, manager);
        }
    }

    [Fact]
    public async Task HrUser_LinkedToAnEmployee_CanSignIn_AndKeepsTheHrRole()
    {
        var (employee, token, _) = await NewEmployeeAsync(Roles.HR);
        Assert.Equal(HttpStatusCode.OK, (await Punch(token)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await api.GetAsync("/api/staff/dashboard", token)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await api.GetAsync($"/api/staff/attendance/{employee.Id}?date={Today}", token)).StatusCode);
    }

    [Fact]
    public async Task Selfie_IsVisibleToHr_AndToItsOwner_ButNotToAnotherEmployee()
    {
        var (_, owner, _) = await NewEmployeeAsync();
        var me = await TestWorkers.ReadJsonAsync(await Punch(owner));
        var id = me.GetProperty("punches")[0].GetProperty("id").GetInt64();
        var hr = (await TestWorkers.SignInAsync(api, Roles.HR)).Token;
        var (_, other, _) = await NewEmployeeAsync();

        Assert.Equal(HttpStatusCode.OK, (await api.GetAsync($"/api/staff/punches/{id}/selfie", hr)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await api.GetAsync($"/api/staff/punches/{id}/selfie", owner)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await api.GetAsync($"/api/staff/punches/{id}/selfie", other)).StatusCode);
    }

    // --- correction --------------------------------------------------------------------------------------------

    [Fact]
    public async Task ManualPunch_NeedsAReason_AndIsAudited()
    {
        var (employee, _, _) = await NewEmployeeAsync();
        var hr = (await TestWorkers.SignInAsync(api, Roles.HR)).Token;
        var yesterday = StaffTime.Today(TimeProvider.System).AddDays(-1).ToString("yyyy-MM-dd");

        var noReason = await api.SendAsync(HttpMethod.Post, "/api/staff/punches", new { workerId = employee.Id, date = yesterday, time = "09:00", kind = "In" }, hr);
        Assert.Equal(HttpStatusCode.BadRequest, noReason.StatusCode);

        var ok = await api.SendAsync(HttpMethod.Post, "/api/staff/punches",
            new { workerId = employee.Id, date = yesterday, time = "09:00", kind = "In", reason = "Phone battery died" }, hr);
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);

        await using var db = TestUsers.NewContext(api.ConnectionString);
        Assert.True(await db.AuditLogs.AnyAsync(a => a.Action == "StaffPunchAdded" && a.DetailsJson!.Contains("Phone battery died")));
    }

    [Fact]
    public async Task VoidedPunch_NoLongerCounts()
    {
        var (_, token, _) = await NewEmployeeAsync();
        var me = await TestWorkers.ReadJsonAsync(await Punch(token));
        var id = me.GetProperty("punches")[0].GetProperty("id").GetInt64();
        var manager = (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;

        var voided = await api.SendAsync(HttpMethod.Post, $"/api/staff/punches/{id}/void", new { reason = "Signed in by mistake" }, manager);
        Assert.Equal(HttpStatusCode.OK, voided.StatusCode);
        var after = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/staff/me", token));
        Assert.Equal(0, after.GetProperty("punches").GetArrayLength());
        Assert.Equal("In", after.GetProperty("nextKind").GetString());
    }

    [Fact]
    public async Task Partner_CanReview_ButCannotCorrect()
    {
        var (employee, _, _) = await NewEmployeeAsync();
        var partner = (await TestWorkers.SignInAsync(api, Roles.Viewer)).Token;
        Assert.Equal(HttpStatusCode.OK, (await api.GetAsync("/api/staff/dashboard", partner)).StatusCode);
        var add = await api.SendAsync(HttpMethod.Post, "/api/staff/punches",
            new { workerId = employee.Id, date = "2026-01-05", time = "09:00", kind = "In", reason = "x" }, partner);
        Assert.Equal(HttpStatusCode.Forbidden, add.StatusCode);
    }

    // --- dashboard and reports ---------------------------------------------------------------------------------

    [Fact]
    public async Task Dashboard_CountsSignedInEmployees()
    {
        var (_, token, _) = await NewEmployeeAsync();
        await Punch(token);
        var hr = (await TestWorkers.SignInAsync(api, Roles.HR)).Token;
        var dashboard = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/staff/dashboard", hr));
        Assert.True(dashboard.GetProperty("signedIn").GetInt32() >= 1);
        Assert.True(dashboard.GetProperty("total").GetInt32() >= 1);
    }

    [Theory]
    [InlineData("pdf", "application/pdf")]
    [InlineData("excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")]
    public async Task AttendanceReport_Downloads(string format, string contentType)
    {
        await NewEmployeeAsync();
        var hr = (await TestWorkers.SignInAsync(api, Roles.HR)).Token;
        var today = StaffTime.Today(TimeProvider.System);
        var response = await api.GetAsync($"/api/staff/report/export/{format}?from={today.AddDays(-7):yyyy-MM-dd}&to={today:yyyy-MM-dd}", hr);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(contentType, response.Content.Headers.ContentType?.MediaType);
        Assert.True((await response.Content.ReadAsByteArrayAsync()).Length > 500);
    }

    // --- holidays and settings ---------------------------------------------------------------------------------

    [Fact]
    public async Task Holidays_CanBeAdded_AndRemoved_ByAManager_NotHr()
    {
        var manager = (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;
        var hr = (await TestWorkers.SignInAsync(api, Roles.HR)).Token;
        var date = $"2031-{Random.Shared.Next(1, 12):00}-{Random.Shared.Next(1, 28):00}";

        Assert.Equal(HttpStatusCode.Forbidden, (await api.SendAsync(HttpMethod.Post, "/api/staff/holidays", new { date, name = "Test" }, hr)).StatusCode);
        var added = await api.SendAsync(HttpMethod.Post, "/api/staff/holidays", new { date, name = "Eid" }, manager);
        Assert.Equal(HttpStatusCode.Created, added.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await api.SendAsync(HttpMethod.Post, "/api/staff/holidays", new { date, name = "Again" }, manager)).StatusCode);
        var id = (await TestWorkers.ReadJsonAsync(added)).GetProperty("id").GetInt32();
        Assert.Equal(HttpStatusCode.NoContent, (await api.SendAsync(HttpMethod.Delete, $"/api/staff/holidays/{id}", null, manager)).StatusCode);
    }

    [Fact]
    public async Task Settings_RejectAShiftThatEndsBeforeItStarts()
    {
        var manager = (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;
        var response = await api.SendAsync(HttpMethod.Put, "/api/staff/settings",
            new { shiftStart = "17:00", shiftEnd = "09:00", lateGraceMinutes = 15, earlyGraceMinutes = 15, weeklyOff = 0 }, manager);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // --- logins ------------------------------------------------------------------------------------------------

    [Fact]
    public async Task Manager_CreatesALogin_ForAnEmployee_WhoCanThenSignIn()
    {
        var manager = (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;
        var worker = await NewUnlinkedEmployeeAsync();
        var username = TestUsers.UniqueName("emp");

        var response = await api.SendAsync(HttpMethod.Post, $"/api/staff/employees/{worker.Id}/login", new { username, password = TestUsers.DefaultPassword }, manager);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var token = await TestUsers.LoginAsync(api.Client, username);
        Assert.Equal(HttpStatusCode.OK, (await api.GetAsync("/api/staff/me", token)).StatusCode);
        var again = await api.SendAsync(HttpMethod.Post, $"/api/staff/employees/{worker.Id}/login",
            new { username = TestUsers.UniqueName("x"), password = TestUsers.DefaultPassword }, manager);
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
    }

    [Fact]
    public async Task Hr_CanLinkAnExistingAccount_ButNotCreateOne()
    {
        var hr = (await TestWorkers.SignInAsync(api, Roles.HR)).Token;
        var worker = await NewUnlinkedEmployeeAsync();

        var create = await api.SendAsync(HttpMethod.Post, $"/api/staff/employees/{worker.Id}/login",
            new { username = TestUsers.UniqueName("n"), password = TestUsers.DefaultPassword }, hr);
        Assert.Equal(HttpStatusCode.Forbidden, create.StatusCode);

        var existing = await TestUsers.CreateAsync(api.ConnectionString, role: Roles.Employee);
        var link = await api.SendAsync(HttpMethod.Post, $"/api/staff/employees/{worker.Id}/login", new { linkUserId = existing.Id }, hr);
        Assert.Equal(HttpStatusCode.OK, link.StatusCode);
    }

    // --- leave -------------------------------------------------------------------------------------------------

    private static string NextWorkingDay(int minDaysAhead)
    {
        var d = StaffTime.Today(TimeProvider.System).AddDays(minDaysAhead);
        while (d.DayOfWeek == DayOfWeek.Sunday) d = d.AddDays(1);
        return d.ToString("yyyy-MM-dd");
    }

    [Fact]
    public async Task Leave_FlowsFromRequest_ToManagerApproval_AndUpdatesTheBalance()
    {
        var (_, token, _) = await NewEmployeeAsync();
        var manager = (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;
        var start = NextWorkingDay(1);

        var mine = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/staff/me/leave", token));
        var annual = mine.GetProperty("types").EnumerateArray().First(t => t.GetProperty("name").GetString() == "Annual Leave");

        var created = await api.SendAsync(HttpMethod.Post, "/api/staff/me/leave",
            new { leaveTypeId = annual.GetProperty("id").GetInt32(), startDate = start, endDate = start, reason = "Family trip" }, token);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var id = (await TestWorkers.ReadJsonAsync(created)).GetProperty("id").GetInt32();

        var approved = await api.SendAsync(HttpMethod.Post, $"/api/staff/leave/{id}/approve", new { note = "Enjoy" }, manager);
        Assert.Equal(HttpStatusCode.OK, approved.StatusCode);
        Assert.Equal("Approved", (await TestWorkers.ReadJsonAsync(approved)).GetProperty("status").GetString());

        var after = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/staff/me/leave", token));
        Assert.Equal("Approved", after.GetProperty("requests")[0].GetProperty("status").GetString());
        var balance = after.GetProperty("balances").EnumerateArray().First(b => b.GetProperty("leaveType").GetString() == "Annual Leave");
        var sameYear = int.Parse(start[..4]) == StaffTime.Today(TimeProvider.System).Year;
        Assert.Equal(sameYear ? 29 : 30, balance.GetProperty("remaining").GetInt32());
    }

    [Fact]
    public async Task Leave_RejectNeedsANote_AndAnEmployeeCannotDecide()
    {
        var (_, token, _) = await NewEmployeeAsync();
        var manager = (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;
        var mine = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/staff/me/leave", token));
        var typeId = mine.GetProperty("types")[0].GetProperty("id").GetInt32();
        var day = NextWorkingDay(30);
        var created = await TestWorkers.ReadJsonAsync(await api.SendAsync(HttpMethod.Post, "/api/staff/me/leave",
            new { leaveTypeId = typeId, startDate = day, endDate = day, reason = "Appointment" }, token));
        var id = created.GetProperty("id").GetInt32();

        Assert.Equal(HttpStatusCode.Forbidden, (await api.SendAsync(HttpMethod.Post, $"/api/staff/leave/{id}/approve", new { }, token)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await api.SendAsync(HttpMethod.Post, $"/api/staff/leave/{id}/reject", new { }, manager)).StatusCode);
        var rejected = await api.SendAsync(HttpMethod.Post, $"/api/staff/leave/{id}/reject", new { note = "Busy week" }, manager);
        Assert.Equal(HttpStatusCode.OK, rejected.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await api.SendAsync(HttpMethod.Post, $"/api/staff/leave/{id}/approve", new { }, manager)).StatusCode);
    }

    [Fact]
    public async Task Leave_OverlapAndTooManyDays_AreRefused()
    {
        var (_, token, _) = await NewEmployeeAsync();
        var mine = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/staff/me/leave", token));
        var emergency = mine.GetProperty("types").EnumerateArray().First(t => t.GetProperty("name").GetString() == "Emergency Leave").GetProperty("id").GetInt32();
        var day = NextWorkingDay(60);

        Assert.Equal(HttpStatusCode.Created, (await api.SendAsync(HttpMethod.Post, "/api/staff/me/leave",
            new { leaveTypeId = emergency, startDate = day, endDate = day, reason = "One" }, token)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await api.SendAsync(HttpMethod.Post, "/api/staff/me/leave",
            new { leaveTypeId = emergency, startDate = day, endDate = day, reason = "Same day" }, token)).StatusCode);

        var from = DateOnly.Parse(day).AddDays(20);
        var tooLong = await api.SendAsync(HttpMethod.Post, "/api/staff/me/leave",
            new { leaveTypeId = emergency, startDate = from.ToString("yyyy-MM-dd"), endDate = from.AddDays(20).ToString("yyyy-MM-dd"), reason = "Long" }, token);
        Assert.Equal(HttpStatusCode.BadRequest, tooLong.StatusCode);
    }

    [Fact]
    public async Task Leave_Cancel_OnlyWhilePending_AndOnlyOwn()
    {
        var (_, token, _) = await NewEmployeeAsync();
        var (_, other, _) = await NewEmployeeAsync();
        var mine = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/staff/me/leave", token));
        var day = NextWorkingDay(90);
        var created = await TestWorkers.ReadJsonAsync(await api.SendAsync(HttpMethod.Post, "/api/staff/me/leave",
            new { leaveTypeId = mine.GetProperty("types")[1].GetProperty("id").GetInt32(), startDate = day, endDate = day, reason = "Dentist" }, token));
        var id = created.GetProperty("id").GetInt32();

        Assert.Equal(HttpStatusCode.NotFound, (await api.SendAsync(HttpMethod.Post, $"/api/staff/me/leave/{id}/cancel", null, other)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await api.SendAsync(HttpMethod.Post, $"/api/staff/me/leave/{id}/cancel", null, token)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await api.SendAsync(HttpMethod.Post, $"/api/staff/me/leave/{id}/cancel", null, token)).StatusCode);
    }

    [Fact]
    public async Task Leave_Request_NeedsAReason_AndWorkingDays()
    {
        var (_, token, _) = await NewEmployeeAsync();
        var mine = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/staff/me/leave", token));
        var typeId = mine.GetProperty("types")[0].GetProperty("id").GetInt32();
        var day = NextWorkingDay(200);
        Assert.Equal(HttpStatusCode.BadRequest, (await api.SendAsync(HttpMethod.Post, "/api/staff/me/leave",
            new { leaveTypeId = typeId, startDate = day, endDate = day, reason = "" }, token)).StatusCode);

        var sunday = DateOnly.Parse(day);
        while (sunday.DayOfWeek != DayOfWeek.Sunday) sunday = sunday.AddDays(1);
        var iso = sunday.ToString("yyyy-MM-dd");
        Assert.Equal(HttpStatusCode.BadRequest, (await api.SendAsync(HttpMethod.Post, "/api/staff/me/leave",
            new { leaveTypeId = typeId, startDate = iso, endDate = iso, reason = "Sunday only" }, token)).StatusCode);
    }

    [Fact]
    public async Task LeaveTypes_ManagerCanAdd_HrCanOnlyRead()
    {
        var manager = (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;
        var hr = (await TestWorkers.SignInAsync(api, Roles.HR)).Token;
        Assert.Equal(HttpStatusCode.OK, (await api.GetAsync("/api/staff/leave-types", hr)).StatusCode);
        var body = new { name = TestUsers.UniqueName("Study"), yearlyDays = 5 };
        Assert.Equal(HttpStatusCode.Forbidden, (await api.SendAsync(HttpMethod.Post, "/api/staff/leave-types", body, hr)).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await api.SendAsync(HttpMethod.Post, "/api/staff/leave-types", body, manager)).StatusCode);
    }

    [Theory]
    [InlineData("pdf")]
    [InlineData("excel")]
    public async Task LeaveReport_Downloads(string format)
    {
        var hr = (await TestWorkers.SignInAsync(api, Roles.HR)).Token;
        var response = await api.GetAsync($"/api/staff/leave/export/{format}", hr);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    // --- employee payroll summary ----------------------------------------------------------------------------------

    private static string ThisMonth => StaffTime.Today(TimeProvider.System).ToString("yyyy-MM");

    [Fact]
    public async Task PayrollSummary_ListsEmployeesOnly_WithNoDeductionsByDefault()
    {
        var (employee, _, _) = await NewEmployeeAsync();
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        var hr = (await TestWorkers.SignInAsync(api, Roles.HR)).Token;
        var summary = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/staff/payroll?month={ThisMonth}", hr));
        var rows = summary.GetProperty("rows").EnumerateArray().ToList();
        Assert.Contains(rows, r => r.GetProperty("workerId").GetInt32() == employee.Id);
        Assert.DoesNotContain(rows, r => r.GetProperty("workerId").GetInt32() == worker.Id);
        Assert.Equal(0m, summary.GetProperty("totalDeductions").GetDecimal());
        Assert.All(rows, r => Assert.Equal(r.GetProperty("monthlySalary").GetDecimal(), r.GetProperty("netSalary").GetDecimal()));
    }

    [Fact]
    public async Task PayrollSummary_AppliesTheConfiguredDeductions_AndNeverGoesBelowZero()
    {
        var manager = (await TestWorkers.SignInAsync(api, Roles.Manager)).Token;
        var (employee, _, _) = await NewEmployeeAsync();
        var put = await api.SendAsync(HttpMethod.Put, "/api/staff/settings", new
        {
            shiftStart = "09:00", shiftEnd = "17:00", lateGraceMinutes = 15, earlyGraceMinutes = 15, weeklyOff = 0,
            deductAbsentDays = true, lateDeductionPerMinute = 1.5,
        }, manager);
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        try
        {
            // Join 5 days ago so the month has a known number of absent days.
            var today = StaffTime.Today(TimeProvider.System);
            var join = today.AddDays(-5);
            await using (var db = TestUsers.NewContext(api.ConnectionString))
            {
                var row = await db.Workers.SingleAsync(w => w.Id == employee.Id);
                row.JoinDate = join < new DateOnly(today.Year, today.Month, 1) ? new DateOnly(today.Year, today.Month, 1) : join;
                row.MonthlySalary = 3000m;
                row.HourlyRate = 12.5m;
                await db.SaveChangesAsync();
            }

            var summary = await TestWorkers.ReadJsonAsync(await api.GetAsync($"/api/staff/payroll?month={ThisMonth}", manager));
            var mine = summary.GetProperty("rows").EnumerateArray().First(r => r.GetProperty("workerId").GetInt32() == employee.Id);
            var absent = mine.GetProperty("absentDays").GetInt32();
            Assert.Equal(Math.Round(3000m / 30m * absent, 2), mine.GetProperty("absentDeduction").GetDecimal());
            Assert.Equal(3000m - mine.GetProperty("absentDeduction").GetDecimal() - mine.GetProperty("lateDeduction").GetDecimal(), mine.GetProperty("netSalary").GetDecimal());
            Assert.True(mine.GetProperty("netSalary").GetDecimal() >= 0);
        }
        finally
        {
            await api.SendAsync(HttpMethod.Put, "/api/staff/settings", new
            {
                shiftStart = "09:00", shiftEnd = "17:00", lateGraceMinutes = 15, earlyGraceMinutes = 15, weeklyOff = 0,
                deductAbsentDays = false, lateDeductionPerMinute = 0,
            }, manager);
        }
    }

    [Fact]
    public async Task PayrollSummary_RefusesAFutureMonth_AndABadOne()
    {
        var hr = (await TestWorkers.SignInAsync(api, Roles.HR)).Token;
        Assert.Equal(HttpStatusCode.BadRequest, (await api.GetAsync("/api/staff/payroll?month=2099-01", hr)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await api.GetAsync("/api/staff/payroll?month=nope", hr)).StatusCode);
    }

    [Theory]
    [InlineData("pdf")]
    [InlineData("excel")]
    public async Task PayrollSummary_Downloads(string format)
    {
        await NewEmployeeAsync();
        var hr = (await TestWorkers.SignInAsync(api, Roles.HR)).Token;
        var response = await api.GetAsync($"/api/staff/payroll/export/{format}?month={ThisMonth}", hr);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True((await response.Content.ReadAsByteArrayAsync()).Length > 500);
    }

    [Fact]
    public async Task PayrollSummary_IsNotOpenToAnEmployee()
    {
        var (_, token, _) = await NewEmployeeAsync();
        Assert.Equal(HttpStatusCode.Forbidden, (await api.GetAsync($"/api/staff/payroll?month={ThisMonth}", token)).StatusCode);
    }

    // --- retention ---------------------------------------------------------------------------------------------

    [Fact]
    public async Task Retention_RemovesSelfiesAndLocations_OlderThanAYear()
    {
        var (employee, token, _) = await NewEmployeeAsync();
        await Punch(token);
        await using var db = TestUsers.NewContext(api.ConnectionString);
        var punch = await db.StaffPunches.SingleAsync(p => p.WorkerId == employee.Id);
        punch.TimestampUtc = DateTime.UtcNow.AddDays(-400);
        await db.SaveChangesAsync();

        var removed = await StaffRetentionService.RunOnceAsync(db, TimeProvider.System, CancellationToken.None);
        Assert.True(removed >= 1);
        db.ChangeTracker.Clear();
        Assert.False(await db.StaffPunchSelfies.AnyAsync(s => s.PunchId == punch.Id));
        var kept = await db.StaffPunches.SingleAsync(p => p.Id == punch.Id);
        Assert.Null(kept.Latitude);
    }
}
