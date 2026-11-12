namespace HrPayroll.Api.Services;

/// <summary>Registers the services of the Letters module. Kept in its own file so the modules can be built independently.</summary>
public static class LettersModule
{
    public static IServiceCollection AddLetters(this IServiceCollection services)
    {
        services.AddScoped<LetterService>();
        services.AddScoped<CertificateRequestService>();
        services.AddSingleton<LetterPdf>();
        return services;
    }
}
