#!/usr/bin/env node
"use strict";

const cheerio = require("cheerio");
const { MongoClient } = require("mongodb");
const { Store, SOURCE } = require("./lib/store");
const C = require("./lib/imedClient");
const { Progress } = require("./lib/progress");

const PAGE_PATH = "/Additionals/SrchConfirmedImedCompanyForiati.aspx";
const args = parseArgs(process.argv.slice(2));
const DELAY_MS = Number(args.delay || 800);
const CAPTCHA_RETRIES = Number(args.captchaRetries || 8);

function parseArgs(argv) {
  const out = C.parseCommonArgs(argv);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === "--name") out.name = next, i++;
    else if (a === "--max-names") out.maxNames = Number(next), i++;
    else if (a === "--max-pages") out.maxPages = Number(next), i++;
  }
  return out;
}

function usage() {
  console.log(`
شرکت های وارد کننده دارای نمایندگی تامین کننده مجاز در زمینه واردات تجهیزات و ملزومات پزشکی

Usage:
  node imed_srchconfirmed_foriati.js [options]

Options:
  --mongo <uri>
  --delay <ms>
  --captcha-retries <n>
  --name <text>            فقط همین نام فارسی کالا
  --from <text>            از این نام به بعد
  --max-names <n>
  --max-pages <n>
  --no-resume
`);
}

function toPath(url) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) {
    const u = new URL(url);
    return u.pathname + u.search;
  }
  if (url.startsWith("/")) return url;
  return "/Additionals/" + String(url).replace(/^\.\.\//, "");
}

function searchFields(html, captcha, nameFa) {
  return {
    ...C.formState(html),
    "ctl00$MainContent$txt_company": "",
    "ctl00$MainContent$txt_cmpCode": "",
    "ctl00$MainContent$DrpCity": "0",
    "ctl00$MainContent$txt_Country": "",
    "ctl00$MainContent$txt_Manuf": "",
    "ctl00$MainContent$txt_BossFamily": "",
    "ctl00$MainContent$txt_TechFamily": "",
    "ctl00$MainContent$Txt_NationalId": "",
    "ctl00$MainContent$Txt_umdns": "",
    "ctl00$MainContent$txt_KalaEn": "",
    "ctl00$MainContent$txt_Kala": nameFa,
    "ctl00$MainContent$txtVerifyCode": captcha,
    "ctl00$MainContent$btn_Search": "جستجو",
  };
}

function nextPageFields(html, nameFa, pageNumber) {
  const fields = searchFields(html, "", nameFa);
  delete fields["ctl00$MainContent$btn_Search"];
  fields.__EVENTTARGET = "ctl00$MainContent$RadGrid1$ctl00";
  fields.__EVENTARGUMENT = `FireCommand:Page;${pageNumber}`;
  return fields;
}

function parseMasterRows(html) {
  const $ = cheerio.load(html);
  const rows = [];
  $("#ctl00_MainContent_RadGrid1 table.rgMasterTable tbody > tr.rgRow, #ctl00_MainContent_RadGrid1 table.rgMasterTable tbody > tr.rgAltRow").each(
    (_, el) => {
      const tds = $(el).children("td");
      if (tds.length < 5) return;
      const offset = C.dataOffset(tds);
      const nameCell = tds.eq(offset + 2);
      const nameA = nameCell.find("a").first();
      const lastA = tds.eq(tds.length - 1).find("a").first();
      rows.push({
        cmpCode: C.cellText(tds.eq(offset)),
        nationalId: C.cellText(tds.eq(offset + 1)),
        name: C.cellText(nameA.length ? nameA : nameCell),
        companyUrl: C.absUrl(nameA.attr("href")),
        ceo: C.cellText(tds.eq(offset + 3)),
        technicalManager: C.cellText(tds.eq(offset + 4)),
        agenciesUrl: C.absUrl(lastA.attr("href")),
      });
    }
  );
  return rows;
}

function parseAgencies(html) {
  const $ = cheerio.load(html);
  const companyName = C.cellText($("#ctl00_MainContent_lbl_cmpName"));
  const rows = [];
  $("table.rgMasterTable tbody > tr.rgRow, table.rgMasterTable tbody > tr.rgAltRow").each((_, el) => {
    const tds = $(el).children("td");
    if (tds.length < 4) return;
    const offset = C.dataOffset(tds);
    const prodA = tds.eq(offset + 4).find("a").first();
    rows.push({
      importerName: companyName,
      legalManufacturer: C.cellText(tds.eq(offset)),
      legalCountry: C.cellText(tds.eq(offset + 1)),
      agencyValidDate: C.cellText(tds.eq(offset + 2)),
      saleOrService: C.cellText(tds.eq(offset + 3)),
      productsUrl: C.absUrl(prodA.attr("href")),
      products: [],
    });
  });
  return rows;
}

function parseAgencyProducts(html) {
  const $ = cheerio.load(html);
  const rows = [];
  $("table.rgMasterTable tbody > tr.rgRow, table.rgMasterTable tbody > tr.rgAltRow").each((_, el) => {
    const tds = $(el).children("td");
    if (tds.length < 7) return;
    const offset = C.dataOffset(tds);
    const regA = tds.eq(tds.length - 1).find("a").first();
    rows.push({
      legalManufacturer: C.cellText(tds.eq(offset)),
      legalCountry: C.cellText(tds.eq(offset + 1)),
      mainGroup: C.cellText(tds.eq(offset + 2)),
      subGroup: C.cellText(tds.eq(offset + 3)),
      catalogPath: C.cellText(tds.eq(offset + 4)),
      nameFa: C.cellText(tds.eq(offset + 5)),
      riskClass: C.cellText(tds.eq(offset + 6)),
      umdns: C.cellText(tds.eq(offset + 7)),
      confirmedEqUrl: C.absUrl(regA.attr("href")),
      registeredProducts: [],
    });
  });
  return rows;
}

function parseRegisteredProducts(html) {
  const $ = cheerio.load(html);
  const heading = C.cellText($("#ctl00_MainContent_lbl_cmpName"));
  const rows = [];
  $("table.rgMasterTable tbody > tr.rgRow, table.rgMasterTable tbody > tr.rgAltRow").each((_, el) => {
    const tds = $(el).children("td");
    if (tds.length < 10) return;
    const offset = C.dataOffset(tds);
    const specsA = tds.find("a[href*='UMDNSGroupCodeDetails']").first();
    const distA = tds.find("a[href*='Reg_DistBranch']").first();
    const ircA = tds.find("a[href*='IRCList']").first();
    rows.push({
      heading,
      nameFa: C.cellText(tds.eq(offset)),
      nameEn: C.cellText(tds.eq(offset + 1)),
      group: C.cellText(tds.eq(offset + 2)),
      umdns: C.cellText(tds.eq(offset + 3)),
      model: C.cellText(tds.eq(offset + 4)),
      brand: C.cellText(tds.eq(offset + 5)),
      legalManufacturer: C.cellText(tds.eq(offset + 6)),
      legalCountry: C.cellText(tds.eq(offset + 7)),
      oemManufacturer: C.cellText(tds.eq(offset + 8)),
      oemCountry: C.cellText(tds.eq(offset + 9)),
      agencyName: C.cellText(tds.eq(offset + 10)),
      agencyCode: C.cellText(tds.eq(offset + 11)),
      specsUrl: C.absUrl(specsA.attr("href")),
      provincialDistributorsUrl: C.absUrl(distA.attr("href")),
      ircsUrl: C.absUrl(ircA.attr("href")),
      specs: null,
      provincialDistributors: [],
      ircs: [],
    });
  });
  return rows;
}

function parseSpecs(html) {
  const $ = cheerio.load(html);
  const text = (id) => C.cellText($(id));
  const oemCell = $("#ctl00_MainContent_UMDNSGroupCodeDetailseorAllControl_trOEM td").eq(1);
  return {
    name: text("#ctl00_MainContent_UMDNSGroupCodeDetailseorAllControl_lbl_Kala"),
    nameEn: text("#ctl00_MainContent_UMDNSGroupCodeDetailseorAllControl_lblDeviceNameEn"),
    description: text("#ctl00_MainContent_UMDNSGroupCodeDetailseorAllControl_lblDeviceDesc"),
    umdns: text("#ctl00_MainContent_UMDNSGroupCodeDetailseorAllControl_lblUMDNS"),
    legalManufacturer: text("#ctl00_MainContent_UMDNSGroupCodeDetailseorAllControl_lbl_Legal"),
    legalCountry: text("#ctl00_MainContent_UMDNSGroupCodeDetailseorAllControl_lbl_Country_Legal"),
    oem: C.cellText(oemCell),
    model: text("#ctl00_MainContent_UMDNSGroupCodeDetailseorAllControl_lbl_Model"),
    companyType: text("#ctl00_MainContent_UMDNSGroupCodeDetailseorAllControl_lbl_companyType"),
    agencyStatus: text("#ctl00_MainContent_UMDNSGroupCodeDetailseorAllControl_lbl_Foriati"),
    unit: text("#ctl00_MainContent_UMDNSGroupCodeDetailseorAllControl_lbl_Unit"),
    usability: text("#ctl00_MainContent_UMDNSGroupCodeDetailseorAllControl_lbl_Usability"),
    commonName: text("#ctl00_MainContent_UMDNSGroupCodeDetailseorAllControl_lbl_CommonName"),
    labelName: text("#ctl00_MainContent_UMDNSGroupCodeDetailseorAllControl_lbl_LableName"),
    brand: text("#ctl00_MainContent_UMDNSGroupCodeDetailseorAllControl_lbl_Brand"),
    catalogNo: text("#ctl00_MainContent_UMDNSGroupCodeDetailseorAllControl_lbl_Catalog"),
  };
}

function parseProvincialDistributors(html) {
  const $ = cheerio.load(html);
  const rows = [];
  $("table.rgMasterTable tbody > tr.rgRow, table.rgMasterTable tbody > tr.rgAltRow").each((_, el) => {
    const tds = $(el).children("td");
    if (tds.length < 6) return;
    const offset = C.dataOffset(tds);
    rows.push({
      distributorName: C.cellText(tds.eq(offset)),
      distributorType: C.cellText(tds.eq(offset + 1)),
      nationalId: C.cellText(tds.eq(offset + 2)),
      province: C.cellText(tds.eq(offset + 3)),
      companyType: C.cellText(tds.eq(offset + 4)),
      nameFa: C.cellText(tds.eq(offset + 5)),
      nameEn: C.cellText(tds.eq(offset + 6)),
      umdns: C.cellText(tds.eq(offset + 7)),
      legalManufacturer: C.cellText(tds.eq(offset + 8)),
      validityStatus: C.cellText(tds.eq(offset + 9)),
    });
  });
  return rows;
}

function parseIrcs(html) {
  const $ = cheerio.load(html);
  const rows = [];
  $("table.rgMasterTable tbody > tr.rgRow, table.rgMasterTable tbody > tr.rgAltRow").each((_, el) => {
    const tds = $(el).children("td");
    if (tds.length < 3) return;
    const offset = C.dataOffset(tds);
    const strip = (v) => C.cellText(tds.eq(v)).replace(/^'+|'+$/g, "");
    rows.push({
      irc: strip(offset),
      nameFa: strip(offset + 1),
      nameEn: strip(offset + 2),
      gtin: strip(offset + 3),
    });
  });
  return rows;
}

async function fetchGridPages(session, startHtml, pagePath, parseFn, nameFa) {
  let html = startHtml;
  let rows = parseFn(html);
  let info = C.parsePageInfo(html);
  const limit = args.maxPages || Infinity;
  for (let page = 2; page <= info.pageCount && page <= limit; page++) {
    await C.sleep(DELAY_MS);
    html = await session.postForm(pagePath, nextPageFields(html, nameFa || "", page));
    rows = rows.concat(parseFn(html));
    const nextInfo = C.parsePageInfo(html);
    if (nextInfo.pageCount > info.pageCount) info.pageCount = nextInfo.pageCount;
  }
  return rows;
}

async function fetchHtmlCached(session, url, cache) {
  if (!url) return "";
  if (cache.has(url)) return cache.get(url);
  await C.sleep(DELAY_MS);
  const html = await session.getHtml(toPath(url));
  cache.set(url, html);
  return html;
}

async function enrichRegistered(session, product, cache, log) {
  if (product.specsUrl) {
    try {
      product.specs = parseSpecs(await fetchHtmlCached(session, product.specsUrl, cache));
    } catch (err) {
      if (log) log.error(`مشخصات کالا: ${err.message}`);
      product.specs = null;
    }
  }
  if (product.provincialDistributorsUrl) {
    try {
      const html = await fetchHtmlCached(session, product.provincialDistributorsUrl, cache);
      product.provincialDistributors = parseProvincialDistributors(html);
    } catch (err) {
      if (log) log.error(`نمایندگان استان: ${err.message}`);
      product.provincialDistributors = [];
    }
  }
  if (product.ircsUrl) {
    try {
      const html = await fetchHtmlCached(session, product.ircsUrl, cache);
      product.ircs = parseIrcs(html);
    } catch (err) {
      if (log) log.error(`فهرست IRC: ${err.message}`);
      product.ircs = [];
    }
  }
  return product;
}

async function enrichCompany(session, row, cache, log) {
  if (!row.agenciesUrl) {
    row.agencies = [];
    return row;
  }
  try {
    const agencyHtml = await fetchHtmlCached(session, row.agenciesUrl, cache);
    row.agencies = parseAgencies(agencyHtml);
  } catch (err) {
    if (log) log.error(`نمایندگی‌ها ${row.name}: ${err.message}`);
    row.agencies = [];
    return row;
  }

  for (const agency of row.agencies) {
    if (!agency.productsUrl) continue;
    try {
      const prodHtml = await fetchHtmlCached(session, agency.productsUrl, cache);
      agency.products = parseAgencyProducts(prodHtml);
    } catch (err) {
      if (log) log.error(`کالاهای نمایندگی: ${err.message}`);
      agency.products = [];
      continue;
    }
    for (const product of agency.products) {
      if (!product.confirmedEqUrl) continue;
      try {
        const eqHtml = await fetchHtmlCached(session, product.confirmedEqUrl, cache);
        const registered = parseRegisteredProducts(eqHtml);
        for (const item of registered) {
          await enrichRegistered(session, item, cache, log);
        }
        product.registeredProducts = registered;
      } catch (err) {
        if (log) log.error(`کالاهای ثبت‌شده: ${err.message}`);
        product.registeredProducts = [];
      }
    }
  }
  return row;
}

async function scrapeName(store, session, worker, name, log, cache) {
  if (log) log.setSection(`جستجو ${name}`);
  let html = await session.getHtml(PAGE_PATH);
  html = await C.searchWithCaptcha({
    session,
    worker,
    pagePath: PAGE_PATH,
    startHtml: html,
    buildFields: (h, captcha) => searchFields(h, captcha, name),
    parseRows: parseMasterRows,
    retries: CAPTCHA_RETRIES,
    delayMs: DELAY_MS,
    label: name,
  });

  let companies = await fetchGridPages(session, html, PAGE_PATH, parseMasterRows, name);
  if (log) {
    log.setSection(`${name} | ${companies.length} شرکت`);
    log.setDetected(Math.max(companies.length, 1), "شرکت");
  }

  let saved = 0;
  let linked = 0;
  if (!companies.length) {
    if (log) log.tick(`${name}: بدون شرکت`);
  }
  for (const company of companies) {
    try {
      await enrichCompany(session, company, cache, log);
      const result = await store.saveConfirmedImporterRows(
        [company],
        name,
        SOURCE.CONFIRMED_IMPORT_FORIATI
      );
      saved += result.saved || 0;
      linked += result.linked || 0;
      const totalUnique = await store.licenses.countDocuments({
        source: SOURCE.CONFIRMED_IMPORT_FORIATI,
      });
      if (log) {
        log.tick(`${company.name} — ${company.cmpCode} | یکتا=${totalUnique}`);
        log.extra = `یکتای ذخیره‌شده ${totalUnique}`;
        log.flush(true);
      }
    } catch (err) {
      if (log) log.error(`${company.name || name}: ${err.message}`);
    }
  }

  await store.markJob(SOURCE.CONFIRMED_IMPORT_FORIATI, name, {
    done: true,
    items: saved,
    linked,
    finishedAt: new Date(),
  });
  return { saved, linked };
}

async function main() {
  if (args.help) {
    usage();
    return;
  }

  const mongoUri = args.mongo || C.MONGO_URI;
  const client = new MongoClient(mongoUri);
  await client.connect();
  const store = new Store(client.db(C.DB_NAME));
  await store.init();

  const log = new Progress("srchconfirmed-foriati");
  log.start("شرکت های وارد کننده دارای نمایندگی تامین کننده مجاز در زمینه واردات تجهیزات و ملزومات پزشکی");
  console.log("MongoDB:", mongoUri);

  let names;
  if (args.name) {
    names = [args.name];
  } else {
    names = (
      await store.productSearch.find({}, { projection: { name: 1 } }).sort({ name: 1 }).toArray()
    )
      .map((d) => d.name)
      .filter(Boolean);
  }
  if (args.from) {
    const idx = names.findIndex((n) => n === args.from);
    if (idx >= 0) names = names.slice(idx);
  }
  if (args.maxNames || args.maxRows) {
    names = names.slice(0, Number(args.maxNames || args.maxRows));
  }

  const done = args.noResume ? new Set() : await store.doneJobKeys(SOURCE.CONFIRMED_IMPORT_FORIATI);
  const pending = names.filter((n) => !done.has(n));
  log.setDetected(pending.length, "نام کالا");

  const session = new C.Session(PAGE_PATH);
  const worker = await C.createOcrWorker();
  const cache = new Map();
  const summary = { source: SOURCE.CONFIRMED_IMPORT_FORIATI, startedAt: new Date(), names: 0, items: 0 };
  try {
    for (const name of pending) {
      try {
        const result = await scrapeName(store, session, worker, name, log, cache);
        summary.names += 1;
        summary.items += result.saved || 0;
      } catch (err) {
        log.error(`${name}: ${err.message}`);
      }
    }
    summary.finishedAt = new Date();
    await store.saveRun(summary);
    log.finish(`${summary.names} نام | ${summary.items} شرکت`);
  } finally {
    await worker.terminate();
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
