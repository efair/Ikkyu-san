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
  const fragment = C.extractMasterTableHtml(html) || html;
  const $ = cheerio.load(fragment, { xml: false });
  const $table = $("table.rgMasterTable").first().length
    ? $("table.rgMasterTable").first()
    : $.root();
  const rows = [];
  $table.find("tbody > tr.rgRow, tbody > tr.rgAltRow, tr.rgRow, tr.rgAltRow").each((_, el) => {
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
  const fragment = C.extractMasterTableHtml(html) || html;
  const $ = cheerio.load(fragment);
  const rows = [];
  $("tr.rgRow, tr.rgAltRow").each((_, el) => {
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
  });
  return rows;
}

function parseWarehouses(html) {
  const cheerio = require("cheerio");
  const fragment = C.extractMasterTableHtml(html) || html;
  const $ = cheerio.load(fragment);
  const rows = [];
  $("tr.rgRow, tr.rgAltRow").each((_, el) => {
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
  });
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

async function fetchBranches(session, branchListUrl) {
  if (!branchListUrl) return [];
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
  return branches;
}

function shrinkHtmlToForm(html) {
  // جدول و اسکریپت‌های سنگین را دور بریز؛ فقط hiddenهای لازم برای صفحه بعد بماند
  const names = [
    "ctl00_MainContent_ScriptManager1_TSM",
    "__VIEWSTATE",
    "__VIEWSTATEGENERATOR",
    "__EVENTVALIDATION",
    "ctl00$MainContent$RadGrid1_ClientState",
    "ctl00_MainContent_txt_rad_DistCompany_ClientState",
    "ctl00$MainContent$txt_rad_DistCompany_ClientState",
    "ctl00_MainContent_rad_txtTarafGharardad_ClientState",
    "ctl00$MainContent$rad_txtTarafGharardad_ClientState",
    "ctl00_MainContent_txtKalaName_ClientState",
    "ctl00$MainContent$txtKalaName_ClientState",
    "ctl00_MainContent_txt_ManuName_ClientState",
    "ctl00$MainContent$txt_ManuName_ClientState",
  ];
  const parts = ['<html><body><form id="aspnetForm">'];
  for (const name of names) {
    const val = C.hidden(html, name);
    if (val === "" && !name.startsWith("__")) continue;
    const safe = String(val).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    parts.push(`<input type="hidden" name="${name}" id="${name}" value="${safe}" />`);
  }
  parts.push("</form></body></html>");
  return parts.join("");
}

async function scrapeProvince(store, session, worker, province, startHtml, log, meta = {}) {
  const provinceIdx = meta.provinceIdx || 1;
  const provinceTotal = meta.provinceTotal || 1;

  if (!args.noResume && !args.maxRows && (await store.isJobDone(SOURCE.DIST, province.id))) {
    if (log) log.skip(`${province.name} (قبلاً تمام شده)`);
    return { skipped: true, items: 0 };
  }

  const statusLine = (parts) =>
    [`استان ${provinceIdx}/${provinceTotal}: ${province.name}`, ...parts.filter(Boolean)].join(" | ");

  if (log) {
    log.setSection(statusLine(["در حال جستجو و کپچا"]));
  }
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

  let info = C.parsePageInfo(html);
  const maxRows = Number(args.maxRows || 0);
  let remaining = maxRows || Infinity;
  let saved = 0;
  let linked = 0;
  let branchUrlCount = 0;
  let provinceRowTotal = info.itemCount || 0;

  if (log) {
    log.setSection(
      statusLine([
        `صفحات سایت: ${info.pageCount}`,
        info.itemCount ? `رکورد اعلام‌شده: ${info.itemCount}` : null,
        "در حال خواندن جدول…",
      ])
    );
    log.note(
      `${province.name} | صفحات=${info.pageCount} | اندازه≈${Math.round(Buffer.byteLength(html, "utf8") / 1024)}KB | itemCount=${info.itemCount || "?"}`
    );
  }

  for (let page = 1; page <= info.pageCount && remaining > 0; page++) {
    if (page > 1) {
      await C.sleep(DELAY_MS);
      if (log) {
        log.updateSection(
          statusLine([`صفحه ${page}/${info.pageCount}`, "در حال دریافت صفحه…"]),
          `صفحه ${page}`
        );
      }
      html = await session.postForm(PAGE_PATH, nextPageFields(html, province.id, page));
      const nextInfo = C.parsePageInfo(html);
      if (nextInfo.pageCount > info.pageCount) info.pageCount = nextInfo.pageCount;
      if (nextInfo.itemCount) provinceRowTotal = nextInfo.itemCount;
    }

    let rows = parseDistRows(html);
    if (remaining < Infinity) {
      rows = rows.slice(0, remaining);
      remaining -= rows.length;
    }
    if (!provinceRowTotal) provinceRowTotal = rows.length;
    // اگر همه در یک صفحه آمده، همان تعداد ردیف معیار است
    if (info.pageCount === 1) provinceRowTotal = rows.length;

    const uniqueCompanies = new Set(rows.map((r) => r.distName).filter(Boolean)).size;

    // ViewState را نگه دار، بقیه HTML سنگین را دور بریز
    html = shrinkHtmlToForm(html);
    if (global.gc) global.gc();

    const urlUses = new Map();
    for (const row of rows) {
      if (!row.branchListUrl) continue;
      urlUses.set(row.branchListUrl, (urlUses.get(row.branchListUrl) || 0) + 1);
    }
    const pageCache = new Map();
    const uniqueBranchCount = urlUses.size;

    if (log) {
      log.setSection(
        statusLine([
          `صفحه ${page}/${info.pageCount}`,
          `${provinceRowTotal} ردیف در استان`,
          `${uniqueCompanies} شرکت یکتا در این صفحه`,
          `${uniqueBranchCount} شعبه یکتا`,
          `ذخیره ۰/${rows.length}`,
        ])
      );
      log.note(
        `${province.name} | صفحه ${page}/${info.pageCount} | ${rows.length} ردیف | ${uniqueCompanies} شرکت | ${uniqueBranchCount} شعبه | ${log.progressText()}`
      );
    }

    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri];
      const url = row.branchListUrl;
      if (url) {
        if (!pageCache.has(url)) {
          try {
            if (log) {
              log.updateSection(
                statusLine([
                  `صفحه ${page}/${info.pageCount}`,
                  `ردیف ${ri + 1}/${rows.length}`,
                  `ذخیره‌شده ${saved}/${provinceRowTotal}`,
                  `${uniqueCompanies} شرکت در صفحه`,
                  "دریافت شعبه‌ها…",
                ]),
                row.distName || ""
              );
            }
            pageCache.set(url, await fetchBranches(session, url));
            branchUrlCount += 1;
            if (log && (branchUrlCount <= 3 || branchUrlCount % 10 === 0)) {
              log.note(
                `${province.name} | صفحه ${page}/${info.pageCount} | شعبه یکتای ${branchUrlCount}/${uniqueBranchCount} | ردیف ${ri + 1}/${rows.length}`
              );
            }
          } catch (err) {
            if (log) log.error(`شعبه ${url}: ${err.message}`);
            pageCache.set(url, []);
          }
        }
        row.branches = pageCache.get(url) || [];
      } else {
        row.branches = [];
      }

      const result = await store.saveDistRows([row]);
      saved += result.saved;
      linked += result.linked;

      if (log) {
        const line = statusLine([
          `صفحه ${page}/${info.pageCount}`,
          `ردیف ${ri + 1}/${rows.length} از ${provinceRowTotal}`,
          `ذخیره‌شده ${saved}`,
          `${uniqueCompanies} شرکت در صفحه`,
          row.distName ? `شرکت: ${row.distName}` : null,
        ]);
        // هر ردیف وضعیت پنل؛ هر ۲۰ ردیف یک خط لاگ
        if ((ri + 1) % 20 === 0 || ri === 0 || ri + 1 === rows.length) {
          log.setSection(line);
          log.note(
            `${province.name} | صفحه ${page}/${info.pageCount} | ذخیره ${ri + 1}/${rows.length} | شرکت: ${row.distName || "—"}`
          );
        } else {
          log.updateSection(line, row.distName || "");
        }
      }

      row.branches = null;
      rows[ri] = null;

      if (url) {
        const left = (urlUses.get(url) || 1) - 1;
        if (left <= 0) {
          urlUses.delete(url);
          pageCache.delete(url);
        } else {
          urlUses.set(url, left);
        }
      }
    }

    rows = null;
    pageCache.clear();
    if (global.gc) global.gc();
  }

  if (!maxRows) {
    await store.markJob(SOURCE.DIST, province.id, {
      done: true,
      name: province.name,
      pages: info.pageCount,
      items: saved,
      linked,
      branches: branchUrlCount,
      finishedAt: new Date(),
    });
  }
  if (log) {
    log.setSection(
      statusLine([`تمام شد`, `${saved} ردیف ذخیره‌شده`, `${branchUrlCount} شعبه`])
    );
  }
  return {
    skipped: false,
    items: saved,
    linked,
    pages: info.pageCount,
    branches: branchUrlCount,
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
  console.log(
    "heapLimitMB:",
    Math.round(require("v8").getHeapStatistics().heap_size_limit / 1024 / 1024)
  );

  const session = new C.Session(PAGE_PATH);
  const worker = await C.createOcrWorker();
  try {
    let html = await session.getHtml(PAGE_PATH);
    let provinces = C.parseSelectOptions(html, "#ctl00_MainContent_drpProvince").filter((p) => p.id);
    if (args.province) {
      provinces = provinces.filter((p) => p.id === args.province);
      if (!provinces.length) throw new Error(`استان ${args.province} پیدا نشد`);
    }
    const doneKeys = args.noResume ? new Set() : await store.doneJobKeys(SOURCE.DIST);
    const pending = provinces.filter((p) => !doneKeys.has(p.id));
    const alreadyDone = provinces.length - pending.length;
    log.setDetected(pending.length, "استان");
    if (alreadyDone) {
      log.note(`از قبل تمام شده: ${alreadyDone} استان — باقیمانده ${pending.length}`);
    }
    const summary = { source: SOURCE.DIST, startedAt: new Date(), provinces: [] };
    for (const province of pending) {
      const idx = log.done + 1;
      const left = pending.length - log.done;
      log.setSection(`استان ${idx}/${pending.length} (مانده ${left}) — ${province.name}`);
      try {
        const result = await scrapeProvince(store, session, worker, province, html, log, {
          provinceIdx: idx,
          provinceTotal: pending.length,
        });
        summary.provinces.push({ ...province, ...result, ok: true });
        if (result.skipped) {
          log.tick(`${province.name} — قبلاً تمام`);
        } else {
          log.tick(
            `${province.name} — ${result.items || 0} مجوز | مانده ${Math.max(0, pending.length - log.done)}`
          );
        }
        if (global.gc) global.gc();
      } catch (err) {
        log.error(`${province.name}: ${err.message}`);
        summary.provinces.push({ ...province, ok: false, error: err.message });
        log.tick(`${province.name} — خطا`);
      }
      html = await session.getHtml(PAGE_PATH);
    }

    summary.finishedAt = new Date();
    summary.okCount = summary.provinces.filter((p) => p.ok).length;
    summary.items = summary.provinces.reduce((n, p) => n + (p.items || 0), 0);
    await store.saveRun(summary);
    log.finish(
      `استان موفق ${summary.okCount}/${pending.length} | از قبل ${alreadyDone} | ${summary.items} مجوز`
    );
  } finally {
    await worker.terminate();
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
