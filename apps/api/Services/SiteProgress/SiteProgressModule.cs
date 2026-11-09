namespace HrPayroll.Api.Services;

/// <summary>Registers the services of the SiteProgress module. Kept in its own file so the modules can be built independently.</summary>
public static class SiteProgressModule
{
    public static IServiceCollection AddSiteProgress(this IServiceCollection services)
    {
        services.AddScoped<SiteProgressService>();
        services.AddSingleton<SiteProgressPdf>();
        return services;
    }
}
