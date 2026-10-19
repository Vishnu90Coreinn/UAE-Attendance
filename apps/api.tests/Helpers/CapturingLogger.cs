using Microsoft.Extensions.Logging;

namespace HrPayroll.Api.Tests.Helpers;

/// <summary>Minimal in-memory logger so tests can assert that something was logged.</summary>
public sealed class CapturingLogger<T> : ILogger<T>
{
    public List<(LogLevel Level, Exception? Exception, string Message)> Entries { get; } = [];

    public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

    public bool IsEnabled(LogLevel logLevel) => true;

    public void Log<TState>(
        LogLevel logLevel,
        EventId eventId,
        TState state,
        Exception? exception,
        Func<TState, Exception?, string> formatter)
    {
        Entries.Add((logLevel, exception, formatter(state, exception)));
    }
}
