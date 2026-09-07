#!/usr/bin/env node
"use strict";

const { MongoClient } = require("mongodb");
const { Store, SOURCE } = require("./lib/store");
const C = require("./lib/imedClient");
const { Progress } = require("./lib/progress");

const PAGE_PATH = "/Additionals/NewDistConfirmedRetailcmp.aspx";
const args = C.parseCommonArgs(process.argv.slice(2));
const DELAY_MS = Number(args.delay || 1200);
const CAPTCHA_RETRIES = Number(args.captchaRetries || 8);

function usage() {
  console.log(`
عرضه کنندگان مجاز — NewDistConfirmedRetailcmp

Usage:
  node imed_retailcmp.js [options]

Options:
  --mongo <uri>
  --delay <ms>
  --captcha-retries <n>
  --no-resume
  --max-rows <n>
`);
}

function parsePageUpdatedAt(html) {
  const cheerio = require("cheerio");
  const $ = cheerio.load(html);
  const text = C.cellText($("#ctl00_MainContent_lbl_Update"));
  const m = text.match(/(\d{4}\/\d{2}\/\d{2})/);
  return m ? m[1] : "";
}

function parseRetailRows(html) {
  const cheerio = require("cheerio");
  const $ = cheerio.load(html);
  const $table = $("#ctl00_MainContent_RadGrid1 table.rgMasterTable").first();
  const rows = [];
  $table.find("tbody > tr.rgRow, tbody > tr.rgAltRow").each((_, el) => {
    const tds = $(el).children("td");
    if (tds.length < 8) return;
    const offset = C.dataOffset(tds);
    const nameCell = tds.eq(offset);
    const a = nameCell.find("a").first();
    rows.push({
      distributorName: C.cellText(a.length ? a : nameCell),
      nationalId: C.cellText(tds.eq(offset + 1)),
      ceo: C.cellText(tds.eq(offset + 2)),
      validDate: C.cellText(tds.eq(offset + 3)),
      province: C.cellText(tds.eq(offset + 4)),
      city: C.cellText(tds.eq(offset + 5)),
      address: C.cellText(tds.eq(offset + 6)),
      gln: C.cellText(tds.eq(offset + 7)),
      phone: C.cellText(tds.eq(offset + 8)),
      distOrGuild: C.cellText(tds.eq(offset + 9)),
      distributorType: C.cellText(tds.eq(offset + 10)),
    });
  });
  return rows;
}

function searchFields(html, captcha) {
  return {
    ...C.formState(html, [
      "ctl00$MainContent$txt_rad_DistCompany_ClientState",
      "ctl00_MainContent_txt_rad_DistCompany_ClientState",
    ]),
    "ctl00$MainContent$txt_rad_DistCompany": "",
    "ctl00$MainContent$txt_rad_DistCompany_ClientState":
      C.hidden(html, "ctl00$MainContent$txt_rad_DistCompany_ClientState") ||
      C.hidden(html, "ctl00_MainContent_txt_rad_DistCompany_ClientState") ||
      "",
    "ctl00$MainContent$Txt_NationalId": "",
    "ctl00$MainContent$DRP_Province": "انتخاب کنید",
    "ctl00$MainContent$DRP_City": "",
    "ctl00$MainContent$Drp_CompanyType": "",
    "ctl00$MainContent$txtVerifyCode": captcha,
    "ctl00$MainContent$btn_search": "جستجو",
  };
}

function nextPageFields(html, pageNumber) {
  return {
    ...searchFields(html, ""),
    "ctl00$MainContent$btn_search": undefined,
    __EVENTTARGET: "ctl00$MainContent$RadGrid1$ctl00",
    __EVENTARGUMENT: `FireCommand:Page;${pageNumber}`,
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

  const log = new Progress("retailcmp");
  log.start("عرضه کنندگان مجاز");
  console.log("MongoDB:", mongoUri);

  if (!args.noResume && !args.maxRows && (await store.isJobDone(SOURCE.RETAIL, "all"))) {
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
      parseRows: parseRetailRows,
      retries: CAPTCHA_RETRIES,
      delayMs: DELAY_MS,
      label: "retail",
    });

    const pageUpdatedAt = parsePageUpdatedAt(html);
    log.setSection(`جستجو تمام شد | به‌روزرسانی صفحه ${pageUpdatedAt || "نامشخص"}`);

    const maxRows = Number(args.maxRows || 0);
    let remaining = maxRows || Infinity;
    let rows = parseRetailRows(html).slice(0, remaining || undefined);
    remaining -= rows.length;
    let info = C.parsePageInfo(html);
    log.setSection(`ذخیره مجوزها | صفحه 1/${info.pageCount}`);
    log.setDetected(rows.length, "مجوز");
    let result = await store.saveRetailRows(rows, pageUpdatedAt, (_saved, _total, row) => {
      log.tick(`${row.distributorName} — ${row.nationalId}`);
    });
    let total = result.saved;
    let linked = result.linked;

    for (let page = 2; page <= info.pageCount && remaining > 0; page++) {
      await C.sleep(DELAY_MS);
      const fields = nextPageFields(html, page);
      delete fields["ctl00$MainContent$btn_search"];
      html = await session.postForm(PAGE_PATH, fields);
      rows = parseRetailRows(html).slice(0, remaining || undefined);
      remaining -= rows.length;
      const nextInfo = C.parsePageInfo(html);
      if (nextInfo.pageCount > info.pageCount) info.pageCount = nextInfo.pageCount;
      log.setSection(`ذخیره مجوزها | صفحه ${page}/${info.pageCount}`);
      log.setDetected(rows.length, "مجوز");
      result = await store.saveRetailRows(rows, pageUpdatedAt, (_saved, _total, row) => {
        log.tick(`${row.distributorName} — ${row.nationalId}`);
      });
      total += result.saved;
      linked += result.linked;
      if (!rows.length) break;
    }

    if (!maxRows) {
      await store.markJob(SOURCE.RETAIL, "all", {
        done: true,
        items: total,
        linked,
        pageUpdatedAt,
        pages: info.pageCount,
        finishedAt: new Date(),
      });
    }
    await store.saveRun({
      source: SOURCE.RETAIL,
      okCount: 1,
      items: total,
      finishedAt: new Date(),
    });
    log.finish(`${total} مجوز | وصل به شرکت: ${linked}`);
  } finally {
    await worker.terminate();
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
