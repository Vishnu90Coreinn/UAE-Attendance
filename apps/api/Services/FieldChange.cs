using System.Text.Json.Serialization;

namespace HrPayroll.Api.Services;

/// <summary>One changed field in an audit row's details: <c>{"old": ..., "new": ...}</c>. A missing value is null.</summary>
public sealed record FieldChange(
    [property: JsonPropertyName("old")] object? Old,
    [property: JsonPropertyName("new")] object? New);
