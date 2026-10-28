using System.Net;
using System.Text.Json;
using HrPayroll.Api.Auth;
using HrPayroll.Api.Data.Entities;
using HrPayroll.Api.Tests.Helpers;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace HrPayroll.Api.Tests.Integration;

/// <summary>W1, W3, W4 and W5: create, update, activate/deactivate and delete, with validation and audit rows.</summary>
public class WorkersWriteEndpointTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private const string DuplicateMessage = "Worker ID already exists.";

    // --- helpers -------------------------------------------------------------------------------------------

    private static object Body(string code, string name = "Mohammed Ali", string designation = "Glass Installer", decimal rate = 12.5m) =>
        new { workerCode = code, fullName = name, designation, hourlyRate = rate };

    /// <summary>
    /// Builds a request body by hand. A null argument leaves the property out entirely; <paramref name="rateLiteral"/> is
    /// written as-is so it can be a bare number, a number in text form or invalid JSON-shaped content.
    /// </summary>
    private static string RawBody(string? code, string? name, string? designation, string? rateLiteral)
    {
        var parts = new List<string>();
        if (code is not null) parts.Add($"\"workerCode\":{JsonSerializer.Serialize(code)}");
        if (name is not null) parts.Add($"\"fullName\":{JsonSerializer.Serialize(name)}");
        if (designation is not null) parts.Add($"\"designation\":{JsonSerializer.Serialize(designation)}");
        if (rateLiteral is not null) parts.Add($"\"hourlyRate\":{rateLiteral}");
        return "{" + string.Join(',', parts) + "}";
    }

    private async Task<(string Username, string Token)> HrAsync() => await TestWorkers.SignInAsync(api, Roles.Manager);

    private static async Task<JsonElement> ErrorsOf(HttpResponseMessage response)
    {
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var body = await TestWorkers.ReadJsonAsync(response);
        return body.GetProperty("errors");
    }

    private static string[] KeysOf(JsonElement errors) => errors.EnumerateObject().Select(p => p.Name).Order().ToArray();

    private async Task<List<AuditLog>> AuditRowsAsync(string action, int workerId)
    {
        await using var db = TestUsers.NewContext(api.ConnectionString);
        return await db.AuditLogs.AsNoTracking()
            .Where(a => a.Action == action && a.EntityType == "Worker" && a.EntityId == workerId.ToString())
            .ToListAsync();
    }

    private async Task<int> AuditCountAsync(int workerId)
    {
        await using var db = TestUsers.NewContext(api.ConnectionString);
        return await db.AuditLogs.CountAsync(a => a.EntityType == "Worker" && a.EntityId == workerId.ToString());
    }

    // --- create --------------------------------------------------------------------------------------------

    [Fact]
    public async Task Create_StoresTheOptionalProfileFields_TrimmedAndReturnsThem()
    {
        var (_, token) = await HrAsync();
        var body = new
        {
            workerCode = TestWorkers.UniqueCode(), fullName = "Tariq", designation = "Glazier", hourlyRate = 12.5m,
            department = "  Glass Installation ", emiratesId = "784-1988-1294857-1", passportNumber = "A0948392",
            phone = "+971 50 432 1098", email = "tariq@example.com", emergencyContact = "Omar: +971 50 111 2233",
            workLocation = "Musaffah", notes = "   ",
        };

        var response = await api.SendAsync(HttpMethod.Post, "/api/workers", body, token);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var json = await TestWorkers.ReadJsonAsync(response);
        Assert.Equal("Glass Installation", json.GetProperty("department").GetString());
        Assert.Equal("784-1988-1294857-1", json.GetProperty("emiratesId").GetString());
        Assert.Equal("A0948392", json.GetProperty("passportNumber").GetString());
        Assert.Equal("tariq@example.com", json.GetProperty("email").GetString());
        Assert.Equal(JsonValueKind.Null, json.GetProperty("notes").ValueKind);
    }

    [Fact]
    public async Task Update_SavesTheOnboardingChecklist_AndLeavesOmittedItemsAlone()
    {
        var (_, token) = await HrAsync();
        var created = await api.SendAsync(HttpMethod.Post, "/api/workers",
            new { workerCode = TestWorkers.UniqueCode(), fullName = "Rashid", designation = "Fabricator", hourlyRate = 10m, contractSigned = true }, token);
        var id = (await TestWorkers.ReadJsonAsync(created)).GetProperty("id").GetInt32();
        var worker = await TestWorkers.FindAsync(api.ConnectionString, id);

        var response = await api.SendAsync(HttpMethod.Put, $"/api/workers/{id}",
            new { workerCode = worker!.WorkerCode, fullName = "Rashid", designation = "Fabricator", hourlyRate = 10m, badgeIssued = true }, token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var json = await TestWorkers.ReadJsonAsync(response);
        Assert.True(json.GetProperty("contractSigned").GetBoolean());
        Assert.True(json.GetProperty("badgeIssued").GetBoolean());
        Assert.False(json.GetProperty("wpsRegistered").GetBoolean());
    }

    [Fact]
    public async Task ProfilePdf_ReturnsAPdfForManagers_AndIsForbiddenToSupervisors_AndNotFoundForUnknownIds()
    {
        var (_, token) = await HrAsync();
        var created = await api.SendAsync(HttpMethod.Post, "/api/workers", Body(TestWorkers.UniqueCode()), token);
        var id = (await TestWorkers.ReadJsonAsync(created)).GetProperty("id").GetInt32();

        var pdf = await api.SendAsync(HttpMethod.Get, $"/api/workers/{id}/profile/pdf", null, token);
        Assert.Equal(HttpStatusCode.OK, pdf.StatusCode);
        Assert.Equal("application/pdf", pdf.Content.Headers.ContentType?.MediaType);
        Assert.EndsWith("_Mohammed_Ali_Information.pdf", pdf.Content.Headers.ContentDisposition?.FileName?.Trim('"'));
        Assert.StartsWith("%PDF", System.Text.Encoding.ASCII.GetString((await pdf.Content.ReadAsByteArrayAsync()).Take(4).ToArray()));

        var (_, supervisorToken) = await TestWorkers.SignInAsync(api, Roles.Supervisor);
        var forbidden = await api.SendAsync(HttpMethod.Get, $"/api/workers/{id}/profile/pdf", null, supervisorToken);
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);

        var missing = await api.SendAsync(HttpMethod.Get, "/api/workers/999999/profile/pdf", null, token);
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
    }

    [Fact]
    public async Task Create_RejectsAnInvalidEmailAndTooLongProfileText()
    {
        var (_, token) = await HrAsync();
        var body = new
        {
            workerCode = TestWorkers.UniqueCode(), fullName = "Tariq", designation = "Glazier", hourlyRate = 12.5m,
            email = "not-an-email", passportNumber = new string('P', 21),
        };

        var response = await api.SendAsync(HttpMethod.Post, "/api/workers", body, token);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var text = await response.Content.ReadAsStringAsync();
        Assert.Contains("Enter a valid email address.", text);
        Assert.Contains("Passport number must be 20 characters or fewer.", text);
    }


    [Fact]
    public async Task Create_ReturnsCreatedWithTheWorkerAndALocation()
    {
        var (_, token) = await HrAsync();
        var code = TestWorkers.UniqueCode();

        var response = await api.SendAsync(HttpMethod.Post, "/api/workers", Body(code, rate: 12.5m), token);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var json = await TestWorkers.ReadJsonAsync(response);
        var id = json.GetProperty("id").GetInt32();
        Assert.True(id > 0);
        Assert.EndsWith($"/api/workers/{id}", response.Headers.Location?.ToString());
        Assert.Equal(
            new[] { "badgeIssued", "contractSigned", "department", "designation", "effectiveOvertimeRate", "email", "emergencyContact", "emiratesId", "fullName", "hasPhoto", "hourlyRate", "id", "isActive", "joinDate", "monthlySalary", "notes", "overtimeRate", "passportNumber", "phone", "safetyGearIssued", "siteOrientationDone", "visaMedicalCleared", "workerCode", "workLocation", "wpsRegistered" },
            json.EnumerateObject().Select(p => p.Name).Order().ToArray());
        Assert.Equal(code, json.GetProperty("workerCode").GetString());
        Assert.Equal("Mohammed Ali", json.GetProperty("fullName").GetString());
        Assert.Equal("Glass Installer", json.GetProperty("designation").GetString());
        Assert.Equal(JsonValueKind.Number, json.GetProperty("hourlyRate").ValueKind);
        Assert.Equal(12.5m, json.GetProperty("hourlyRate").GetDecimal());
        Assert.True(json.GetProperty("isActive").GetBoolean());

        var stored = await TestWorkers.FindAsync(api.ConnectionString, id);
        Assert.NotNull(stored);
        Assert.Equal(code, stored.WorkerCode);
        Assert.Equal(12.5m, stored.HourlyRate);
        Assert.True(stored.IsActive);
        Assert.True(stored.CreatedUtc > DateTime.UtcNow.AddMinutes(-1) && stored.CreatedUtc < DateTime.UtcNow.AddMinutes(1));
        Assert.Equal(stored.CreatedUtc, stored.UpdatedUtc);
    }

    [Fact]
    public async Task Create_TrimsTheNameAndDesignation_AndKeepsTheCodeCase()
    {
        var (_, token) = await HrAsync();
        var code = TestWorkers.UniqueCode().ToLowerInvariant();

        var response = await api.SendAsync(HttpMethod.Post, "/api/workers", Body(code, "  Mohammed Ali \t", "  Glass Installer  "), token);

        var json = await TestWorkers.ReadJsonAsync(response);
        Assert.Equal("Mohammed Ali", json.GetProperty("fullName").GetString());
        Assert.Equal("Glass Installer", json.GetProperty("designation").GetString());
        Assert.Equal(code, json.GetProperty("workerCode").GetString());
    }

    [Fact]
    public async Task Create_AcceptsTheLongestValues()
    {
        var (_, token) = await HrAsync();
        var code = TestWorkers.UniqueCode();
        Assert.Equal(20, code.Length);

        var response = await api.SendJsonAsync(
            HttpMethod.Post, "/api/workers", RawBody(code, new string('n', 120), new string('d', 80), "999.99"), token);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var json = await TestWorkers.ReadJsonAsync(response);
        Assert.Equal(999.99m, json.GetProperty("hourlyRate").GetDecimal());
        Assert.Equal(120, json.GetProperty("fullName").GetString()!.Length);
        Assert.Equal(80, json.GetProperty("designation").GetString()!.Length);
    }

    [Fact]
    public async Task Create_AcceptsTheShortestValues_AndEveryAllowedCodeCharacter()
    {
        var (_, token) = await HrAsync();

        // This class owns its database, so the one-character code is free; the second code uses every allowed kind of character.
        var single = await api.SendJsonAsync(HttpMethod.Post, "/api/workers", RawBody("z", "N", "D", "0.01"), token);
        var mixed = await api.SendJsonAsync(HttpMethod.Post, "/api/workers", RawBody("aZ-09_x", "N", "D", "1"), token);

        Assert.Equal(HttpStatusCode.Created, single.StatusCode);
        Assert.Equal(0.01m, (await TestWorkers.ReadJsonAsync(single)).GetProperty("hourlyRate").GetDecimal());
        Assert.Equal(HttpStatusCode.Created, mixed.StatusCode);
    }

    public static TheoryData<string?, string?, string?, string?, string> InvalidBodies()
    {
        var ok = ("EMP-900", "Name", "Role", "12.5");
        var data = new TheoryData<string?, string?, string?, string?, string>();

        // workerCode
        data.Add(null, ok.Item2, ok.Item3, ok.Item4, "workerCode");
        data.Add("", ok.Item2, ok.Item3, ok.Item4, "workerCode");
        data.Add("   ", ok.Item2, ok.Item3, ok.Item4, "workerCode");
        data.Add(new string('A', 21), ok.Item2, ok.Item3, ok.Item4, "workerCode");
        data.Add("EMP 001", ok.Item2, ok.Item3, ok.Item4, "workerCode");
        data.Add(" EMP-001", ok.Item2, ok.Item3, ok.Item4, "workerCode");
        data.Add("EMP.001", ok.Item2, ok.Item3, ok.Item4, "workerCode");
        data.Add("EMP/001", ok.Item2, ok.Item3, ok.Item4, "workerCode");
        data.Add("EMP#1", ok.Item2, ok.Item3, ok.Item4, "workerCode");
        data.Add("EMP-é01", ok.Item2, ok.Item3, ok.Item4, "workerCode");
        data.Add("EMP-٠٠١", ok.Item2, ok.Item3, ok.Item4, "workerCode"); // Arabic-Indic digits are not [0-9]

        // fullName
        data.Add(ok.Item1, null, ok.Item3, ok.Item4, "fullName");
        data.Add(ok.Item1, "", ok.Item3, ok.Item4, "fullName");
        data.Add(ok.Item1, "   \t ", ok.Item3, ok.Item4, "fullName");
        data.Add(ok.Item1, new string('n', 121), ok.Item3, ok.Item4, "fullName");

        // designation
        data.Add(ok.Item1, ok.Item2, null, ok.Item4, "designation");
        data.Add(ok.Item1, ok.Item2, "", ok.Item4, "designation");
        data.Add(ok.Item1, ok.Item2, "  ", ok.Item4, "designation");
        data.Add(ok.Item1, ok.Item2, new string('d', 81), ok.Item4, "designation");

        // hourlyRate
        data.Add(ok.Item1, ok.Item2, ok.Item3, null, "hourlyRate");
        data.Add(ok.Item1, ok.Item2, ok.Item3, "null", "hourlyRate");
        data.Add(ok.Item1, ok.Item2, ok.Item3, "0", "hourlyRate");
        data.Add(ok.Item1, ok.Item2, ok.Item3, "0.00", "hourlyRate");
        data.Add(ok.Item1, ok.Item2, ok.Item3, "-1", "hourlyRate");
        data.Add(ok.Item1, ok.Item2, ok.Item3, "-0.01", "hourlyRate");
        data.Add(ok.Item1, ok.Item2, ok.Item3, "1000", "hourlyRate");
        data.Add(ok.Item1, ok.Item2, ok.Item3, "1000.00", "hourlyRate");
        data.Add(ok.Item1, ok.Item2, ok.Item3, "999.999", "hourlyRate");
        data.Add(ok.Item1, ok.Item2, ok.Item3, "12.345", "hourlyRate");
        data.Add(ok.Item1, ok.Item2, ok.Item3, "0.001", "hourlyRate");
        data.Add(ok.Item1, ok.Item2, ok.Item3, "99999999999", "hourlyRate");
        return data;
    }

    [Theory]
    [MemberData(nameof(InvalidBodies))]
    public async Task Create_WithAnInvalidField_IsABadRequestNamingOnlyThatField(
        string? code, string? name, string? designation, string? rate, string expectedField)
    {
        var (_, token) = await HrAsync();

        var response = await api.SendJsonAsync(HttpMethod.Post, "/api/workers", RawBody(code, name, designation, rate), token);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal([expectedField], KeysOf(await ErrorsOf(response)));
        await using var db = TestUsers.NewContext(api.ConnectionString);
        Assert.False(await db.Workers.AnyAsync(w => w.WorkerCode == "EMP-900"));
    }

    [Fact]
    public async Task Create_WithEveryFieldInvalid_ReportsAllFourFieldsWithMessages()
    {
        var (_, token) = await HrAsync();

        var response = await api.SendAsync(HttpMethod.Post, "/api/workers", Body("bad code!", "", "", 0m), token);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var errors = await ErrorsOf(response);
        Assert.Equal(["designation", "fullName", "hourlyRate", "workerCode"], KeysOf(errors));
        foreach (var property in errors.EnumerateObject())
        {
            Assert.Equal(JsonValueKind.Array, property.Value.ValueKind);
            Assert.False(string.IsNullOrWhiteSpace(property.Value[0].GetString()));
        }
    }

    [Fact]
    public async Task Create_WithAnEmptyObject_ReportsAllFourFields()
    {
        var (_, token) = await HrAsync();

        var response = await api.SendJsonAsync(HttpMethod.Post, "/api/workers", "{}", token);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(["designation", "fullName", "hourlyRate", "workerCode"], KeysOf(await ErrorsOf(response)));
    }

    [Fact]
    public async Task Create_WithTheRateAsText_IsABadRequest()
    {
        var (_, token) = await HrAsync();

        var response = await api.SendJsonAsync(HttpMethod.Post, "/api/workers", RawBody("EMP-901", "N", "D", "\"abc\""), token);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Create_WithADuplicateCode_IsABadRequestWithAFieldErrorUnderWorkerCode()
    {
        var (_, token) = await HrAsync();
        var existing = await TestWorkers.CreateAsync(api.ConnectionString);

        var response = await api.SendAsync(HttpMethod.Post, "/api/workers", Body(existing.WorkerCode), token);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var errors = await ErrorsOf(response);
        Assert.Equal(["workerCode"], KeysOf(errors));
        Assert.Equal(DuplicateMessage, Assert.Single(errors.GetProperty("workerCode").EnumerateArray()).GetString());
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Create_WithADuplicateCodeInAnotherCase_IsRefused(bool upper)
    {
        var (_, token) = await HrAsync();
        var existing = await TestWorkers.CreateAsync(api.ConnectionString, $"Mix{Guid.NewGuid():N}"[..14]);
        var other = upper ? existing.WorkerCode.ToUpperInvariant() : existing.WorkerCode.ToLowerInvariant();

        var response = await api.SendAsync(HttpMethod.Post, "/api/workers", Body(other), token);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(DuplicateMessage, (await ErrorsOf(response)).GetProperty("workerCode")[0].GetString());
    }

    [Fact]
    public async Task Create_WithADuplicateCode_AddsNoRowAndNoAuditRow()
    {
        var (_, token) = await HrAsync();
        var existing = await TestWorkers.CreateAsync(api.ConnectionString);
        await using var before = TestUsers.NewContext(api.ConnectionString);
        var auditBefore = await before.AuditLogs.CountAsync(a => a.Action == "WorkerCreated");

        await api.SendAsync(HttpMethod.Post, "/api/workers", Body(existing.WorkerCode.ToLowerInvariant()), token);

        await using var db = TestUsers.NewContext(api.ConnectionString);
        Assert.Equal(1, await db.Workers.CountAsync(w => w.WorkerCode == existing.WorkerCode));
        Assert.Equal(auditBefore, await db.AuditLogs.CountAsync(a => a.Action == "WorkerCreated"));
    }

    [Fact]
    public async Task Create_WhenManyRequestsRaceForTheSameCode_ExactlyOneWins_AndTheRestGetTheFieldError()
    {
        var (_, token) = await HrAsync();
        var code = TestWorkers.UniqueCode();

        var responses = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ =>
            api.SendAsync(HttpMethod.Post, "/api/workers", Body(code), token)));

        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.Created);
        var losers = responses.Where(r => r.StatusCode != HttpStatusCode.Created).ToList();
        Assert.Equal(7, losers.Count);
        foreach (var loser in losers)
        {
            Assert.Equal(HttpStatusCode.BadRequest, loser.StatusCode);
            Assert.Equal(DuplicateMessage, (await ErrorsOf(loser)).GetProperty("workerCode")[0].GetString());
        }

        await using var db = TestUsers.NewContext(api.ConnectionString);
        var worker = await db.Workers.SingleAsync(w => w.WorkerCode == code);
        Assert.Equal(1, await db.AuditLogs.CountAsync(a => a.Action == "WorkerCreated" && a.EntityId == worker.Id.ToString()));
    }

    [Fact]
    public async Task Create_ByAdministrator_Works()
    {
        var (_, token) = await TestWorkers.SignInAsync(api, Roles.Administrator);

        var response = await api.SendAsync(HttpMethod.Post, "/api/workers", Body(TestWorkers.UniqueCode()), token);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    [Fact]
    public async Task Create_WritesOneWorkerCreatedAuditRow_WithTheActingUser()
    {
        var (username, token) = await HrAsync();

        var response = await api.SendAsync(HttpMethod.Post, "/api/workers", Body(TestWorkers.UniqueCode()), token);

        var id = (await TestWorkers.ReadJsonAsync(response)).GetProperty("id").GetInt32();
        var rows = await AuditRowsAsync("WorkerCreated", id);
        var row = Assert.Single(rows);
        Assert.Equal(username, row.ActorUsername);
        Assert.Equal("Worker", row.EntityType);
        Assert.Equal(id.ToString(), row.EntityId);
    }

    [Fact]
    public async Task Create_ThenGet_ReturnsTheSameWorker()
    {
        var (_, token) = await HrAsync();
        var created = await api.SendAsync(HttpMethod.Post, "/api/workers", Body(TestWorkers.UniqueCode(), rate: 7.25m), token);
        var location = created.Headers.Location!.ToString();

        var fetched = await api.GetAsync(location, token);

        Assert.Equal(HttpStatusCode.OK, fetched.StatusCode);
        Assert.Equal(7.25m, (await TestWorkers.ReadJsonAsync(fetched)).GetProperty("hourlyRate").GetDecimal());
    }

    // --- update --------------------------------------------------------------------------------------------

    [Fact]
    public async Task Update_ChangesAllFourFields_AndReturnsTheWorker()
    {
        var (_, token) = await HrAsync();
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, fullName: "Old Name", designation: "Old Role", hourlyRate: 10m);
        var newCode = TestWorkers.UniqueCode();

        var response = await api.SendAsync(HttpMethod.Put, $"/api/workers/{worker.Id}",
            Body(newCode, "  New Name ", "New Role", 14.75m), token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var json = await TestWorkers.ReadJsonAsync(response);
        Assert.Equal(worker.Id, json.GetProperty("id").GetInt32());
        Assert.Equal(newCode, json.GetProperty("workerCode").GetString());
        Assert.Equal("New Name", json.GetProperty("fullName").GetString());
        Assert.Equal("New Role", json.GetProperty("designation").GetString());
        Assert.Equal(14.75m, json.GetProperty("hourlyRate").GetDecimal());
        Assert.True(json.GetProperty("isActive").GetBoolean());

        var stored = await TestWorkers.FindAsync(api.ConnectionString, worker.Id);
        Assert.NotNull(stored);
        Assert.Equal(newCode, stored.WorkerCode);
        Assert.Equal("New Name", stored.FullName);
        Assert.Equal(14.75m, stored.HourlyRate);
        Assert.Equal(worker.CreatedUtc, stored.CreatedUtc, TimeSpan.FromMilliseconds(1));
        Assert.True(stored.UpdatedUtc > worker.UpdatedUtc);
    }

    [Fact]
    public async Task Update_DoesNotChangeTheActiveFlag()
    {
        var (_, token) = await HrAsync();
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, isActive: false);

        var response = await api.SendAsync(HttpMethod.Put, $"/api/workers/{worker.Id}", Body(worker.WorkerCode, "Changed"), token);

        Assert.False((await TestWorkers.ReadJsonAsync(response)).GetProperty("isActive").GetBoolean());
    }

    [Fact]
    public async Task Update_WithAnUnknownId_IsNotFound()
    {
        var (_, token) = await HrAsync();

        var response = await api.SendAsync(HttpMethod.Put, "/api/workers/987654", Body("EMP-902"), token);

        await TestWorkers.AssertWorkerNotFoundAsync(response);
    }

    [Theory]
    [InlineData("workerCode")]
    [InlineData("fullName")]
    [InlineData("designation")]
    [InlineData("hourlyRate")]
    public async Task Update_WithAnInvalidField_IsABadRequestNamingThatField_AndChangesNothing(string field)
    {
        var (_, token) = await HrAsync();
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, fullName: "Keep Me", hourlyRate: 11m);
        var json = field switch
        {
            "workerCode" => RawBody("bad code", "X", "Y", "5"),
            "fullName" => RawBody(worker.WorkerCode, " ", "Y", "5"),
            "designation" => RawBody(worker.WorkerCode, "X", new string('d', 81), "5"),
            _ => RawBody(worker.WorkerCode, "X", "Y", "5.001"),
        };

        var response = await api.SendJsonAsync(HttpMethod.Put, $"/api/workers/{worker.Id}", json, token);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal([field], KeysOf(await ErrorsOf(response)));
        var stored = await TestWorkers.FindAsync(api.ConnectionString, worker.Id);
        Assert.Equal("Keep Me", stored!.FullName);
        Assert.Equal(11m, stored.HourlyRate);
        Assert.Equal(0, await AuditCountAsync(worker.Id));
    }

    [Fact]
    public async Task Update_ToTheCodeOfAnotherWorker_IsRefusedWithTheDuplicateMessage_InAnyCase()
    {
        var (_, token) = await HrAsync();
        var first = await TestWorkers.CreateAsync(api.ConnectionString, $"First{Guid.NewGuid():N}"[..14]);
        var second = await TestWorkers.CreateAsync(api.ConnectionString);

        foreach (var code in new[] { first.WorkerCode, first.WorkerCode.ToUpperInvariant(), first.WorkerCode.ToLowerInvariant() })
        {
            var response = await api.SendAsync(HttpMethod.Put, $"/api/workers/{second.Id}", Body(code), token);

            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            var errors = await ErrorsOf(response);
            Assert.Equal(["workerCode"], KeysOf(errors));
            Assert.Equal(DuplicateMessage, errors.GetProperty("workerCode")[0].GetString());
        }

        Assert.Equal(second.WorkerCode, (await TestWorkers.FindAsync(api.ConnectionString, second.Id))!.WorkerCode);
        Assert.Equal(0, await AuditCountAsync(second.Id));
    }

    [Fact]
    public async Task Update_KeepingItsOwnCode_IsNotADuplicate_AndANewCaseIsAChange()
    {
        var (_, token) = await HrAsync();
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, $"mixed{Guid.NewGuid():N}"[..14]);

        var same = await api.SendAsync(HttpMethod.Put, $"/api/workers/{worker.Id}", Body(worker.WorkerCode, "Renamed"), token);
        var recased = await api.SendAsync(HttpMethod.Put, $"/api/workers/{worker.Id}", Body(worker.WorkerCode.ToUpperInvariant(), "Renamed"), token);

        Assert.Equal(HttpStatusCode.OK, same.StatusCode);
        Assert.Equal(HttpStatusCode.OK, recased.StatusCode);
        Assert.Equal(worker.WorkerCode.ToUpperInvariant(), (await TestWorkers.FindAsync(api.ConnectionString, worker.Id))!.WorkerCode);
    }

    [Fact]
    public async Task Update_ThatChangesNothing_IsOk_WritesNoAuditRow_AndLeavesUpdatedUtcAlone()
    {
        var (_, token) = await HrAsync();
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, fullName: "Same Name", designation: "Same Role", hourlyRate: 12.5m);

        // Same values, with extra surrounding whitespace and a different decimal scale: still no change.
        var response = await api.SendJsonAsync(HttpMethod.Put, $"/api/workers/{worker.Id}",
            RawBody(worker.WorkerCode, " Same Name ", "Same Role  ", "12.50"), token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(12.5m, (await TestWorkers.ReadJsonAsync(response)).GetProperty("hourlyRate").GetDecimal());
        Assert.Equal(0, await AuditCountAsync(worker.Id));
        var stored = await TestWorkers.FindAsync(api.ConnectionString, worker.Id);
        Assert.Equal(worker.UpdatedUtc, stored!.UpdatedUtc, TimeSpan.FromMilliseconds(1));
    }

    [Fact]
    public async Task Update_OfTheRateOnly_WritesOneAuditRowWithTheOldAndNewRateAndNothingElse()
    {
        var (username, token) = await HrAsync();
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, hourlyRate: 10m);

        await api.SendAsync(HttpMethod.Put, $"/api/workers/{worker.Id}",
            Body(worker.WorkerCode, worker.FullName, worker.Designation, 12.75m), token);

        var row = Assert.Single(await AuditRowsAsync("WorkerUpdated", worker.Id));
        Assert.Equal(username, row.ActorUsername);
        Assert.Equal("Worker", row.EntityType);
        Assert.Equal(worker.Id.ToString(), row.EntityId);
        var details = JsonDocument.Parse(row.DetailsJson!).RootElement;
        Assert.Equal(["hourlyRate"], details.EnumerateObject().Select(p => p.Name).ToArray());
        var rate = details.GetProperty("hourlyRate");
        Assert.Equal(["new", "old"], rate.EnumerateObject().Select(p => p.Name).Order().ToArray());
        Assert.Equal(10m, rate.GetProperty("old").GetDecimal());
        Assert.Equal(12.75m, rate.GetProperty("new").GetDecimal());
    }

    [Fact]
    public async Task Update_OfSeveralFields_RecordsExactlyTheChangedOnes()
    {
        var (_, token) = await HrAsync();
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, fullName: "Old Name", designation: "Same Role", hourlyRate: 10m);
        var newCode = TestWorkers.UniqueCode();

        await api.SendAsync(HttpMethod.Put, $"/api/workers/{worker.Id}", Body(newCode, "New Name", "Same Role", 10m), token);

        var row = Assert.Single(await AuditRowsAsync("WorkerUpdated", worker.Id));
        var details = JsonDocument.Parse(row.DetailsJson!).RootElement;
        Assert.Equal(["fullName", "workerCode"], details.EnumerateObject().Select(p => p.Name).Order().ToArray());
        Assert.Equal(worker.WorkerCode, details.GetProperty("workerCode").GetProperty("old").GetString());
        Assert.Equal(newCode, details.GetProperty("workerCode").GetProperty("new").GetString());
        Assert.Equal("Old Name", details.GetProperty("fullName").GetProperty("old").GetString());
        Assert.Equal("New Name", details.GetProperty("fullName").GetProperty("new").GetString());
    }

    [Fact]
    public async Task Update_OfTheDesignation_IsRecordedUnderDesignation()
    {
        var (_, token) = await HrAsync();
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, designation: "Helper");

        await api.SendAsync(HttpMethod.Put, $"/api/workers/{worker.Id}", Body(worker.WorkerCode, worker.FullName, "Foreman", worker.HourlyRate), token);

        var row = Assert.Single(await AuditRowsAsync("WorkerUpdated", worker.Id));
        var details = JsonDocument.Parse(row.DetailsJson!).RootElement;
        Assert.Equal(["designation"], details.EnumerateObject().Select(p => p.Name).ToArray());
        Assert.Equal("Helper", details.GetProperty("designation").GetProperty("old").GetString());
        Assert.Equal("Foreman", details.GetProperty("designation").GetProperty("new").GetString());
    }

    // --- deactivate / activate -----------------------------------------------------------------------------

    [Fact]
    public async Task Deactivate_MakesTheWorkerInactive_AndAuditsOnce()
    {
        var (username, token) = await HrAsync();
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);

        var response = await api.SendAsync(HttpMethod.Post, $"/api/workers/{worker.Id}/deactivate", null, token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var json = await TestWorkers.ReadJsonAsync(response);
        Assert.Equal(worker.Id, json.GetProperty("id").GetInt32());
        Assert.False(json.GetProperty("isActive").GetBoolean());
        Assert.False((await TestWorkers.FindAsync(api.ConnectionString, worker.Id))!.IsActive);
        var row = Assert.Single(await AuditRowsAsync("WorkerDeactivated", worker.Id));
        Assert.Equal(username, row.ActorUsername);
        Assert.Equal("Worker", row.EntityType);
    }

    [Fact]
    public async Task Deactivate_IsIdempotent_NoSecondAuditRowAndNoUpdatedUtcChange()
    {
        var (_, token) = await HrAsync();
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        await api.SendAsync(HttpMethod.Post, $"/api/workers/{worker.Id}/deactivate", null, token);
        var afterFirst = await TestWorkers.FindAsync(api.ConnectionString, worker.Id);

        var second = await api.SendAsync(HttpMethod.Post, $"/api/workers/{worker.Id}/deactivate", null, token);

        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        Assert.False((await TestWorkers.ReadJsonAsync(second)).GetProperty("isActive").GetBoolean());
        Assert.Single(await AuditRowsAsync("WorkerDeactivated", worker.Id));
        Assert.Equal(afterFirst!.UpdatedUtc, (await TestWorkers.FindAsync(api.ConnectionString, worker.Id))!.UpdatedUtc);
    }

    [Fact]
    public async Task Activate_MakesTheWorkerActive_AndIsIdempotent()
    {
        var (username, token) = await HrAsync();
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, isActive: false);

        var first = await api.SendAsync(HttpMethod.Post, $"/api/workers/{worker.Id}/activate", null, token);
        var second = await api.SendAsync(HttpMethod.Post, $"/api/workers/{worker.Id}/activate", null, token);

        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        Assert.True((await TestWorkers.ReadJsonAsync(second)).GetProperty("isActive").GetBoolean());
        Assert.True((await TestWorkers.FindAsync(api.ConnectionString, worker.Id))!.IsActive);
        var row = Assert.Single(await AuditRowsAsync("WorkerActivated", worker.Id));
        Assert.Equal(username, row.ActorUsername);
    }

    [Fact]
    public async Task Deactivate_ThenActivate_WritesOneRowEach_AndTheWorkerLeavesAndReturnsToTheDefaultList()
    {
        var (_, token) = await HrAsync();
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);

        await api.SendAsync(HttpMethod.Post, $"/api/workers/{worker.Id}/deactivate", null, token);
        var activeOnly = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/workers", token));
        Assert.DoesNotContain(activeOnly.EnumerateArray(), w => w.GetProperty("id").GetInt32() == worker.Id);

        await api.SendAsync(HttpMethod.Post, $"/api/workers/{worker.Id}/activate", null, token);
        activeOnly = await TestWorkers.ReadJsonAsync(await api.GetAsync("/api/workers", token));
        Assert.Contains(activeOnly.EnumerateArray(), w => w.GetProperty("id").GetInt32() == worker.Id);
        Assert.Single(await AuditRowsAsync("WorkerDeactivated", worker.Id));
        Assert.Single(await AuditRowsAsync("WorkerActivated", worker.Id));
    }

    [Theory]
    [InlineData("deactivate")]
    [InlineData("activate")]
    public async Task StatusChange_WithAnUnknownId_IsNotFound(string action)
    {
        var (_, token) = await HrAsync();

        var response = await api.SendAsync(HttpMethod.Post, $"/api/workers/987654/{action}", null, token);

        await TestWorkers.AssertWorkerNotFoundAsync(response);
    }

    // --- delete --------------------------------------------------------------------------------------------

    [Fact]
    public async Task Delete_RemovesTheWorker_WithNoContent_AndAuditsTheCodeAndName()
    {
        var (username, token) = await HrAsync();
        var worker = await TestWorkers.CreateAsync(api.ConnectionString, fullName: "Gone Soon");

        var response = await api.SendAsync(HttpMethod.Delete, $"/api/workers/{worker.Id}", null, token);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Empty(await response.Content.ReadAsStringAsync());
        Assert.Null(await TestWorkers.FindAsync(api.ConnectionString, worker.Id));
        var row = Assert.Single(await AuditRowsAsync("WorkerDeleted", worker.Id));
        Assert.Equal(username, row.ActorUsername);
        Assert.Equal("Worker", row.EntityType);
        var details = JsonDocument.Parse(row.DetailsJson!).RootElement;
        Assert.Equal(["fullName", "workerCode"], details.EnumerateObject().Select(p => p.Name).Order().ToArray());
        Assert.Equal(worker.WorkerCode, details.GetProperty("workerCode").GetString());
        Assert.Equal("Gone Soon", details.GetProperty("fullName").GetString());
    }

    [Fact]
    public async Task Delete_WithAnUnknownId_IsNotFound_AndSoIsASecondDelete()
    {
        var (_, token) = await HrAsync();
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);

        await TestWorkers.AssertWorkerNotFoundAsync(await api.SendAsync(HttpMethod.Delete, "/api/workers/987654", null, token));
        Assert.Equal(HttpStatusCode.NoContent, (await api.SendAsync(HttpMethod.Delete, $"/api/workers/{worker.Id}", null, token)).StatusCode);
        await TestWorkers.AssertWorkerNotFoundAsync(await api.SendAsync(HttpMethod.Delete, $"/api/workers/{worker.Id}", null, token));
        Assert.Single(await AuditRowsAsync("WorkerDeleted", worker.Id));
    }

    [Fact]
    public async Task Delete_OfAWorkerThatOtherRecordsPointTo_IsAConflict_AndKeepsTheWorkerAndWritesNoAuditRow()
    {
        // Attendance, leave and payroll tables arrive in later slices; until then a throw-away table with the same
        // kind of foreign key (no cascade) proves the foreign-key violation is mapped.
        var (_, token) = await HrAsync();
        var worker = await TestWorkers.CreateAsync(api.ConnectionString);
        var table = $"TestWorkerRefs_{Guid.NewGuid():N}";
        await using (var connection = new SqlConnection(api.ConnectionString))
        {
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText =
                $"CREATE TABLE [{table}] (Id int IDENTITY PRIMARY KEY, WorkerId int NOT NULL CONSTRAINT [FK_{table}] FOREIGN KEY REFERENCES Workers(Id)); " +
                $"INSERT INTO [{table}] (WorkerId) VALUES ({worker.Id});";
            await command.ExecuteNonQueryAsync();
        }

        var response = await api.SendAsync(HttpMethod.Delete, $"/api/workers/{worker.Id}", null, token);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var problem = await TestWorkers.ReadJsonAsync(response);
        Assert.Equal(409, problem.GetProperty("status").GetInt32());
        Assert.Equal(
            "This worker has records and cannot be deleted. Deactivate the worker instead.",
            problem.GetProperty("title").GetString());
        Assert.NotNull(await TestWorkers.FindAsync(api.ConnectionString, worker.Id));
        Assert.Empty(await AuditRowsAsync("WorkerDeleted", worker.Id));

        // The worker can still be deactivated, which is what the message tells people to do.
        var deactivate = await api.SendAsync(HttpMethod.Post, $"/api/workers/{worker.Id}/deactivate", null, token);
        Assert.Equal(HttpStatusCode.OK, deactivate.StatusCode);
    }
}
