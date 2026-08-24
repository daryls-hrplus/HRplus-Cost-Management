(() => {
  "use strict";
  const COST_TEMPLATE = `Item Name,Record Type,Category,Project,Currency,Payment Amount,Payment Frequency,Monthly Amount,Yearly Amount,Start Date,End Date,Vendor,Notes
Azure Production Hosting,Operational,IT - Software & Cloud,V5,USD,2500,Monthly,2500,30000,2026-01-01,2026-12-31,Microsoft,Monthly hosting requirement
Quarterly Taxes,Taxes & Statutories,V5,TTD,131250,Quarterly,43750,525000,2026-01-01,2026-12-31,,Quarterly payment normalized over three months
Zoho Suite,IT - Software & Cloud,V5,TTD,230860,Annual,19238.3333,230860,2026-01-01,2026-12-31,Zoho,Annual payment
New Firewall,IT - Hardware & Infrastructure,V5,TTD,47530,One-Time,3960.8333,47530,2026-01-01,2026-12-31,,One-time annual budget allocated over twelve months`;
  const CLIENT_TEMPLATE = `Client ID,Client Name,Project,Modules,Employee Count,Currency,Monthly Billing Amount,Start Date,End Date,Status,Notes
CL001,Apex Manufacturing,V5,Workforce|Payroll|Leave,850,TTD,42500,2026-01-01,,Active,Current monthly billing
CL002,Caribbean Retail Group,V5,Workforce|Payroll|Time and Attendance|Leave,1200,USD,9500,2026-01-01,,Active,USD billing
CL003,Island Services Ltd,V6,Workforce|Leave,300,TTD,18000,2026-06-01,,Planned,Planned Version 6 client`;
  function setting(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : JSON.parse(value);
    } catch (_) {
      return fallback;
    }
  }
  const state = {
    costRecords: [],
    clientRecords: [],
    filteredCosts: [],
    filteredClients: [],
    moduleRates: setting("hrplus-module-rates", []),
    months: [],
    costWarnings: [],
    clientWarnings: [],
    costFileName: "",
    clientFileName: "",
    costSheetName: "",
    clientSheetName: "",
    costImportedAt: "",
    clientImportedAt: "",
    fx: Number(localStorage.getItem("opcost-fx")) || 6.78,
    showOperational: setting("hrplus-show-operational", true),
    showDebt: setting("hrplus-show-debt", true),
    showActual: setting("hrplus-show-actual", true),
    showExpected: setting("hrplus-show-expected", true),
    storageAvailable: true,
  };
  const $ = (id) => document.getElementById(id),
    money = new Intl.NumberFormat("en-TT", { maximumFractionDigits: 0 }),
    money2 = new Intl.NumberFormat("en-TT", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  const ms = (d) => new Date(d.getFullYear(), d.getMonth(), 1),
    mk = (d) =>
      d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"),
    ml = (d) =>
      d.toLocaleDateString("en-TT", { month: "short", year: "numeric" }),
    num = (v) => {
      if (v === undefined || String(v).trim() === "") return null;
      const n = Number(String(v).replace(/[$, ]/g, ""));
      return Number.isFinite(n) ? n : null;
    },
    esc = (s) =>
      String(s ?? "").replace(
        /[&<>\'"]/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            "'": "&#39;",
            '"': "&quot;",
          })[c],
      );
  function date(v) {
    if (!v) return null;
    const x = String(v)
      .trim()
      .match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!x) return null;
    const d = new Date(+x[1], +x[2] - 1, +x[3]);
    return d.getFullYear() == +x[1] &&
      d.getMonth() == +x[2] - 1 &&
      d.getDate() == +x[3]
      ? d
      : null;
  }
  function csvParse(t) {
    const out = [];
    let row = [],
      f = "",
      q = false;
    for (let i = 0; i < t.length; i++) {
      const c = t[i],
        n = t[i + 1];
      if (q) {
        if (c === '"' && n === '"') {
          f += '"';
          i++;
        } else if (c === '"') q = false;
        else f += c;
      } else if (c === '"') q = true;
      else if (c === ",") {
        row.push(f);
        f = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && n === "\n") i++;
        row.push(f);
        f = "";
        if (row.some((x) => x.trim())) out.push(row);
        row = [];
      } else f += c;
    }
    row.push(f);
    if (row.some((x) => x.trim())) out.push(row);
    return out;
  }
  function rows(text) {
    const r = csvParse(text);
    return r.length
      ? [
          r[0].map((x, i) =>
            i === 0 ? x.replace(/^\uFEFF/, "").trim() : x.trim(),
          ),
          r.slice(1),
        ]
      : [[], []];
  }
  function notice(list) {
    const n = $("notice");
    if (!n) return;
    if (!list.length) {
      n.className = "notice";
      n.innerHTML = "";
      return;
    }
    n.className = "notice show";
    n.innerHTML =
      "<strong>" +
      list.length +
      " validation or reconciliation warning" +
      (list.length === 1 ? "" : "s") +
      "</strong><ul>" +
      list
        .slice(0, 10)
        .map((x) => "<li>" + esc(x) + "</li>")
        .join("") +
      "</ul>";
  }
  function ttd(r, v) {
    return r.currency === "USD" ? v * state.fx : v;
  }
  function active(r, m) {
    const x = ms(m);
    return x >= ms(r.start) && (!r.end || x <= ms(r.end));
  }
  function clientContributesDuringPeriod(client, months) {
    return (
      client.status !== "Inactive" &&
      months.some((month) => active(client, month))
    );
  }
  function ingest(text, fileName) {
    const [h, rs] = rows(text);
    if (!h.includes("Item Name")) {
      notice(["This is not an operational-cost file. Expected Item Name."]);
      return false;
    }
    const req = [
        "Item Name",
        "Category",
        "Project",
        "Currency",
        "Payment Amount",
        "Payment Frequency",
        "Start Date",
      ],
      missing = req.filter((x) => !h.includes(x));
    if (missing.length) {
      notice(["Missing required columns: " + missing.join(", ")]);
      return false;
    }
    const warnings = [],
      records = [];
    rs.forEach((cells, i) => {
      const raw = {};
      h.forEach((x, j) => (raw[x] = (cells[j] || "").trim()));
      const payment = num(raw["Payment Amount"]),
        monthly = num(raw["Monthly Amount"]),
        yearly = num(raw["Yearly Amount"]),
        start = date(raw["Start Date"]),
        end = raw["End Date"] ? date(raw["End Date"]) : null,
        errors = [];
      if (!raw["Item Name"]) errors.push("missing Item Name");
      if (payment === null || payment < 0)
        errors.push("Payment Amount must be numeric and non-negative");
      if (!["USD", "TTD"].includes((raw.Currency || "").toUpperCase()))
        errors.push("Currency must be USD or TTD");
      if (
        !["Monthly", "Quarterly", "Annual", "One-Time"].includes(
          raw["Payment Frequency"],
        )
      )
        errors.push("invalid Payment Frequency");
      if (!start) errors.push("Start Date must use YYYY-MM-DD");
      if (raw["End Date"] && !end) errors.push("End Date must use YYYY-MM-DD");
      if (start && end && end < start)
        errors.push("End Date precedes Start Date");
      if (errors.length)
        warnings.push("Line " + (i + 2) + ": " + errors.join("; "));
      else
        records.push({
          id: i + 2,
          item: raw["Item Name"],
          category: raw.Category || "Uncategorised",
          project: raw.Project || "Unassigned",
          currency: raw.Currency.toUpperCase(),
          paymentAmount: payment,
          frequency: raw["Payment Frequency"],
          monthlyAmount:
            monthly ??
            (yearly !== null
              ? yearly / 12
              : payment /
                (raw["Payment Frequency"] === "Monthly"
                  ? 1
                  : raw["Payment Frequency"] === "Quarterly"
                    ? 3
                    : 12)),
          yearlyAmount: yearly,
          start,
          end,
          vendor: raw.Vendor || "",
          notes: raw.Notes || "",
        });
    });
    state.costRecords = records;
    state.costWarnings = warnings;
    state.costFileName = fileName;
    render();
    return true;
  }
  function moduleList(v) {
    const seen = new Map(),
      dupes = [];
    String(v || "")
      .split("|")
      .map((x) => x.trim())
      .filter(Boolean)
      .forEach((x) => {
        const k = x.toLowerCase().replace(/\s+/g, " ");
        if (seen.has(k)) dupes.push(x);
        else seen.set(k, x);
      });
    return { modules: [...seen.values()], dupes };
  }
  function rowMap(headers, cells) {
    const raw = {};
    headers.forEach(
      (header, index) =>
        (raw[HRplusImport.normalizeHeader(header)] = cells[index] ?? ""),
    );
    return raw;
  }
  function canonicalHeaders(headers) {
    const seen = new Set(),
      duplicates = [];
    headers.forEach((header) => {
      const key = HRplusImport.normalizeHeader(header);
      if (seen.has(key)) duplicates.push(header);
      else seen.add(key);
    });
    return duplicates;
  }
  function rowDate(value) {
    const d = HRplusImport.normalizeDate(value);
    return (
      d &&
      d.getFullYear() +
        "-" +
        String(d.getMonth() + 1).padStart(2, "0") +
        "-" +
        String(d.getDate()).padStart(2, "0")
    );
  }
  function ingestOperationalRows(headers, dataRows, metadata) {
    const hasRecordType = headers.some((header) => HRplusImport.normalizeHeader(header) === "record type"),
      required = ["Item Name", "Category", "Project", "Currency", "Payment Amount", "Payment Frequency", "Start Date"],
      duplicates = canonicalHeaders(headers),
      keys = headers.map(HRplusImport.normalizeHeader),
      missing = required.filter(
        (x) => !keys.includes(HRplusImport.normalizeHeader(x)),
      );
    if (duplicates.length || missing.length) {
      notice(
        [
          duplicates.length
            ? "Duplicate headers: " + duplicates.join(", ")
            : "",
          missing.length
            ? "Missing required columns: " + missing.join(", ")
            : "",
        ].filter(Boolean),
      );
      return null;
    }
    const warnings = [],
      records = [];
    dataRows.forEach((cells, index) => {
      const raw = rowMap(headers, cells),
        payment = HRplusImport.normalizeNumber(raw["payment amount"]),
        monthly = HRplusImport.normalizeNumber(raw["monthly amount"]),
        yearly = HRplusImport.normalizeNumber(raw["yearly amount"]),
        start = HRplusImport.normalizeDate(raw["start date"]),
        end = raw["end date"]
          ? HRplusImport.normalizeDate(raw["end date"])
          : null,
        errors = [],
        row = index + 2;
      const rawType = HRplusImport.normalizeRecordType(raw["record type"]);
      if (!HRplusImport.normalizeText(raw["item name"]))
        errors.push("missing Item Name");
      if (hasRecordType && HRplusImport.normalizeText(raw["record type"]) && !rawType)
        errors.push("Record Type must be Operational or Debt.");
      if (payment === null || payment < 0)
        errors.push("Payment Amount must be numeric and non-negative");
      if (
        !["USD", "TTD"].includes(HRplusImport.normalizeCurrency(raw.currency))
      )
        errors.push("Currency must be USD or TTD");
      if (
        !["Monthly", "Quarterly", "Annual", "One-Time"].includes(
          HRplusImport.normalizeText(raw["payment frequency"]),
        )
      )
        errors.push("invalid Payment Frequency");
      if (!start) errors.push("Start Date must be a valid date");
      if (raw["end date"] && !end) errors.push("End Date must be a valid date");
      if (start && end && end < start)
        errors.push("End Date precedes Start Date");
      if (errors.length)
        warnings.push(
          (metadata.sheetName || metadata.fileName) +
            ", row " +
            row +
            ": " +
            errors.join("; "),
        );
      else {
        if (!hasRecordType || !HRplusImport.normalizeText(raw["record type"]))
          warnings.push((metadata.sheetName || metadata.fileName) + ", row " + row + ": Record Type defaulted to Operational.");
        records.push({
          id: row,
          item: HRplusImport.normalizeText(raw["item name"]),
          recordType: rawType || "Operational",
          category: HRplusImport.normalizeText(raw.category) || "Uncategorised",
          project: HRplusImport.normalizeText(raw.project) || "Unassigned",
          currency: HRplusImport.normalizeCurrency(raw.currency),
          paymentAmount: payment,
          frequency: HRplusImport.normalizeText(raw["payment frequency"]),
          monthlyAmount:
            monthly ??
            (yearly !== null
              ? yearly / 12
              : payment /
                (raw["payment frequency"] === "Monthly"
                  ? 1
                  : raw["payment frequency"] === "Quarterly"
                    ? 3
                    : 12)),
          yearlyAmount: yearly,
          start,
          end,
          vendor: HRplusImport.normalizeText(raw.vendor),
          notes: HRplusImport.normalizeText(raw.notes),
        });
      }
    });
    if (!hasRecordType) warnings.unshift((metadata.sheetName || metadata.fileName) + ": Record Type column not found; all records defaulted to Operational.");
    return { records, warnings, metadata };
  }
  function ingestClientRows(headers, dataRows, metadata) {
    const required = HRplusImport.required.client,
      duplicates = canonicalHeaders(headers),
      keys = headers.map(HRplusImport.normalizeHeader),
      missing = required.filter(
        (x) => !keys.includes(HRplusImport.normalizeHeader(x)),
      );
    if (duplicates.length || missing.length) {
      notice(
        [
          duplicates.length
            ? "Duplicate headers: " + duplicates.join(", ")
            : "",
          missing.length
            ? "Missing required columns: " + missing.join(", ")
            : "",
        ].filter(Boolean),
      );
      return null;
    }
    const warnings = [],
      records = [];
    dataRows.forEach((cells, index) => {
      const raw = rowMap(headers, cells),
        mods = moduleList(HRplusImport.normalizeText(raw.modules)),
        employees = HRplusImport.normalizeNumber(raw["employee count"]),
        billing = HRplusImport.normalizeNumber(raw["monthly billing amount"]),
        start = HRplusImport.normalizeDate(raw["start date"]),
        end = raw["end date"]
          ? HRplusImport.normalizeDate(raw["end date"])
          : null,
        errors = [],
        row = index + 2;
      if (!HRplusImport.normalizeText(raw["client id"]))
        errors.push("missing Client ID");
      if (!HRplusImport.normalizeText(raw["client name"]))
        errors.push("missing Client Name");
      if (!HRplusImport.normalizeText(raw.project))
        errors.push("missing Project");
      if (!mods.modules.length) errors.push("at least one module is required");
      if (employees === null || employees <= 0)
        errors.push("Employee Count must be numeric and greater than zero");
      if (
        !["USD", "TTD"].includes(HRplusImport.normalizeCurrency(raw.currency))
      )
        errors.push("Currency must be TTD or USD");
      if (billing === null || billing < 0)
        errors.push("Monthly Billing Amount must be numeric and non-negative");
      if (!start) errors.push("Start Date must be a valid date");
      if (raw["end date"] && !end) errors.push("End Date must be a valid date");
      if (start && end && end < start)
        errors.push("End Date precedes Start Date");
      if (
        !["Active", "Inactive", "Planned"].includes(
          HRplusImport.normalizeStatus(raw.status),
        )
      )
        errors.push("Status must be Active, Inactive or Planned");
      if (mods.dupes.length)
        warnings.push(
          (metadata.sheetName || metadata.fileName) +
            ", row " +
            row +
            ": duplicate module(s): " +
            mods.dupes.join(", "),
        );
      if (errors.length)
        warnings.push(
          (metadata.sheetName || metadata.fileName) +
            ", row " +
            row +
            ": " +
            errors.join("; "),
        );
      else
        records.push({
          id: row,
          clientId: HRplusImport.normalizeText(raw["client id"]),
          clientName: HRplusImport.normalizeText(raw["client name"]),
          project: HRplusImport.normalizeText(raw.project),
          modules: mods.modules,
          employeeCount: employees,
          currency: HRplusImport.normalizeCurrency(raw.currency),
          monthlyBillingAmount: billing,
          start,
          end,
          status: HRplusImport.normalizeStatus(raw.status),
          notes: HRplusImport.normalizeText(raw.notes),
        });
    });
    return { records, warnings, metadata };
  }
  function ingestClientRecords(csvText, fileName) {
    const [h, rs] = rows(csvText);
    if (!h.includes("Client ID") || !h.includes("Client Name")) {
      notice([
        "This is not a client-revenue file. Expected Client ID and Client Name.",
      ]);
      return false;
    }
    const req = [
        "Client ID",
        "Client Name",
        "Project",
        "Modules",
        "Employee Count",
        "Currency",
        "Monthly Billing Amount",
        "Start Date",
        "Status",
      ],
      missing = req.filter((x) => !h.includes(x));
    if (missing.length) {
      notice(["Missing required columns: " + missing.join(", ")]);
      return false;
    }
    const warnings = [],
      records = [];
    rs.forEach((cells, i) => {
      const raw = {};
      h.forEach((x, j) => (raw[x] = (cells[j] || "").trim()));
      const mods = moduleList(raw.Modules),
        employees = num(raw["Employee Count"]),
        billing = num(raw["Monthly Billing Amount"]),
        start = date(raw["Start Date"]),
        end = raw["End Date"] ? date(raw["End Date"]) : null,
        errors = [];
      if (!raw["Client ID"]) errors.push("missing Client ID");
      if (!raw["Client Name"]) errors.push("missing Client Name");
      if (!raw.Project) errors.push("missing Project");
      if (!mods.modules.length) errors.push("at least one module is required");
      if (employees === null || employees <= 0)
        errors.push("Employee Count must be numeric and greater than zero");
      if (!["USD", "TTD"].includes(raw.Currency.toUpperCase()))
        errors.push("Currency must be TTD or USD");
      if (billing === null || billing < 0)
        errors.push("Monthly Billing Amount must be numeric and non-negative");
      if (!start) errors.push("Start Date must use YYYY-MM-DD");
      if (raw["End Date"] && !end) errors.push("End Date must use YYYY-MM-DD");
      if (start && end && end < start)
        errors.push("End Date precedes Start Date");
      if (!["Active", "Inactive", "Planned"].includes(raw.Status))
        errors.push("Status must be Active, Inactive or Planned");
      if (mods.dupes.length)
        warnings.push(
          "Line " + (i + 2) + ": duplicate module(s): " + mods.dupes.join(", "),
        );
      if (errors.length)
        warnings.push("Line " + (i + 2) + ": " + errors.join("; "));
      else
        records.push({
          id: i + 2,
          clientId: raw["Client ID"],
          clientName: raw["Client Name"],
          project: raw.Project,
          modules: mods.modules,
          employeeCount: employees,
          currency: raw.Currency.toUpperCase(),
          monthlyBillingAmount: billing,
          start,
          end,
          status: raw.Status,
          notes: raw.Notes || "",
        });
    });
    const by = {};
    records.forEach((r) => (by[r.clientId] ??= []).push(r));
    Object.values(by).forEach((a) =>
      a
        .sort((x, y) => x.start - y.start)
        .forEach((r, i) => {
          if (i && (!a[i - 1].end || r.start <= a[i - 1].end))
            warnings.push(
              "Client " + r.clientId + " has overlapping date ranges.",
            );
        }),
    );
    state.clientRecords = records;
    state.clientWarnings = warnings;
    state.clientFileName = fileName;
    $("clientFileState").textContent =
      fileName +
      " · " +
      records.length +
      " valid record" +
      (records.length === 1 ? "" : "s") +
      " · " +
      warnings.length +
      " warning" +
      (warnings.length === 1 ? "" : "s");
    render();
    return true;
  }
  function serializeOperationalRecords(records) {
    return records.map((r) => ({
      ...r,
      start: rowDate(r.start),
      end: rowDate(r.end),
    }));
  }
  function deserializeOperationalRecords(records) {
    return records.map((r) => ({
      ...r,
      recordType: HRplusImport.normalizeRecordType(r.recordType) || "Operational",
      start: HRplusImport.normalizeDate(r.start),
      end: r.end ? HRplusImport.normalizeDate(r.end) : null,
    }));
  }
  function serializeClientRecords(records) {
    return records.map((r) => ({
      ...r,
      start: rowDate(r.start),
      end: rowDate(r.end),
    }));
  }
  function deserializeClientRecords(records) {
    return records.map((r) => ({
      ...r,
      start: HRplusImport.normalizeDate(r.start),
      end: r.end ? HRplusImport.normalizeDate(r.end) : null,
    }));
  }
  async function persistDataset(id, records, warnings, metadata) {
    if (!state.storageAvailable) return;
    try {
      await HRplusStorage.saveDataset(id, {
        schemaVersion: 2,
        fileName: metadata.fileName,
        fileType: metadata.fileType,
        sheetName: metadata.sheetName,
        importedAt: new Date().toISOString(),
        records:
          id === "operational-costs"
            ? serializeOperationalRecords(records)
            : serializeClientRecords(records),
        warnings,
      });
    } catch (e) {
      state.storageAvailable = false;
      notice([
        "Records imported for this session, but browser storage is unavailable or full. They cannot be restored after refresh.",
      ]);
    }
  }
  function setFileState(id, metadata, count, restored) {
    const el = $(id);
    if (el)
      el.textContent =
        (restored ? "Restored from browser · " : "") +
        metadata.fileName +
        " · " +
        count +
        " records · " +
        new Date(metadata.importedAt || Date.now()).toLocaleString();
  }
  async function commitImport(kind, result) {
    if (!result || !result.records.length) {
      notice([
        "No valid records were produced. The previous dataset was kept.",
      ]);
      return false;
    }
    const id = kind === "cost" ? "operational-costs" : "client-revenue";
    await persistDataset(id, result.records, result.warnings, result.metadata);
    if (kind === "cost") {
      state.costRecords = result.records;
      state.costWarnings = result.warnings;
      state.costFileName = result.metadata.fileName;
      state.costSheetName = result.metadata.sheetName;
      setFileState(
        "costFileState",
        result.metadata,
        result.records.length,
        false,
      );
    } else {
      state.clientRecords = result.records;
      state.clientWarnings = result.warnings;
      state.clientFileName = result.metadata.fileName;
      state.clientSheetName = result.metadata.sheetName;
      setFileState(
        "clientFileState",
        result.metadata,
        result.records.length,
        false,
      );
    }
    render();
    notice([
      "Accepted " +
        result.records.length +
        " record" +
        (result.records.length === 1 ? "" : "s") +
        ", rejected " +
        result.warnings.filter((x) => x.includes("row")).length +
        ", worksheet " +
        (result.metadata.sheetName || "CSV") +
        ", filename " +
        result.metadata.fileName +
        ".",
      ...result.warnings,
    ]);
    return true;
  }
  async function load(file, kind) {
    if (!file) return;
    try {
      const parsed = await HRplusImport.parseImportFile(
        file,
        kind === "cost" ? "operational" : "client",
      );
      await commitImport(
        kind,
        kind === "cost"
          ? ingestOperationalRows(parsed.headers, parsed.rows, parsed.metadata)
          : ingestClientRows(parsed.headers, parsed.rows, parsed.metadata),
      );
    } catch (e) {
      notice([
        e.message || "Unable to import file. The previous dataset was kept.",
      ]);
    }
  }
  function buildMonths() {
    const [y, m] = ($("startMonth").value || mk(new Date()))
      .split("-")
      .map(Number);
    state.months = Array.from(
      { length: 12 },
      (_, i) => new Date(y, m - 1 + i, 1),
    );
  }
  function costSchedule(r) {
    return state.months.map((m) =>
      active(r, m) ? ttd(r, r.monthlyAmount) : 0,
    );
  }
  function clientActualRevenueSchedule(c) {
    return state.months.map((m) =>
      active(c, m) && c.status !== "Inactive"
        ? ttd(c, c.monthlyBillingAmount)
        : 0,
    );
  }
  function pricing(c) {
    const configuredModules = c.modules.filter((module) => findRate(module, c.project));
    const missingModules = c.modules.filter((module) => !findRate(module, c.project));
    const configuredRate = configuredModules.reduce(
      (sum, module) => {
        const rate = findRate(module, c.project);
        return sum + ttd(rate, rate.rate);
      },
      0,
    );
    return {
      status: missingModules.length ? "Pricing Incomplete" : "Pricing Complete",
      completeRate: missingModules.length ? null : configuredRate,
      configuredRate,
      configuredModules,
      missingModules,
    };
  }
  function clientExpectedRevenueSchedule(c) {
    const p = pricing(c);
    return {
      completeExpectedRevenueSchedule: state.months.map((m) =>
        active(c, m) && c.status !== "Inactive" && p.completeRate !== null
          ? c.employeeCount * p.completeRate
          : 0,
      ),
      configuredPricingRevenueSchedule: state.months.map((m) =>
        active(c, m) && c.status !== "Inactive"
          ? c.employeeCount * p.configuredRate
          : 0,
      ),
      ...p,
    };
  }
  function filter() {
    const q = ($("search").value || "").toLowerCase(),
      cat = $("categoryFilter").value,
      pro = $("projectFilter").value,
      cur = $("currencyFilter").value;
    state.filteredCosts = state.costRecords.filter(
      (r) =>
        (!q ||
          (r.item + " " + r.vendor + " " + r.notes)
            .toLowerCase()
            .includes(q)) &&
        (!cat || r.category === cat) &&
        (!pro || r.project === pro) &&
        (!cur || r.currency === cur),
    );
    const cq = ($("clientSearch").value || "").toLowerCase(),
      cp = $("clientProject").value,
      cm = $("clientModule").value,
      cc = $("clientCurrency").value,
      cs = $("clientStatus").value,
      ps = $("pricingStatus").value;
    state.filteredClients = state.clientRecords.filter(
      (c) =>
        (!cq || (c.clientId + " " + c.clientName).toLowerCase().includes(cq)) &&
        (!cp || c.project === cp) &&
        (!cm || c.modules.includes(cm)) &&
        (!cc || c.currency === cc) &&
        (!cs || c.status === cs) &&
        (!ps || pricing(c).status === ps),
    );
  }
  function legacyAggregate() {
    const clients = $("applyClientFilters")?.checked
        ? state.filteredClients
        : state.clientRecords,
      costs = state.months.map((_, i) =>
        state.costRecords.reduce(
          (s, r) =>
            s +
            costSchedule(r)[i],
          0,
        ),
      ),
      actual = state.months.map((_, i) =>
        clients.reduce((s, c) => s + clientActualRevenueSchedule(c)[i], 0),
      ),
      expected = state.months.map((_, i) =>
        clients.reduce((s, c) => {
          const p = clientExpectedRevenueSchedule(c);
          return s + (p.status === "Pricing Complete" ? p.schedule[i] || 0 : 0);
        }, 0),
      ),
      expectedComplete = clients
        .filter((c) => c.status === "Active")
        .every(
          (c) => clientExpectedRevenueSchedule(c).status === "Pricing Complete",
        );
    return { costs, actual, expected, expectedComplete };
  }
  function unusedRender() {
    if (!state.initialized) return;
    buildMonths();
    filter();
    const vals = aggregate(),
      cost = vals.costs.reduce((a, b) => a + b, 0),
      actual = vals.actual.reduce((a, b) => a + b, 0),
      expected = vals.expected.reduce((a, b) => a + b, 0),
      incomplete = state.clientRecords
        .filter((c) => c.status === "Active")
        .flatMap((c) => pricing(c).missing);
    $("total24").textContent = "TTD " + money.format(cost);
    $("avgMonth").textContent = "TTD " + money.format(cost / 24);
    $("actualRevenue").textContent = "TTD " + money.format(actual / 24);
    $("expectedRevenue").textContent = incomplete.length
      ? "Incomplete"
      : "TTD " + money.format(expected / 24);
    $("actualResult").textContent = "TTD " + money.format((actual - cost) / 24);
    $("expectedResult").textContent = incomplete.length
      ? "Incomplete"
      : "TTD " + money.format((expected - cost) / 24);
    $("coverage").textContent = cost ? (actual / cost).toFixed(2) : "0";
    $("pricingWarning").textContent = incomplete.length
      ? "Expected revenue is incomplete: " +
        [...new Set(incomplete)].length +
        " active modules do not have configured pricing."
      : "";
    renderTables();
    renderPricing();
    renderChart();
    notice([...state.costWarnings, ...state.clientWarnings]);
  }
  function renderTables() {
    const body = $("tableBody");
    $("resultCount").textContent = state.filteredCosts.length + " of " + state.costRecords.length + " items";
    body.innerHTML = state.filteredCosts.map((record) => `<tr><td><strong>${esc(record.item)}</strong></td><td><span class="pill">${esc(record.recordType || "Operational")}</span></td><td>${esc(record.category)} / ${esc(record.project)}</td><td>${esc(record.currency)} ${money2.format(record.paymentAmount)} · ${esc(record.frequency)}</td><td>TTD ${money2.format(ttd(record, record.monthlyAmount))}</td><td>${mk(record.start)} – ${record.end ? mk(record.end) : "Ongoing"}</td><td><button class="btn" type="button" data-cost-detail="${record.id}">View</button></td></tr>`).join("");
    $("clientTableBody").innerHTML = state.filteredClients.map((client) => { const pricingResult = clientExpectedRevenueSchedule(client), actual = ttd(client, client.monthlyBillingAmount), actualRate = client.employeeCount > 0 ? actual / client.employeeCount : null, expectedRate = pricingResult.completeRate, gap = expectedRate === null || actualRate === null ? null : expectedRate - actualRate, interpretation = gap === null ? "Incomplete" : gap > 0 ? `${money2.format(gap)} below target` : gap < 0 ? `${money2.format(Math.abs(gap))} above target` : "On target"; return `<tr><td><strong>${esc(client.clientName)}</strong><div class="item-sub">${esc(client.clientId)}</div></td><td>${esc(client.project)} · ${esc(client.status)}</td><td>${client.modules.map((module) => `<span class="pill">${esc(module)}</span>`).join(" ")}</td><td>${client.employeeCount}</td><td>${client.currency} ${money2.format(client.monthlyBillingAmount)}<br>TTD ${money2.format(actual)}</td><td>TTD ${actualRate === null ? "—" : money2.format(actualRate)}</td><td>${expectedRate === null ? "Incomplete" : "TTD " + money2.format(expectedRate)}</td><td>${interpretation}</td><td>${esc(pricingResult.status)}</td><td><button class="btn" type="button" data-client-detail="${client.id}">View</button></td></tr>`; }).join("");
  }
  function unusedTableRenderer() {
    const body = $("tableBody");
    $("resultCount").textContent =
      state.filteredCosts.length + " of " + state.costRecords.length + " items";
    body.innerHTML = state.filteredCosts
      .map(
        (r) =>
          "<tr><td>" +
          esc(r.item) +
          "</td><td>" +
          esc(r.category) +
          " / " +
          esc(r.project) +
          "</td><td>" +
          r.currency +
          "</td><td>" +
          r.frequency +
          "</td><td>" +
          money2.format(r.paymentAmount) +
          "</td><td>TTD " +
          money2.format(ttd(r, r.monthlyAmount)) +
          "</td>" +
          costSchedule(r)
            .map((v) => "<td>" + money.format(v) + "</td>")
            .join("") +
          "</tr>",
      )
      .join("");
    $("clientTableBody").innerHTML = state.filteredClients
      .map((c) => {
        const p = clientExpectedRevenueSchedule(c),
          a = ttd(c, c.monthlyBillingAmount),
          e = p.completeRate === null ? null : c.employeeCount * p.completeRate;
        return (
          "<tr><td>" +
          esc(c.clientId) +
          "</td><td>" +
          esc(c.clientName) +
          "</td><td>" +
          esc(c.project) +
          "</td><td>" +
          esc(c.modules.join(" | ")) +
          "</td><td>" +
          c.employeeCount +
          "</td><td>" +
          c.currency +
          "</td><td>" +
          money2.format(c.monthlyBillingAmount) +
          "</td><td>TTD " +
          money2.format(a) +
          "</td><td>TTD " +
          money2.format(a / c.employeeCount) +
          "</td><td>" +
          (p.completeRate === null ? "Incomplete" : "TTD " + money2.format(p.completeRate)) +
          "</td><td>" +
          (e === null ? "Incomplete" : "TTD " + money2.format(e)) +
          "</td><td>" +
          (e === null ? "Incomplete" : "TTD " + money2.format(e - a)) +
          "</td><td>" +
          p.status +
          (p.missingModules.length ? " · " + esc(p.missingModules.join(", ")) : "") +
          "</td><td>" +
          mk(c.start) +
          "</td><td>" +
          (c.end ? mk(c.end) : "Ongoing") +
          "</td><td>" +
          c.status +
          "</td></tr>"
        );
      })
      .join("");
  }
  function unusedRenderPricing() {
    const mods = [...new Set(state.clientRecords.flatMap((c) => c.modules))];
    $("pricingTableBody").innerHTML = state.moduleRates
      .map(
        (r, i) =>
          "<tr><td>" +
          esc(r.module) +
          "</td><td>" +
          esc(r.project) +
          "</td><td>" +
          r.currency +
          "</td><td>" +
          money2.format(r.rate) +
          "</td><td>TTD " +
          money2.format(ttd(r, r.rate)) +
          '</td><td><button data-edit="' +
          i +
          '">Edit</button> <button data-del="' +
          i +
          '">Delete</button></td></tr>',
      )
      .join("");
    $("unpricedModules").textContent =
      mods.filter((m) => !findRate(m, "All")).join(", ") ||
      "All discovered modules have pricing.";
  }
  function unusedRenderChart() {
    const c = $("trendChart"),
      w = c.parentElement.clientWidth || 600,
      h = 380,
      d = devicePixelRatio || 1;
    c.width = w * d;
    c.height = h * d;
    const x = c.getContext("2d");
    x.scale(d, d);
    const a = aggregate(),
      max =
        Math.max(
          1,
          ...a.costs,
          ...a.actual,
          ...(a.expectedComplete ? a.expected : []),
        ) * 1.12,
      p = { l: 55, r: 15, t: 15, b: 40 },
      cw = w - p.l - p.r,
      ch = h - p.t - p.b;
    x.clearRect(0, 0, w, h);
    x.strokeStyle = "#dce3ed";
    x.fillStyle = "#68758a";
    x.font = "11px system-ui";
    for (let i = 0; i < 6; i++) {
      const y = p.t + (ch * i) / 5;
      x.beginPath();
      x.moveTo(p.l, y);
      x.lineTo(w - p.r, y);
      x.stroke();
      x.fillText(Math.round(max * (1 - i / 5)), 5, y + 4);
    }
    let groups = [
      ...new Set(state.filteredCosts.map((r) => r[$("groupBy").value])),
    ];
    state.months.forEach((m, i) => {
      let y = p.t + ch;
      groups.forEach((g, j) => {
        const v = state.filteredCosts
            .filter((r) => r[$("groupBy").value] === g)
            .reduce(
              (s, r) =>
                s +
                costSchedule(r)[i],
              0,
            ),
          bh = (v / max) * ch;
        x.fillStyle = ["#2671d9", "#d88416", "#7657c9", "#db5f76"][j % 4];
        x.fillRect(p.l + (cw * i) / 24 + 2, y - bh, cw / 24 - 4, bh);
        y -= bh;
      });
      if (i % 2 === 0)
        x.fillText(ml(m), p.l + (cw * (i + 0.5)) / 24 - 16, h - 12);
    });
    function line(v, color, dash) {
      x.strokeStyle = color;
      x.setLineDash(dash);
      x.lineWidth = 2.5;
      x.beginPath();
      v.forEach((n, i) => {
        const px = p.l + (cw * (i + 0.5)) / 24,
          py = p.t + ch - ((n || 0) / max) * ch;
        i ? x.lineTo(px, py) : x.moveTo(px, py);
      });
      x.stroke();
      x.setLineDash([]);
      v.forEach((n, i) => {
        x.fillStyle = color;
        x.beginPath();
        x.arc(
          p.l + (cw * (i + 0.5)) / 24,
          p.t + ch - ((n || 0) / max) * ch,
          3,
          0,
          7,
        );
        x.fill();
      });
    }
    if (state.showActual) line(a.actual, "#159a74", []);
    if (state.showExpected && a.expectedComplete)
      line(a.expected, "#2671d9", [7, 5]);
    $("legend").innerHTML =
      '<span>Operational Cost</span><span style="color:#159a74">Actual Revenue</span><span style="color:#2671d9">Expected Revenue' +
      (a.expectedComplete ? "" : " (incomplete)") +
      "</span>";
  }
  function download(name, text) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    a.download = name;
    a.click();
  }
  function downloadXlsx(name, headers, text, columns) {
    const rows = csvParse(text),
      ws = XLSX.utils.aoa_to_sheet(rows),
      range = XLSX.utils.decode_range(ws["!ref"]);
    ws["!freeze"] = { xSplit: 0, ySplit: 1 };
    ws["!autofilter"] = { ref: ws["!ref"] };
    ws["!cols"] = headers.map((_, i) => ({ wch: columns[i] || 18 }));
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
      if (cell) cell.s = { font: { bold: true } };
    }
    for (let r = 1; r <= range.e.r; r++)
      for (let c = 0; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (
          cell &&
          (/Amount|Count|Yearly/.test(headers[c]) || /Date/.test(headers[c]))
        )
          cell.z = /Date/.test(headers[c]) ? "yyyy-mm-dd" : "#,##0.00";
      }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, name.replace(/\.xlsx$/, ""));
    XLSX.writeFile(wb, name);
  }
  document.querySelectorAll(".tab").forEach((tab) =>
    tab.addEventListener("click", () => {
      document
        .querySelectorAll(".tab")
        .forEach((item) => item.classList.toggle("active", item === tab));
      document
        .querySelectorAll(".pane")
        .forEach((pane) =>
          pane.classList.toggle("active", pane.id === tab.dataset.tab + "Pane"),
        );
      if (tab.dataset.tab === "trend") renderChart();
    }),
  );
  $("fxRate").value = state.fx.toFixed(4);
  $("fxRate").onchange = (e) => {
    if (Number(e.target.value) > 0) {
      state.fx = Number(e.target.value);
      localStorage.setItem("opcost-fx", state.fx);
      render();
    }
  };
  $("startMonth").value = mk(new Date());
  $("startMonth").onchange = render;
  $("costFile").onchange = (e) => load(e.target.files[0]);
  $("clientFile").onchange = (e) => load(e.target.files[0]);
  $("costTemplateBtn").onclick = () =>
    download("operational-records-template.csv", COST_TEMPLATE);
  $("clientTemplateBtn").onclick = () =>
    download("client-records-template.csv", CLIENT_TEMPLATE);
  [
    "search",
    "categoryFilter",
    "projectFilter",
    "currencyFilter",
    "clientSearch",
    "clientProject",
    "clientModule",
    "clientCurrency",
    "clientStatus",
    "pricingStatus",
  ].forEach((id) => ($(id).oninput = $(id).onchange = render));
  $("actualToggle").onclick = (e) => {
    state.showActual = !state.showActual;
    renderChart();
  };
  $("expectedToggle").onclick = (e) => {
    state.showExpected = !state.showExpected;
    renderChart();
  };
  $("applyClientFilters").onchange = renderChart;
  $("addRateBtn").onclick = () => pricingEditor("add");
  $("resetPricingBtn").onclick = () => {
    state.moduleRates = [];
    localStorage.setItem("hrplus-module-rates", "[]");
    render();
  };
  window.HRplus = {
    state,
    ingest,
    ingestClientRecords,
    clientActualRevenueSchedule,
    clientExpectedRevenueSchedule,
    findRate,
  };
  buildMonths();
  render();
  function exportRows(name, records) {
    download(
      name,
      records
        .map((row) =>
          row
            .map((v) => '"' + String(v ?? "").replace(/"/g, '""') + '"')
            .join(","),
        )
        .join("\n"),
    );
  }
  $("clientExportBtn").onclick = () =>
    exportRows("client-revenue.csv", [
      [
        "Client ID",
        "Client Name",
        "Project",
        "Modules",
        "Employee Count",
        "Source Currency",
        "Monthly Billing Amount",
        "Actual Monthly Revenue TTD",
        "Actual Revenue Per Employee TTD",
        "Expected Rate Per Employee TTD",
        "Expected Monthly Revenue TTD",
        "Pricing Variance TTD",
        "Pricing Status",
        "Start Date",
        "End Date",
        "Status",
      ],
      ...state.filteredClients.map((c) => {
        const p = clientExpectedRevenueSchedule(c),
          a = ttd(c, c.monthlyBillingAmount),
          e = p.rate === null ? "" : c.employeeCount * p.rate;
        return [
          c.clientId,
          c.clientName,
          c.project,
          c.modules.join("|"),
          c.employeeCount,
          c.currency,
          c.monthlyBillingAmount,
          a,
          a / c.employeeCount,
          p.rate ?? "",
          e,
          e === "" ? "" : e - a,
          p.status,
          mk(c.start),
          c.end ? mk(c.end) : "",
          c.status,
        ];
      }),
    ]);
  $("exportBtn").onclick = () => {
    const a = aggregate();
    exportRows("financial-trend.csv", [
      [
        "Month",
        "Operational Requirement TTD",
        "Debt Requirement TTD",
        "Overall Requirement TTD",
        "Actual Revenue TTD",
        "Configured Pricing Revenue TTD",
        "Expected Revenue TTD",
        "Pricing Complete",
        "Operating Profit or Loss TTD",
        "Funding Surplus or Shortfall TTD",
        "Overall Coverage Percent",
      ],
      ...state.months.map((m, i) => [
        mk(m),
        a.costs[i],
        a.costs[i],
        a.actual[i],
        a.expectedComplete ? a.expected[i] : "",
        a.actual[i] - a.costs[i],
        a.expectedComplete ? a.expected[i] - a.costs[i] : "",
      ]),
    ]);
  };
  window.HRplus = {
    state,
    ingest,
    ingestClientRecords,
    clientActualRevenueSchedule,
    clientExpectedRevenueSchedule,
    findRate,
  };
  buildMonths();
  render();
  async function restoreCachedDatasets() {
    for (const item of [
      { id: "operational-costs", kind: "cost" },
      { id: "client-revenue", kind: "client" },
    ]) {
      try {
        const saved = await HRplusStorage.getDataset(item.id);
        if (!saved) continue;
        if (
          ![1, 2].includes(saved.schemaVersion) ||
          !Array.isArray(saved.records) ||
          !Array.isArray(saved.warnings)
        )
          throw new Error("Unsupported cached dataset");
        const metadata = {
          fileName: saved.fileName,
          fileType: saved.fileType,
          sheetName: saved.sheetName,
          importedAt: saved.importedAt,
        };
        if (item.kind === "cost") {
          state.costRecords = deserializeOperationalRecords(saved.records);
          state.costWarnings = saved.warnings;
          state.costFileName = saved.fileName;
          state.costSheetName = saved.sheetName;
          state.costImportedAt = saved.importedAt;
          setFileState(
            "costFileState",
            metadata,
            state.costRecords.length,
            true,
          );
        } else {
          state.clientRecords = deserializeClientRecords(saved.records);
          state.clientWarnings = saved.warnings;
          state.clientFileName = saved.fileName;
          state.clientSheetName = saved.sheetName;
          state.clientImportedAt = saved.importedAt;
          setFileState(
            "clientFileState",
            metadata,
            state.clientRecords.length,
            true,
          );
        }
      } catch (e) {
        await HRplusStorage.deleteDataset(item.id);
      }
    }
  }
  async function initializeApplication() {
    state.initialized = false;
    $("actualToggle").setAttribute("aria-pressed", String(state.showActual));
    $("expectedToggle").setAttribute("aria-pressed", String(state.showExpected));
    $("startMonth").value = setting("hrplus-start-month", mk(new Date()));
    try {
      await HRplusStorage.initialize();
      await restoreCachedDatasets();
    } catch (e) {
      state.storageAvailable = false;
      $("storageNote").textContent =
        "Imported data is stored only for this session because IndexedDB is unavailable. It cannot be restored after refresh.";
      notice([e.message]);
    }
    state.initialized = true;
    buildMonths();
    render();
  }
  $("startMonth").onchange = (e) => {
    localStorage.setItem("hrplus-start-month", JSON.stringify(e.target.value));
    render();
  };
  $("actualToggle").onclick = () => {
    state.showActual = !state.showActual;
    localStorage.setItem(
      "hrplus-show-actual",
      JSON.stringify(state.showActual),
    );
    renderChart();
  };
  $("operationalToggle").onclick = () => { state.showOperational = !state.showOperational; localStorage.setItem("hrplus-show-operational", JSON.stringify(state.showOperational)); renderChart(); };
  $("debtToggle").onclick = () => { state.showDebt = !state.showDebt; localStorage.setItem("hrplus-show-debt", JSON.stringify(state.showDebt)); renderChart(); };
  $("expectedToggle").onclick = () => {
    state.showExpected = !state.showExpected;
    localStorage.setItem(
      "hrplus-show-expected",
      JSON.stringify(state.showExpected),
    );
    renderChart();
  };
  $("costFile").onchange = (e) => load(e.target.files[0], "cost");
  $("clientFile").onchange = (e) => load(e.target.files[0], "client");
  $("clearAllBtn").onclick = async () => {
    if (!confirm("Clear all HRplus browser data?")) return;
    await HRplusStorage.clearAllDatasets();
    [
      "hrplus-module-rates",
      "opcost-fx",
      "hrplus-start-month",
      "hrplus-show-actual",
      "hrplus-show-expected",
    ].forEach((k) => localStorage.removeItem(k));
    location.reload();
  };
  $("costTemplateBtn").onclick = () =>
    downloadXlsx(
      "operational-records-template.xlsx",
      HRplusImport.required.operational,
      COST_TEMPLATE,
      [24, 28, 12, 12, 16, 18, 16, 16, 14, 14, 20, 32],
    );
  $("clientTemplateBtn").onclick = () =>
    downloadXlsx(
      "client-records-template.xlsx",
      HRplusImport.required.client,
      CLIENT_TEMPLATE,
      [14, 28, 12, 38, 16, 12, 22, 14, 14, 12, 32],
    );
  window.HRplus = {
    ...window.HRplus,
    state,
    ingestOperationalRows,
    ingestClientRows,
    serializeOperationalRecords,
    deserializeOperationalRecords,
    serializeClientRecords,
    deserializeClientRecords,
    clientActualRevenueSchedule,
    clientExpectedRevenueSchedule,
    findRate,
  };
  initializeApplication();
  function normalizeModuleKey(value) {
    return String(value ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  }
  function normalizeProjectKey(value) {
    return normalizeModuleKey(value);
  }
  function getDiscoveredModules(clientRecords) {
    const found = new Map();
    (clientRecords || [])
      .flatMap((client) =>
        Array.isArray(client.modules) ? client.modules : [],
      )
      .forEach((value) => {
        const display = String(value ?? "")
            .trim()
            .replace(/\s+/g, " "),
          key = normalizeModuleKey(display);
        if (key && !found.has(key)) found.set(key, display);
      });
    return [...found.values()].sort((a, b) => a.localeCompare(b));
  }
  function buildModulePricingRows(clientRecords, configuredRates) {
    const discovered = getDiscoveredModules(clientRecords),
      rows = [],
      seen = new Set();
    const add = (module, project, rate, discoveredFlag) => {
      const key =
        normalizeModuleKey(module) + "|" + normalizeProjectKey(project);
      if (seen.has(key)) return;
      seen.add(key);
      rows.push({
        module: String(module).trim().replace(/\s+/g, " "),
        project: String(project).trim().replace(/\s+/g, " ") || "All",
        currency: rate?.currency || "TTD",
        rate: Number.isFinite(rate?.rate) ? rate.rate : null,
        configured: Number.isFinite(rate?.rate),
        discovered: !!discoveredFlag,
        index: rate ? configuredRates.indexOf(rate) : -1,
      });
    };
    discovered.forEach((module) => {
      const all = (configuredRates || []).find(
        (rate) =>
          normalizeModuleKey(rate.module) === normalizeModuleKey(module) &&
          normalizeProjectKey(rate.project) === "all",
      );
      add(module, "All", all, true);
      (configuredRates || [])
        .filter(
          (rate) =>
            normalizeModuleKey(rate.module) === normalizeModuleKey(module) &&
            normalizeProjectKey(rate.project) !== "all",
        )
        .forEach((rate) => add(rate.module, rate.project, rate, false));
    });
    (configuredRates || []).forEach((rate) =>
      add(rate.module, rate.project, rate, false),
    );
    return rows.sort(
      (a, b) =>
        a.module.localeCompare(b.module) || a.project.localeCompare(b.project),
    );
  }
  function findRate(module, project) {
    const moduleKey = normalizeModuleKey(module),
      projectKey = normalizeProjectKey(project);
    return (
      state.moduleRates.find(
        (rate) =>
          normalizeModuleKey(rate.module) === moduleKey &&
          normalizeProjectKey(rate.project) === projectKey,
      ) ||
      state.moduleRates.find(
        (rate) =>
          normalizeModuleKey(rate.module) === moduleKey &&
          normalizeProjectKey(rate.project) === "all",
      ) ||
      null
    );
  }
  function pricingProjects() {
    const values = new Map([["all", "All"]]);
    state.clientRecords.forEach((client) => {
      const key = normalizeProjectKey(client.project);
      if (key && !values.has(key))
        values.set(key, String(client.project).trim().replace(/\s+/g, " "));
    });
    state.moduleRates.forEach((rate) => {
      const key = normalizeProjectKey(rate.project);
      if (key && !values.has(key))
        values.set(key, String(rate.project).trim().replace(/\s+/g, " "));
    });
    return [...values.values()];
  }
  function renderPricing() {
    const rows = buildModulePricingRows(state.clientRecords, state.moduleRates),
      missing = rows.filter((row) => !row.configured),
      summary = $("pricingSummary");
    summary.textContent =
      getDiscoveredModules(state.clientRecords).length +
      " modules discovered · " +
      rows.filter((row) => row.configured).length +
      " configured · " +
      missing.length +
      " not configured";
    summary.className =
      "pricing-summary " + (missing.length ? "incomplete" : "complete");
    $("unpricedModules").textContent = missing.length
      ? "Not configured: " + missing.map((row) => row.module).join(", ")
      : "All discovered modules have pricing.";
    $("pricingTableBody").innerHTML = rows.map((row) => {
      const projects = pricingProjects();
      const options = projects.map((project) => `<option ${normalizeProjectKey(project) === normalizeProjectKey(row.project) ? "selected" : ""}>${esc(project)}</option>`).join("");
      return `<tr><td><input class="pricing-inline-input" data-module value="${esc(row.module)}" aria-label="Module" ${row.discovered ? "readonly" : ""}></td><td><select class="pricing-inline-input" data-project aria-label="Project">${options}</select></td><td><select class="pricing-inline-input" data-currency aria-label="Currency"><option ${row.currency === "TTD" ? "selected" : ""}>TTD</option><option ${row.currency === "USD" ? "selected" : ""}>USD</option></select></td><td><input class="pricing-inline-input" data-rate type="number" min="0" step="0.01" value="${row.configured ? row.rate : ""}" aria-label="Target rate"></td><td>${row.configured ? "TTD " + money2.format(ttd({ currency: row.currency }, row.rate)) : "—"}</td><td class="${row.configured ? "" : "saved-only"}">${row.configured ? "Configured" : "Not Configured"}</td><td><button class="btn primary" data-inline-save="${row.index < 0 ? "" : row.index}">Save</button>${row.configured ? ` <button class="btn" data-del="${row.index}">Delete</button>` : ""}</td></tr>`;
    }).join("");
  }
  function calculateFinancialSeries(costRecords, clientRecords, months) {
    const reportingClients = (clientRecords || []).filter((client) =>
        clientContributesDuringPeriod(client, months),
      ),
      operationalRequirement = months.map((_, i) =>
        (costRecords || []).reduce(
          (sum, record) => sum + (record.recordType === "Debt" ? 0 : costSchedule(record)[i]),
          0,
        ),
      ),
      debtRequirement = months.map((_, i) =>
        (costRecords || []).reduce(
          (sum, record) => sum + (record.recordType === "Debt" ? costSchedule(record)[i] : 0),
          0,
        ),
      ),
      actual = months.map((_, i) =>
        (clientRecords || []).reduce(
          (sum, client) => sum + clientActualRevenueSchedule(client)[i],
          0,
        ),
      ),
      completeExpectedRevenue = months.map((_, i) =>
        reportingClients.reduce(
          (sum, client) =>
            sum + clientExpectedRevenueSchedule(client).completeExpectedRevenueSchedule[i],
          0,
        ),
      ),
      configuredPricingRevenue = months.map((_, i) =>
        reportingClients.reduce(
          (sum, client) =>
            sum + clientExpectedRevenueSchedule(client).configuredPricingRevenueSchedule[i],
          0,
        ),
      ),
      missingModules = [
        ...new Set(
          reportingClients.flatMap((client) => pricing(client).missingModules),
        ),
      ],
      configuredModuleCount = getDiscoveredModules(clientRecords).filter((module) =>
        reportingClients.every((client) => findRate(module, client.project)),
      ).length,
      requiredModuleCount = getDiscoveredModules(reportingClients).length,
      expectedComplete = reportingClients.every(
        (client) => pricing(client).missingModules.length === 0,
      ),
      groups = [...new Set((costRecords || []).map((record) => record[$("groupBy")?.value || "project"]))],
      groupValues = Object.fromEntries(groups.map((group) => [group, months.map((_, i) => (costRecords || []).filter((record) => record[$("groupBy")?.value || "project"] === group).reduce((sum, record) => sum + costSchedule(record)[i], 0))]));
    return {
      operationalRequirement,
      debtRequirement,
      overallRequirement: operationalRequirement.map((value, index) => value + debtRequirement[index]),
      actualRevenue: actual,
      completeExpectedRevenue,
      configuredPricingRevenue,
      expectedComplete,
      configuredModuleCount,
      requiredModuleCount,
      missingModules,
      groups,
      groupValues,
      months,
    };
  }
  function renderChart() {
    if (window.HRplusFinancialChart) HRplusFinancialChart.render();
  }
  function renderSummaryCards(series) {
    const reportingMonthCount = state.months.length;
    const reportingStart = state.months[0];
    const reportingEnd = state.months[state.months.length - 1];
    const totalOperational = series.operationalRequirement.reduce((sum, value) => sum + value, 0);
    const totalDebt = series.debtRequirement.reduce((sum, value) => sum + value, 0);
    const totalActual = series.actualRevenue.reduce((sum, value) => sum + value, 0);
    const averageCost = totalOperational / reportingMonthCount;
    const averageDebt = totalDebt / reportingMonthCount;
    const averageOverall = averageCost + averageDebt;
    const averageActual = totalActual / reportingMonthCount;
    const operatingResult = averageActual - averageCost;
    const fundingResult = averageActual - (averageCost + totalDebt / reportingMonthCount);
    const period = `${ml(reportingStart)} – ${ml(reportingEnd)} · ${reportingMonthCount} months`;
    $("avgMonth").textContent = `TTD ${money2.format(averageCost)}`;
    $("avgMonthLabel").textContent = "Average Monthly Operational Cost";
    $("avgMonthNote").textContent = period;
    $("averageDebt").textContent = `TTD ${money2.format(averageDebt)}`;
    $("averageDebtNote").textContent = period;
    $("averageOverall").textContent = `TTD ${money2.format(averageOverall)}`;
    $("averageOverallNote").textContent = period;
    $("actualRevenue").textContent = `TTD ${money2.format(averageActual)}`;
    $("actualRevenueLabel").textContent = "Average Monthly Actual Revenue";
    $("actualRevenueNote").textContent = `${period} · Coverage ${averageCost ? ((averageActual / averageCost) * 100).toFixed(1) : "0.0"}%`;
    $("operatingResult").textContent = operatingResult > 0 ? `TTD ${money2.format(operatingResult)}` : operatingResult < 0 ? `TTD ${money2.format(Math.abs(operatingResult))}` : "Break-even";
    $("operatingResultLabel").textContent = operatingResult > 0 ? "Average Monthly Operating Profit" : operatingResult < 0 ? "Average Monthly Operating Loss" : "Average Monthly Operating Result";
    $("operatingResultNote").textContent = period;
    $("fundingResult").textContent = fundingResult > 0 ? `TTD ${money2.format(fundingResult)}` : fundingResult < 0 ? `TTD ${money2.format(Math.abs(fundingResult))}` : "Break-even";
    $("fundingResultLabel").textContent = fundingResult > 0 ? "Average Monthly Funding Surplus" : fundingResult < 0 ? "Average Monthly Funding Shortfall" : "Average Monthly Funding Result";
    $("fundingResultNote").textContent = `${period} · Coverage ${averageOverall ? (averageActual / averageOverall * 100).toFixed(1) : "0.0"}%`;
    $("pricingWarning").textContent = series.expectedComplete
      ? ""
      : `Expected revenue is incomplete. Missing: ${series.missingModules.join(", ") || "none"}.`;
  }
  function render() {
    if (!state.initialized) return;
    buildMonths();
    filter();
    const series = calculateFinancialSeries(
      state.filteredCosts,
      $("applyClientFilters").checked ? state.filteredClients : state.clientRecords,
      state.months,
    );
    renderSummaryCards(series);
    renderTables();
    renderPricing();
    renderChart();
    notice([...state.costWarnings, ...state.clientWarnings]);
  }
  function pricingEditor(mode, module, index) {
    const form = $("pricingForm");
    form.classList.add("open");
    form.dataset.index = index ?? "";
    $("rateModule").value = module || "";
    $("rateModule").readOnly = !!module;
    $("rateProject").innerHTML = pricingProjects()
      .map((project) => "<option>" + esc(project) + "</option>")
      .join("");
    if (index !== undefined) {
      const rate = state.moduleRates[index];
      $("rateModule").value = rate.module;
      $("rateProject").value = rate.project;
      $("rateCurrency").value = rate.currency;
      $("rateValue").value = rate.rate;
    } else {
      $("rateProject").value = "All";
      $("rateCurrency").value = "TTD";
      $("rateValue").value = "";
    }
    $("pricingFormError").textContent = "";
    $("rateModule").focus();
  }
  function savePricing(event) {
    event.preventDefault();
    const module = $("rateModule").value.trim().replace(/\s+/g, " "),
      project = $("rateProject").value.trim().replace(/\s+/g, " "),
      currency = $("rateCurrency").value,
      rate = num($("rateValue").value),
      index = $("pricingForm").dataset.index,
      duplicate = state.moduleRates.some(
        (saved, i) =>
          String(i) !== String(index) &&
          normalizeModuleKey(saved.module) === normalizeModuleKey(module) &&
          normalizeProjectKey(saved.project) === normalizeProjectKey(project),
      );
    let error = "";
    if (!module) error = "Module is required.";
    else if (!project) error = "Project is required.";
    else if (!["TTD", "USD"].includes(currency))
      error = "Currency must be TTD or USD.";
    else if (rate === null || rate < 0)
      error = "Rate must be numeric and zero or greater.";
    else if (duplicate)
      error = "A rate already exists for this Module and Project.";
    if (error) {
      $("pricingFormError").textContent = error;
      return;
    }
    const value = { module, project, currency, rate };
    if (index === "") state.moduleRates.push(value);
    else state.moduleRates[Number(index)] = value;
    localStorage.setItem(
      "hrplus-module-rates",
      JSON.stringify(state.moduleRates),
    );
    $("pricingForm").classList.remove("open");
    render();
  }
  function saveInlinePricing(button) {
    const row = button.closest("tr");
    pricingEditor("edit", row.querySelector("[data-module]").value, button.dataset.inlineSave === "" ? undefined : Number(button.dataset.inlineSave));
    $("rateModule").value = row.querySelector("[data-module]").value;
    $("rateProject").value = row.querySelector("[data-project]").value;
    $("rateCurrency").value = row.querySelector("[data-currency]").value;
    $("rateValue").value = row.querySelector("[data-rate]").value;
    $("pricingForm").dataset.index = button.dataset.inlineSave;
    savePricing({ preventDefault: () => {} });
  }
  function setupEnhancedFeatures() {
    const form = $("pricingForm");
    $("addRateBtn").onclick = () => pricingEditor("add");
    $("cancelRateBtn").onclick = () => form.classList.remove("open");
    form.onsubmit = savePricing;
    $("pricingTableBody").onclick = (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      if (button.dataset.inlineSave !== undefined) {
        saveInlinePricing(button);
        return;
      }
      if (button.dataset.configure)
        pricingEditor("add", button.dataset.configure);
      if (button.dataset.edit) pricingEditor("edit", "", button.dataset.edit);
      if (button.dataset.del && confirm("Delete this saved module rate?")) {
        state.moduleRates.splice(Number(button.dataset.del), 1);
        localStorage.setItem(
          "hrplus-module-rates",
          JSON.stringify(state.moduleRates),
        );
        render();
      }
    };
    $("resetPricingBtn").onclick = () => {
      if (confirm("Reset all saved module rates?")) {
        state.moduleRates = [];
        localStorage.setItem("hrplus-module-rates", "[]");
        render();
      }
    };
    $("showValueLabels").onchange = (event) => {
      localStorage.setItem(
        "hrplus-show-value-labels",
        JSON.stringify(event.target.checked),
      );
      renderChart();
    };
    $("printBtn").onclick = () => window.print();
    window.addEventListener("resize", () => {
      clearTimeout(window.hrplusResizeTimer);
      window.hrplusResizeTimer = setTimeout(renderChart, 150);
    });
    HRplusFinancialChart.initialize({
      state,
      getSeries: () =>
        calculateFinancialSeries(
          state.filteredCosts,
          $("applyClientFilters").checked
            ? state.filteredClients
            : state.clientRecords,
          state.months,
        ),
      getVisibleSeries: (series) => [
        ...(state.showOperational ? [series.operationalRequirement] : []),
        ...(state.showDebt ? [series.overallRequirement] : []),
        ...(state.showActual ? [series.actualRevenue] : []),
        ...(state.showExpected ? [series.expectedComplete ? series.completeExpectedRevenue : series.configuredPricingRevenue] : []),
      ],
      getScale: (series) =>
        Math.max(
          1,
          ...(state.showOperational ? series.operationalRequirement : []),
          ...(state.showDebt ? series.overallRequirement : []),
          ...(state.showActual ? series.actualRevenue : []),
          ...(state.showExpected
            ? series.expectedComplete
              ? series.completeExpectedRevenue
              : series.configuredPricingRevenue
            : []),
        ) * 1.12,
    });
  }
  $("showValueLabels").checked = setting("hrplus-show-value-labels", true);
  setupEnhancedFeatures();
  $("exportBtn").onclick = () => {
    const series = calculateFinancialSeries(
      state.filteredCosts,
      $("applyClientFilters").checked
        ? state.filteredClients
        : state.clientRecords,
      state.months,
    );
    exportRows("financial-trend.csv", [
      [
        "Month",
        "Operational Requirement TTD",
        "Debt Requirement TTD",
        "Overall Requirement TTD",
        "Actual Revenue TTD",
        "Configured Pricing Revenue TTD",
        "Expected Revenue TTD",
        "Operating Profit or Loss TTD",
        "Funding Surplus or Shortfall TTD",
        "Overall Coverage Percent",
        "Pricing Complete",
      ],
      ...state.months.map((month, i) => [
        mk(month),
        series.operationalRequirement[i],
        series.debtRequirement[i],
        series.overallRequirement[i],
        series.actualRevenue[i],
        series.configuredPricingRevenue[i],
        series.expectedComplete ? series.completeExpectedRevenue[i] : "",
        series.expectedComplete ? "Yes" : "No",
        series.actualRevenue[i] - series.operationalRequirement[i],
        series.actualRevenue[i] - series.overallRequirement[i],
        series.overallRequirement[i] ? series.actualRevenue[i] / series.overallRequirement[i] * 100 : "",
        series.expectedComplete ? "Yes" : "No",
      ]),
    ]);
  };
  render();
  window.HRplus = {
    ...window.HRplus,
    normalizeModuleKey,
    getDiscoveredModules,
    buildModulePricingRows,
    calculateFinancialSeries,
    findRate,
  };
})();
