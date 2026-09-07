#!/usr/bin/env node
"use strict";

const { MongoClient } = require("mongodb");
const { Store, SOURCE } = require("./lib/store");
const C = require("./lib/imedClient");
const { Progress } = require("./lib/progress");

const PAGE_PATH = "/additionals/cmpeqpreport.aspx";
const args = parseArgs(process.argv.slice(2));
const DELAY_MS = Number(args.delay || 500);

function parseArgs(argv) {
  const out = C.parseCommonArgs(argv);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === "--name") out.name = next, i++;
    else if (a === "--max-pages") out.maxPages = Number(next), i++;
    else if (a === "--max-names") out.maxNames = Number(next), i++;
  }
  return out;
}

const STOP_WORDS = new Set([
  "و",
  "از",
  "با",
  "به",
  "در",
  "برای",
  "یا",
  "تا",
  "که",
  "های",
  "ها",
  "of",
  "the",
  "and",
  "or",
  "for",
  "to",
  "a",
  "an",
]);

function tokenize(name) {
  return String(name || "")
    .split(/[\s\/\\|_+,،؛:.*()[\]{}«»]+/)
    .map((part) => part.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").trim())
    .filter((part) => {
      if (!part) return false;
      if (STOP_WORDS.has(part.toLowerCase())) return false;
      return [...part].length >= 3;
    });
}

function jobKey(token) {
  return `part:${token}`;
}

function usage() {
  console.log(`
تجهیزات پزشکی مجاز وارداتی — cmpeqpreport

هر نام کالا به بخش‌های جدا شکسته می‌شود (مثال: کتتر مغز و اعصاب → کتتر / مغز / اعصاب)

Usage:
  node imed_cmpeqpreport.js [options]

Options:
  --mongo <uri>
  --delay <ms>
  --name <text>            فقط بخش‌های همین نام
  --from <text>            از این بخش به بعد
  --max-names <n>
  --max-pages <n>          سقف صفحه برای هر جستجو (تست)
  --no-resume
`);
}

function hiddenState(html) {
  return {
    __EVENTTARGET: "",
    __EVENTARGUMENT: "",
    __VIEWSTATE: C.hidden(html, "__VIEWSTATE"),
    __VIEWSTATEGENERATOR: C.hidden(html, "__VIEWSTATEGENERATOR"),
    __EVENTVALIDATION: C.hidden(html, "__EVENTVALIDATION"),
  };
}

function emptySearchFields() {
  return {
    "ctl00$MainContent$txtEqNameEN": "",
    "ctl00$MainContent$txtUMDNS": "",
    "ctl00$MainContent$txtSabt": "",
    "ctl00$MainContent$txtCompany": "",
    "ctl00$MainContent$txtManu": "",
    "ctl00$MainContent$txtSerial": "",
    "ctl00$MainContent$txtTrack": "",
    "ctl00$MainContent$txtLabel": "",
    "ctl00$MainContent$txtModel": "",
  };
}

function searchFields(html, nameFa) {
  return {
    ...hiddenState(html),
    ...emptySearchFields(),
    "ctl00$MainContent$txtEqName": nameFa,
    "ctl00$MainContent$btnSubmit": "جستجو",
  };
}

function pageFields(html, nameFa, pageNumber) {
  return {
    ...hiddenState(html),
    ...emptySearchFields(),
    "ctl00$MainContent$txtEqName": nameFa,
    __EVENTTARGET: "ctl00$MainContent$GridView1",
    __EVENTARGUMENT: `Page$${pageNumber}`,
  };
}

function parseTotal(html) {
  const cheerio = require("cheerio");
  const $ = cheerio.load(html);
  const msg = C.cellText($("#ctl00_MainContent_lblMsg"));
  const m = msg.match(/(\d+)/);
  return { msg, total: m ? Number(m[1]) : 0, empty: /يافت نشد|یافت نشد/.test(msg) };
}

function parseDetailCode(href) {
  if (!href) return "";
  try {
    return new URL(href, "https://report.imed.ir/additionals/").searchParams.get("code") || "";
  } catch {
    return "";
  }
}

function parseEqpRows(html) {
  const cheerio = require("cheerio");
  const $ = cheerio.load(html);
  const rows = [];
  $("#ctl00_MainContent_GridView1 > tbody > tr, #ctl00_MainContent_GridView1 > tr").each((_, el) => {
    const tds = $(el).children("td");
    if (tds.length < 10) return;
    if (tds.first().attr("colspan")) return;
    const detailA = tds.last().find("a[href*='CmpEqpReportDetail']").first();
    const href = detailA.attr("href") || "";
    rows.push({
      agencyName: C.cellText(tds.eq(1)),
      nameEn: C.cellText(tds.eq(2)),
      nameFa: C.cellText(tds.eq(3)),
      umdns: C.cellText(tds.eq(4)),
      labelName: C.cellText(tds.eq(5)),
      model: C.cellText(tds.eq(6)),
      group: C.cellText(tds.eq(7)),
      manufacturer: C.cellText(tds.eq(8)),
      country: C.cellText(tds.eq(9)),
      nature: C.cellText(tds.eq(10)),
      detailUrl: C.absUrl(href),
      code: parseDetailCode(href),
    });
  });
  return rows;
}

function parsePager(html) {
  const cheerio = require("cheerio");
  const $ = cheerio.load(html);
  let current = 1;
  let maxPage = 1;
  let hasLast = false;
  const pager = $("#ctl00_MainContent_GridView1 tr").filter((_, el) => {
    return $(el).children("td").first().attr("colspan");
  }).last();
  pager.find("td > span").each((_, el) => {
    const n = Number(C.cellText($(el)));
    if (n) current = n;
  });
  pager.find("a[href*='Page$']").each((_, el) => {
    const href = $(el).attr("href") || "";
    const m = href.match(/Page\$([^']+)/);
    if (!m) return;
    const arg = C.decodeHtml(m[1]);
    if (arg === "Last") hasLast = true;
    if (/^\d+$/.test(arg)) maxPage = Math.max(maxPage, Number(arg));
  });
  return { current, maxPage, hasNext: maxPage > current || hasLast };
}

function parseDetails(html) {
  const cheerio = require("cheerio");
  const $ = cheerio.load(html);
  const byLabel = {};
  $("table tr").each((_, tr) => {
    const tds = $(tr).children("td");
    if (tds.length < 2) return;
    const label = C.cellText(tds.eq(0)).replace(/:$/, "");
    if (label) byLabel[label] = C.cellText(tds.eq(1));
  });
  const text = (id) => C.cellText($(id));
  return {
    labelName: text("#ctl00_MainContent_lblLabelName") || byLabel["نام برچسب کالا"] || "",
    umdns: text("#ctl00_MainContent_lblUMDNS") || byLabel["کد UMDNS"] || "",
    nameFa: text("#ctl00_MainContent_lblFarsi") || byLabel["نام فارسی کالا"] || "",
    nameEn: text("#ctl00_MainContent_lblLatin") || byLabel["نام لاتين کالا"] || "",
    manufacturer: text("#ctl00_MainContent_lblManu") || byLabel["کمپانی سازنده"] || "",
    country: text("#ctl00_MainContent_lblCountry") || byLabel["کشور سازنده"] || "",
    group: text("#ctl00_MainContent_lblGroup") || byLabel["گروه کالا"] || "",
    nature: text("#ctl00_MainContent_lblType") || byLabel["ماهيت کالا"] || "",
    model: text("#ctl00_MainContent_lblModel") || byLabel["مدل کالا"] || "",
    agencyName: text("#ctl00_MainContent_lblComp") || byLabel["نام نمايندگی"] || "",
    registerCode: text("#ctl00_MainContent_lblSabt") || byLabel["کد ثبت 12 رقمی"] || "",
    clearanceNo: text("#ctl00_MainContent_lblTrack") || byLabel["شماره مجوز ترخيص"] || "",
    clearanceDate: text("#ctl00_MainContent_lblDate") || byLabel["تاريخ مجوز ترخيص"] || "",
    manufactureDate: text("#ctl00_MainContent_lblManuDate") || byLabel["تاريخ توليد"] || "",
    expiryDate: text("#ctl00_MainContent_lblExpDate") || byLabel["تاريخ انقضاء"] || "",
    invoiceNo: text("#ctl00_MainContent_lblFactorNo") || byLabel["شماره فاکتور"] || "",
    invoiceDate: text("#ctl00_MainContent_lblFactorDate") || byLabel["تاريخ فاکتور"] || "",
    detailsFetched: true,
  };
}

function toDetailPath(url) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) {
    const u = new URL(url);
    return u.pathname + u.search;
  }
  if (url.startsWith("/")) return url;
  return "/additionals/" + String(url).replace(/^\.\.\//, "");
}

async function fetchAllPages(session, startHtml, nameFa, maxPages) {
  let html = startHtml;
  let rows = parseEqpRows(html);
  let pager = parsePager(html);
  const limit = maxPages || Infinity;
  while (pager.hasNext && pager.current < limit) {
    const next = pager.current + 1;
    await C.sleep(DELAY_MS);
    html = await session.postForm(PAGE_PATH, pageFields(html, nameFa, next));
    const more = parseEqpRows(html);
    if (!more.length) break;
    rows = rows.concat(more);
    const nextPager = parsePager(html);
    if (nextPager.current <= pager.current) break;
    pager = nextPager;
  }
  return rows;
}

async function enrichDetails(session, store, rows, log) {
  const codes = rows.map((r) => r.code).filter(Boolean);
  const already = await store.eqpCodesWithDetails(codes);
  let fetched = 0;
  for (const row of rows) {
    if (!row.code || already.has(row.code)) continue;
    await C.sleep(DELAY_MS);
    try {
      const html = await session.getHtml(toDetailPath(row.detailUrl));
      Object.assign(row, parseDetails(html));
      already.add(row.code);
      fetched += 1;
    } catch (err) {
      if (log) log.error(`جزئیات ${row.code}: ${err.message}`);
    }
  }
  return fetched;
}

async function scrapeName(store, session, name, log) {
  if ([...name].length < 3) {
    await store.markJob(SOURCE.EQP_REPORT, jobKey(name), {
      done: true,
      skipped: true,
      token: name,
      reason: "کمتر از ۳ حرف",
      finishedAt: new Date(),
    });
    return { skipped: true, items: 0 };
  }

  let html = await session.getHtml(PAGE_PATH);
  await C.sleep(DELAY_MS);
  html = await session.postForm(PAGE_PATH, searchFields(html, name));
  const info = parseTotal(html);
  if (info.empty || !info.total) {
    await store.markJob(SOURCE.EQP_REPORT, jobKey(name), {
      done: true,
      token: name,
      items: 0,
      total: 0,
      finishedAt: new Date(),
    });
    return { skipped: false, items: 0, total: 0 };
  }

  if (log) log.setSection(`${name} | ${info.total} رکورد`);
  const rows = await fetchAllPages(session, html, name, args.maxPages);
  const details = await enrichDetails(session, store, rows, log);
  const saved = await store.saveEqpRows(rows, name);
  await store.markJob(SOURCE.EQP_REPORT, jobKey(name), {
    done: true,
    token: name,
    items: saved.saved,
    total: info.total,
    details,
    finishedAt: new Date(),
  });
  return { skipped: false, items: saved.saved, total: info.total, details };
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

  const log = new Progress("cmpeqpreport");
  log.start("تجهیزات پزشکی مجاز وارداتی");
  console.log("MongoDB:", mongoUri);

  let names;
  if (args.name) {
    names = [args.name];
  } else {
    names = (
      await store.productSearch.find({}, { projection: { name: 1 } }).sort({ name: 1 }).toArray()
    ).map((d) => d.name).filter(Boolean);
  }

  const tokenMap = new Map();
  for (const name of names) {
    for (const token of tokenize(name)) {
      const key = token.toLowerCase();
      if (!tokenMap.has(key)) tokenMap.set(key, token);
    }
  }
  let tokens = [...tokenMap.values()].sort((a, b) => a.localeCompare(b, "fa"));
  if (args.from) {
    const idx = tokens.findIndex((n) => n === args.from);
    if (idx >= 0) tokens = tokens.slice(idx);
  }
  if (args.maxNames || args.maxRows) {
    tokens = tokens.slice(0, Number(args.maxNames || args.maxRows));
  }

  const done = args.noResume ? new Set() : await store.doneJobKeys(SOURCE.EQP_REPORT);
  const pending = tokens.filter((n) => !done.has(jobKey(n)));
  log.setDetected(pending.length, "بخش نام");

  const session = new C.Session(PAGE_PATH);
  const summary = { source: SOURCE.EQP_REPORT, startedAt: new Date(), names: 0, items: 0 };
  try {
    for (const name of pending) {
      log.setSection(name);
      try {
        const result = await scrapeName(store, session, name, log);
        summary.names += 1;
        summary.items += result.items || 0;
        log.tick(`${name} — ${result.items || 0}`);
      } catch (err) {
        log.error(`${name}: ${err.message}`);
      }
    }
    summary.finishedAt = new Date();
    await store.saveRun(summary);
    log.finish(`${summary.names} نام | ${summary.items} رکورد`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
