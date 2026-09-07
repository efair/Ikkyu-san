#!/usr/bin/env node
"use strict";

const { MongoClient } = require("mongodb");
const { Store, SOURCE } = require("./lib/store");
const C = require("./lib/imedClient");
const { Progress } = require("./lib/progress");

const PAGE_PATH = "/additionals/AllAllowedDist.aspx";
const args = C.parseCommonArgs(process.argv.slice(2));
const DELAY_MS = Number(args.delay || 800);
const CAPTCHA_RETRIES = Number(args.captchaRetries || 8);

function usage() {
  console.log(`
توزیع کنندگان مجاز — AllAllowedDist

Usage:
  node imed_allalloweddist.js [options]

Options:
  --mongo <uri>
  --delay <ms>
  --captcha-retries <n>
  --province <id>          فقط همین استان
  --max-rows <n>           فقط n ردیف اول (تست)
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
  return "/additionals/" + String(url).replace(/^\.\.\//, "");
}

function parseDistRows(html) {
  const cheerio = require("cheerio");
  const $ = cheerio.load(html);
  const $table = $("#ctl00_MainContent_RadGrid1 table.rgMasterTable").first();
  const rows = [];
  $table.find("tbody > tr.rgRow, tbody > tr.rgAltRow").each((_, el) => {
    const tds = $(el).children("td");
    if (tds.length < 10) return;
    const offset = C.dataOffset(tds);
    const nameCell = tds.eq(offset + 2);
    const a = nameCell.find("a").first();
    const last = tds.eq(tds.length - 1);
    const lastA = last.find("a").first();
    rows.push({
      distOrGuild: C.cellText(tds.eq(offset)),
      distType: C.cellText(tds.eq(offset + 1)),
      distName: C.cellText(a.length ? a : nameCell),
      companyUrl: C.absUrl(a.attr("href")),
      distProvince: C.cellText(tds.eq(offset + 3)),
      distCity: C.cellText(tds.eq(offset + 4)),
      distValidDate: C.cellText(tds.eq(offset + 5)),
      distManager: C.cellText(tds.eq(offset + 6)),
      mainName: C.cellText(tds.eq(offset + 7)),
      umdnsGroup: C.cellText(tds.eq(offset + 8)),
      groupNameFa: C.cellText(tds.eq(offset + 9)),
      groupName: C.cellText(tds.eq(offset + 10)),
      repCompanyName: C.cellText(tds.eq(offset + 11)),
      repCompanyType: C.cellText(tds.eq(offset + 12)),
      legalCompanyName: C.cellText(tds.eq(offset + 13)),
      repValidDate: C.cellText(tds.eq(offset + 14)),
      branchListUrl: C.absUrl(lastA.attr("href")),
    });
  });
  return rows;
}

function parseBranches(html) {
  const cheerio = require("cheerio");
  const $ = cheerio.load(html);
  const rows = [];
  $("table.rgMasterTable tbody > tr.rgRow, table.rgMasterTable tbody > tr.rgAltRow").each(
    (_, el) => {
      const tds = $(el).children("td");
      if (tds.length < 6) return;
      const offset = C.dataOffset(tds);
      const storeA = tds.eq(offset + 9).find("a").first();
      rows.push({
        companyType: C.cellText(tds.eq(offset)),
        distributorName: C.cellText(tds.eq(offset + 1)),
        distributorType: C.cellText(tds.eq(offset + 2)),
        name: C.cellText(tds.eq(offset + 3)),
        branchType: C.cellText(tds.eq(offset + 4)),
        province: C.cellText(tds.eq(offset + 5)),
        city: C.cellText(tds.eq(offset + 6)),
        address: C.cellText(tds.eq(offset + 7)),
        technicalManager: C.cellText(tds.eq(offset + 8)),
        storeListUrl: C.absUrl(storeA.attr("href")),
        warehouses: [],
      });
    }
  );
  return rows;
}

function parseWarehouses(html) {
  const cheerio = require("cheerio");
  const $ = cheerio.load(html);
  const rows = [];
  $("table.rgMasterTable tbody > tr.rgRow, table.rgMasterTable tbody > tr.rgAltRow").each(
    (_, el) => {
      const tds = $(el).children("td");
      if (tds.length < 4) return;
      const offset = C.dataOffset(tds);
      const name = C.cellText(tds.eq(offset));
      if (!name) return;
      rows.push({
        name,
        province: C.cellText(tds.eq(offset + 1)),
        city: C.cellText(tds.eq(offset + 2)),
        address: C.cellText(tds.eq(offset + 3)),
        zone: C.cellText(tds.eq(offset + 4)),
        postalCode: C.cellText(tds.eq(offset + 5)),
        createdDate: C.cellText(tds.eq(offset + 6)),
      });
    }
  );
  return rows;
}

function searchFields(html, captcha, provinceId) {
  return {
    ...C.formState(html, [
      "ctl00$MainContent$txt_rad_DistCompany_ClientState",
      "ctl00_MainContent_txt_rad_DistCompany_ClientState",
      "ctl00$MainContent$rad_txtTarafGharardad_ClientState",
      "ctl00_MainContent_rad_txtTarafGharardad_ClientState",
      "ctl00$MainContent$txtKalaName_ClientState",
      "ctl00_MainContent_txtKalaName_ClientState",
      "ctl00$MainContent$txt_ManuName_ClientState",
      "ctl00_MainContent_txt_ManuName_ClientState",
    ]),
    "ctl00$MainContent$drpDistOrGuild": "",
    "ctl00$MainContent$txt_rad_DistCompany": "",
    "ctl00$MainContent$txt_rad_DistCompany_ClientState":
      C.hidden(html, "ctl00_MainContent_txt_rad_DistCompany_ClientState") || "",
    "ctl00$MainContent$drpDistType": "",
    "ctl00$MainContent$rad_txtTarafGharardad": "",
    "ctl00$MainContent$rad_txtTarafGharardad_ClientState":
      C.hidden(html, "ctl00_MainContent_rad_txtTarafGharardad_ClientState") || "",
    "ctl00$MainContent$txtKalaName": "",
    "ctl00$MainContent$txtKalaName_ClientState":
      C.hidden(html, "ctl00_MainContent_txtKalaName_ClientState") || "",
    "ctl00$MainContent$txt_IndexID": "",
    "ctl00$MainContent$drpProvince": provinceId,
    "ctl00$MainContent$DrpCity": "",
    "ctl00$MainContent$txt_ManuName": "",
    "ctl00$MainContent$txt_ManuName_ClientState":
      C.hidden(html, "ctl00_MainContent_txt_ManuName_ClientState") || "",
    "ctl00$MainContent$drp_TarafType": "",
    "ctl00$MainContent$txtVerifyCode": captcha,
    "ctl00$MainContent$btn_Search": "جستجو",
  };
}

function nextPageFields(html, provinceId, pageNumber) {
  const fields = searchFields(html, "", provinceId);
  delete fields["ctl00$MainContent$btn_Search"];
  fields.__EVENTTARGET = "ctl00$MainContent$RadGrid1$ctl00";
  fields.__EVENTARGUMENT = `FireCommand:Page;${pageNumber}`;
  return fields;
}

async function fetchGridPages(session, urlPath, parseFn) {
  let html = await session.getHtml(urlPath);
  let rows = parseFn(html);
  let info = C.parsePageInfo(html);
  for (let page = 2; page <= info.pageCount; page++) {
    await C.sleep(DELAY_MS);
    html = await session.postForm(urlPath, {
      ...C.formState(html),
      __EVENTTARGET: "ctl00$MainContent$RadGrid1$ctl00",
      __EVENTARGUMENT: `FireCommand:Page;${page}`,
    });
    rows = rows.concat(parseFn(html));
    const nextInfo = C.parsePageInfo(html);
    if (nextInfo.pageCount > info.pageCount) info.pageCount = nextInfo.pageCount;
  }
  return rows;
}

async function fetchBranches(session, branchListUrl, cache) {
  if (!branchListUrl) return [];
  if (cache.has(branchListUrl)) return cache.get(branchListUrl);
  const path = toPath(branchListUrl);
  const branches = await fetchGridPages(session, path, parseBranches);
  for (const branch of branches) {
    if (!branch.storeListUrl) {
      branch.warehouses = [];
      continue;
    }
    await C.sleep(DELAY_MS);
    branch.warehouses = await fetchGridPages(session, toPath(branch.storeListUrl), parseWarehouses);
  }
  cache.set(branchListUrl, branches);
  return branches;
}

async function scrapeProvince(store, session, worker, province, startHtml, log, branchCache) {
  if (!args.noResume && !args.maxRows && (await store.isJobDone(SOURCE.DIST, province.id))) {
    if (log) log.skip(`${province.name} (قبلاً تمام شده)`);
    return { skipped: true, items: 0 };
  }

  if (log) log.setSection(`جستجو استان ${province.name}`);
  let html = await C.searchWithCaptcha({
    session,
    worker,
    pagePath: PAGE_PATH,
    startHtml,
    buildFields: (h, captcha) => searchFields(h, captcha, province.id),
    parseRows: parseDistRows,
    retries: CAPTCHA_RETRIES,
    delayMs: DELAY_MS,
    label: province.name,
  });

  let rows = parseDistRows(html);
  let info = C.parsePageInfo(html);
  for (let page = 2; page <= info.pageCount; page++) {
    await C.sleep(DELAY_MS);
    html = await session.postForm(PAGE_PATH, nextPageFields(html, province.id, page));
    rows = rows.concat(parseDistRows(html));
    const nextInfo = C.parsePageInfo(html);
    if (nextInfo.pageCount > info.pageCount) info.pageCount = nextInfo.pageCount;
  }

  const maxRows = Number(args.maxRows || 0);
  if (maxRows) rows = rows.slice(0, maxRows);

  const uniqueBranchUrls = [...new Set(rows.map((r) => r.branchListUrl).filter(Boolean))];
  if (log) {
    log.setSection(`${province.name} | ${rows.length} ردیف | دریافت شعبه و انبار`);
    log.setDetected(uniqueBranchUrls.length, "شرکت/شعبه");
  }

  let i = 0;
  for (const url of uniqueBranchUrls) {
    i += 1;
    if (log) log.setSection(`${province.name} | شعبه ${i}/${uniqueBranchUrls.length}`);
    try {
      await fetchBranches(session, url, branchCache);
    } catch (err) {
      if (log) log.error(`شعبه ${url}: ${err.message}`);
      branchCache.set(url, []);
    }
    if (log) log.tick(url);
  }

  for (const row of rows) {
    row.branches = branchCache.get(row.branchListUrl) || [];
  }

  if (log) {
    log.setSection(`${province.name} | ذخیره مجوزها`);
    log.setDetected(rows.length, "مجوز");
  }
  const result = await store.saveDistRows(rows, (_saved, _total, row) => {
    if (log) log.tick(`${row.distName} — ${row.groupNameFa || row.umdnsGroup}`);
  });

  if (!maxRows) {
    await store.markJob(SOURCE.DIST, province.id, {
      done: true,
      name: province.name,
      pages: info.pageCount,
      items: result.saved,
      linked: result.linked,
      branches: uniqueBranchUrls.length,
      finishedAt: new Date(),
    });
  }
  return {
    skipped: false,
    items: result.saved,
    linked: result.linked,
    pages: info.pageCount,
    branches: uniqueBranchUrls.length,
  };
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

  const log = new Progress("allalloweddist");
  log.start("توزیع کنندگان مجاز");
  console.log("MongoDB:", mongoUri);

  const session = new C.Session(PAGE_PATH);
  const worker = await C.createOcrWorker();
  const branchCache = new Map();
  try {
    let html = await session.getHtml(PAGE_PATH);
    let provinces = C.parseSelectOptions(html, "#ctl00_MainContent_drpProvince").filter((p) => p.id);
    if (args.province) {
      provinces = provinces.filter((p) => p.id === args.province);
      if (!provinces.length) throw new Error(`استان ${args.province} پیدا نشد`);
    }
    log.setDetected(provinces.length, "استان");
    const summary = { source: SOURCE.DIST, startedAt: new Date(), provinces: [] };
    let i = 0;
    for (const province of provinces) {
      i += 1;
      log.setSection(`استان ${i}/${provinces.length} — ${province.name}`);
      try {
        const result = await scrapeProvince(
          store,
          session,
          worker,
          province,
          html,
          log,
          branchCache
        );
        summary.provinces.push({ ...province, ...result, ok: true });
      } catch (err) {
        log.error(`${province.name}: ${err.message}`);
        summary.provinces.push({ ...province, ok: false, error: err.message });
      }
      html = await session.getHtml(PAGE_PATH);
    }

    summary.finishedAt = new Date();
    summary.okCount = summary.provinces.filter((p) => p.ok).length;
    summary.items = summary.provinces.reduce((n, p) => n + (p.items || 0), 0);
    await store.saveRun(summary);
    log.finish(`استان موفق ${summary.okCount}/${provinces.length} | ${summary.items} مجوز`);
  } finally {
    await worker.terminate();
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
