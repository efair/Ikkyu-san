"use strict";

const { SOURCE } = require("./store");

const WORKERS = [
  {
    id: "prodconfirmedcmp",
    script: "imed_prodconfirmedcmp.js",
    label: "تولیدکنندگان دارای پروانه ساخت",
    source: SOURCE.PROD_LICENSE,
    defaultArgs: ["--delay", "800"],
    audit: "prod",
    local: { collection: "products", filter: { source: SOURCE.PROD_LICENSE } },
  },
  {
    id: "company_profiles",
    script: "imed_company_profiles.js",
    label: "غنی‌سازی پروفایل شرکت‌ها",
    source: SOURCE.PROD_LICENSE,
    defaultArgs: [],
    audit: "profiles",
    local: { collection: "companies", filter: { profileFetchedAt: { $exists: true } } },
  },
  {
    id: "retailcmp",
    script: "imed_retailcmp.js",
    label: "عرضه کنندگان مجاز",
    source: SOURCE.RETAIL,
    defaultArgs: ["--delay", "800"],
    audit: "retail",
    local: { collection: "licenses", filter: { kind: "retail" } },
  },
  {
    id: "allalloweddist",
    script: "imed_allalloweddist.js",
    label: "توزیع کنندگان مجاز",
    source: SOURCE.DIST,
    defaultArgs: ["--delay", "800"],
    audit: "dist",
    local: { collection: "licenses", filter: { kind: "distribution" } },
  },
  {
    id: "export_cert",
    script: "imed_export_cert.js",
    label: "صادرکنندگان دارای پروانه ساخت",
    source: SOURCE.EXPORT,
    defaultArgs: ["--delay", "800"],
    audit: "export",
    local: { collection: "licenses", filter: { kind: "export" } },
  },
  {
    id: "product_tree",
    script: "imed_product_tree.js",
    label: "درختواره کالا",
    source: SOURCE.PRODUCT_TREE,
    defaultArgs: ["--delay", "800"],
    audit: "tree",
    local: { collection: "product_tree", filter: {} },
  },
  {
    id: "product_search",
    script: "imed_product_search.js",
    label: "فهرست نام کالا",
    source: SOURCE.PRODUCT_SEARCH,
    defaultArgs: [],
    audit: "search",
    local: { collection: "product_search", filter: {} },
  },
  {
    id: "cmpeqpreport",
    script: "imed_cmpeqpreport.js",
    label: "تجهیزات مجاز وارداتی",
    source: SOURCE.EQP_REPORT,
    defaultArgs: ["--delay", "400"],
    audit: "equipment",
    local: { collection: "imported_equipment", filter: {} },
  },
  {
    id: "srchconfirmed",
    script: "imed_srchconfirmed.js",
    label: "شرکت‌های مجاز واردات",
    source: SOURCE.CONFIRMED_IMPORT,
    defaultArgs: ["--delay", "800"],
    audit: "import",
    local: { collection: "licenses", filter: { kind: "import" } },
  },
  {
    id: "srchconfirmed_foriati",
    script: "imed_srchconfirmed_foriati.js",
    label: "واردات فوریتی",
    source: SOURCE.CONFIRMED_IMPORT_FORIATI,
    defaultArgs: ["--delay", "800"],
    audit: "foriati",
    local: { collection: "licenses", filter: { kind: "import_foriati" } },
  },
];

function findWorker(id) {
  return WORKERS.find((w) => w.id === id) || null;
}

function workerByScript(commandLine) {
  const line = String(commandLine || "").replace(/\\/g, "/").toLowerCase();
  return WORKERS.find((w) => line.includes(w.script.toLowerCase())) || null;
}

module.exports = { WORKERS, findWorker, workerByScript };
