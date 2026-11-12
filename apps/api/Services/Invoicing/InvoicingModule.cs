namespace HrPayroll.Api.Services;

/// <summary>Registers the services of the Invoicing module. Kept in its own file so the modules can be built independently.</summary>
public static class InvoicingModule
{
    public static IServiceCollection AddInvoicing(this IServiceCollection services)
    {
        services.AddScoped<DocumentSettingsService>();
        services.AddScoped<InvoiceClientService>();
        services.AddScoped<InvoiceService>();
        services.AddSingleton<InvoicePdf>();
        return services;
    }
}
