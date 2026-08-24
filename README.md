# HRplus Cost Management

This is a static, client-side operational cost dashboard. It has no backend, API, database server, build step, or frontend framework.

## Importing data

Use **Load Operational Costs** for the operational records template and **Load Client Revenue** for the client revenue template. CSV and `.xlsx` files are supported; legacy `.xls` files are not. XLSX files are parsed locally with the vendored SheetJS Community Edition browser build. The importer identifies the required worksheet by its headers and reports invalid rows without replacing the previous valid dataset.

The preferred template downloads are `operational-records-template.xlsx` and `client-records-template.xlsx`. CSV templates remain in the repository as secondary examples.

## Browser persistence

Accepted, normalized records are stored only in this browser profile using IndexedDB. They are not uploaded or synchronized. Clearing browser or site data removes the saved records. Module pricing, the exchange-rate override, report start month, and chart preferences use localStorage because they are small settings.

Persistence is most reliable when the dashboard is opened from a stable HTTPS origin, such as GitHub Pages. The dashboard can also be opened directly from the filesystem, but browser handling of `file:` URLs differs and persistence is not guaranteed. If IndexedDB is unavailable or blocked, imports remain usable for the current session and the dashboard displays a warning that they cannot be restored after refresh.

Use the independent clear controls to remove either dataset, or **Clear All Browser Data** to remove both datasets and this dashboard's saved settings. Data belonging to other applications is not touched.