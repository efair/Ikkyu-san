#!/usr/bin/env node
"use strict";

const { MongoClient } = require("mongodb");
const { Store, SOURCE } = require("./lib/store");
const C = require("./lib/imedClient");
const { Progress } = require("./lib/progress");

const PAGE_PATH = "/additionals/export_cert.aspx";
const args = C.parseCommonArgs(process.argv.slice(2));
const DELAY_MS = Number(args.delay || 1200);
const CAPTCHA_RETRIES = Number(args.captchaRetries || 8);

function usage() {
  console.log(`
صادرکنندگان دارای پروانه ساخت — export_cert

Usage:
  node imed_export_cert.js [options]

Options:
  --mongo <uri>
  --delay <ms>
  --captcha-retries <n>
  --no-resume
  --max-rows <n>           فقط n ردیف اول (تست)
`);
}

function dateHidden(html) {
  const names = [
    "ctl00$MainContent$IssueDate_From",
    "ctl00$MainContent$IssueDate_From$dateInput",
    "ctl00$MainContent$IssueDate_From$dateInput_ClientState",
    "ctl00$MainContent$IssueDate_From_ClientState",
    "ctl00_MainContent_IssueDate_From_calendar_SD",
    "ctl00_MainContent_IssueDate_From_calendar_AD",
    "ctl00$MainContent$IssueDate_To",
    "ctl00$MainContent$IssueDate_To$dateInput",
    "ctl00$MainContent$IssueDate_To$dateInput_ClientState",
    "ctl00$MainContent$IssueDate_To_ClientState",
    "ctl00_MainContent_IssueDate_To_calendar_SD",
    "ctl00_MainContent_IssueDate_To_calendar_AD",
  ];
  const extra = {};
  for (const name of names) extra[name] = C.hidden(html, name);
  return extra;
}

function parseExportMaster(html) {
  const cheerio = require("cheerio");
  const $ = cheerio.load(html);
  const $table = $("#ctl00_MainContent_RadGrid1 table.rgMasterTable").first();
  const headers = [];
  $table.find("thead th").each((_, el) => headers.push(C.cellText($(el))));
  const rows = [];
  $table.find("> tbody > tr.rgRow, > tbody > tr.rgAltRow").each((rowIndex, el) => {
    if ($(el).hasClass("rgDetailRow") || $(el).closest("table.rgDetailTable").length) return;
    const tds = $(el).children("td");
    if (tds.length < 4) return;
    const offset = C.dataOffset(tds);
    const href = tds.find("a[href*='Company'], a[href*='aspx']").first().attr("href");
    let detailsTarget = "";
    let detailsArg = "";
    tds.find("a").each((_, a) => {
      const href = $(a).attr("href") || "";
      const text = C.cellText($(a));
      const mm = href.match(/__doPostBack\('([^']+)','([^']*)'\)/);
      if (!mm) return;
      const target = C.decodeHtml(mm[1]);
      if (/LinkButton2|lbtnPeyvast|تصویر/i.test(target + text)) return;
      if (/LinkButton1/i.test(target) || /جزئ?یات/.test(text)) {
        detailsTarget = target;
        detailsArg = C.decodeHtml(mm[2]);
      }
    });
    rows.push({
      rowIndex,
      certNo: C.cellText(tds.eq(offset)),
      company: C.cellText(tds.eq(offset + 1)),
      companyUrl: C.absUrl(href),
      nationalId: C.cellText(tds.eq(offset + 2)),
      groupNameFa: C.cellText(tds.eq(offset + 3)),
      issueDate: C.cellText(tds.eq(offset + 4)),
      expiredDate: C.cellText(tds.eq(offset + 5)),
      detailsTarget,
      detailsArg,
      details: [],
    });
  });
  return rows;
}

function parseExportDetails(html) {
  const cheerio = require("cheerio");
  const $ = cheerio.load(html);
  const items = [];
  $("table.rgMasterTable tbody > tr.rgRow, table.rgMasterTable tbody > tr.rgAltRow").each(
    (_, el) => {
      const tds = $(el).children("td");
      if (tds.length < 4) return;
      const offset = C.dataOffset(tds);
      const nameFa = C.cellText(tds.eq(offset));
      const model = C.cellText(tds.eq(offset + 1));
      const umdns = C.cellText(tds.eq(offset + 2));
      const irc = C.cellText(tds.eq(offset + 3));
      const imd = C.cellText(tds.eq(offset + 4));
      const usability = C.cellText(tds.eq(offset + 5));
      if (!nameFa && !model && !irc) return;
      items.push({ nameFa, model, umdns, irc, imd, usability });
    }
  );
  return items;
}

function searchFields(html, captcha) {
  return {
    ...C.formState(html),
    ...dateHidden(html),
    "ctl00$MainContent$txt_company": "",
    "ctl00$MainContent$txt_Cert_No": "",
    "ctl00$MainContent$txt_KalaEn": "",
    "ctl00$MainContent$Txt_NationalId": "",
    "ctl00$MainContent$txtVerifyCode": captcha,
    "ctl00$MainContent$btn_Search": "جستجو",
  };
}

function nextPageFields(html, pageNumber) {
  const fields = searchFields(html, "");
  delete fields["ctl00$MainContent$btn_Search"];
  fields.__EVENTTARGET = "ctl00$MainContent$RadGrid1$ctl00";
  fields.__EVENTARGUMENT = `FireCommand:Page;${pageNumber}`;
  return fields;
}

function expandFields(html, target, argument) {
  const fields = searchFields(html, "");
  delete fields["ctl00$MainContent$btn_Search"];
  fields.__EVENTTARGET = target;
  fields.__EVENTARGUMENT = argument || "";
  return fields;
}

function isDetailsPage(html) {
  return /Export_Cert_Details/i.test(html) || (/نام وسیله/.test(html) && /حیطه کاربرد/.test(html));
}

async function collectDetails(session, firstHtml) {
  const items = parseExportDetails(firstHtml);
  let html = firstHtml;
  let info = C.parsePageInfo(html);
  const detailsPath = "/additionals/Export_Cert_Details.aspx";
  for (let page = 2; page <= info.pageCount; page++) {
    await C.sleep(300);
    html = await session.postForm(detailsPath, {
      ...C.formState(html),
      __EVENTTARGET: "ctl00$MainContent$RadGrid1$ctl00",
      __EVENTARGUMENT: `FireCommand:Page;${page}`,
    });
    const nextInfo = C.parsePageInfo(html);
    if (nextInfo.pageCount > info.pageCount) info.pageCount = nextInfo.pageCount;
    items.push(...parseExportDetails(html));
  }
  return items;
}

async function collectPage(session, store, listHtml, limit, log) {
  const rows = parseExportMaster(listHtml).slice(0, limit || undefined);
  if (log) log.setDetected(rows.length, "پروانه");
  let saved = 0;
  for (const row of rows) {
    if (row.certNo) {
      const existing = await store.licenses.findOne({
        source: SOURCE.EXPORT,
        certNo: row.certNo,
      });
      if (existing && Array.isArray(existing.details) && existing.details.length) {
        saved += 1;
        if (log) log.tick(`${row.certNo} (قبلاً ${existing.details.length} کالا)`);
        continue;
      }
    }
    if (row.detailsTarget) {
      await C.sleep(400);
      const detailsHtml = await session.postForm(
        PAGE_PATH,
        expandFields(listHtml, row.detailsTarget, row.detailsArg)
      );
      if (isDetailsPage(detailsHtml)) {
        row.details = await collectDetails(session, detailsHtml);
      }
    }
    saved += await store.saveExportRows([row]);
    if (log) log.tick(`${row.certNo || row.company} (${(row.details || []).length} کالا)`);
  }
  return { rows, html: listHtml, saved };
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

  const log = new Progress("export_cert");
  log.start("صادرکنندگان دارای پروانه ساخت");
  console.log("MongoDB:", mongoUri);

  if (!args.noResume && (await store.isJobDone(SOURCE.EXPORT, "all"))) {
    console.log("قبلاً تمام شده. برای اجرای مجدد --no-resume بزن.");
    await client.close();
    return;
  }

  const session = new C.Session(PAGE_PATH);
  const worker = await C.createOcrWorker();
  try {
    let html = await session.getHtml(PAGE_PATH);
    html = await C.searchWithCaptcha({
      session,
      worker,
      pagePath: PAGE_PATH,
      startHtml: html,
      buildFields: searchFields,
      parseRows: parseExportMaster,
      retries: CAPTCHA_RETRIES,
      delayMs: DELAY_MS,
      label: "export_cert",
    });

    const maxRows = Number(args.maxRows || 0);
    let remaining = maxRows || Infinity;
    let info = C.parsePageInfo(html);
    log.setSection(`صفحه 1/${info.pageCount}`);
    const first = await collectPage(session, store, html, remaining, log);
    html = first.html;
    remaining -= first.rows.length;
    let total = first.saved;

    for (let page = 2; page <= info.pageCount && remaining > 0; page++) {
      await C.sleep(DELAY_MS);
      html = await session.postForm(PAGE_PATH, nextPageFields(html, page));
      const nextInfo = C.parsePageInfo(html);
      if (nextInfo.pageCount > info.pageCount) info.pageCount = nextInfo.pageCount;
      log.setSection(`صفحه ${page}/${info.pageCount}`);
      const pageData = await collectPage(session, store, html, remaining, log);
      html = pageData.html;
      remaining -= pageData.rows.length;
      total += pageData.saved;
      if (!pageData.rows.length) break;
    }

    if (!maxRows) {
      await store.markJob(SOURCE.EXPORT, "all", {
        done: true,
        items: total,
        pages: info.pageCount,
        finishedAt: new Date(),
      });
    }
    await store.saveRun({
      source: SOURCE.EXPORT,
      okCount: 1,
      items: total,
      finishedAt: new Date(),
    });
    log.finish(`${total} پروانه`);
  } finally {
    await worker.terminate();
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
