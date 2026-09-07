#!/usr/bin/env node
"use strict";

const { MongoClient } = require("mongodb");
const { Store, SOURCE } = require("./lib/store");
const C = require("./lib/imedClient");
const { Progress } = require("./lib/progress");

const PAGE_PATH = "/Additionals/productTreeList.aspx";
const args = C.parseCommonArgs(process.argv.slice(2));
const DELAY_MS = Number(args.delay || 800);
const CAPTCHA_RETRIES = Number(args.captchaRetries || 8);

function usage() {
  console.log(`
درختواره کالای تجهیزات پزشکی — productTreeList

Usage:
  node imed_product_tree.js [options]

Options:
  --mongo <uri>
  --delay <ms>
  --captcha-retries <n>
  --no-resume
  --max-rows <n>
`);
}

function parseTreeRows(html) {
  const cheerio = require("cheerio");
  const $ = cheerio.load(html);
  const $table = $("#ctl00_MainContent_RadGrid1 table.rgMasterTable").first();
  const rows = [];
  $table.find("tbody > tr.rgRow, tbody > tr.rgAltRow").each((_, el) => {
    const tds = $(el).children("td");
    if (tds.length < 8) return;
    const offset = C.dataOffset(tds);
    rows.push({
      indexId: C.cellText(tds.eq(offset)),
      level1: C.cellText(tds.eq(offset + 1)),
      level2: C.cellText(tds.eq(offset + 2)),
      level3: C.cellText(tds.eq(offset + 3)),
      nature: C.cellText(tds.eq(offset + 4)),
      nameFa: C.cellText(tds.eq(offset + 5)),
      nameEn: C.cellText(tds.eq(offset + 6)),
      path: C.cellText(tds.eq(offset + 7)),
      riskClass: C.cellText(tds.eq(offset + 8)),
      insuranceCovered: C.cellText(tds.eq(offset + 9)),
      unlimitedDistribution: C.cellText(tds.eq(offset + 10)),
      singlePrescription: C.cellText(tds.eq(offset + 11)),
      hospitalSinglePrescription: C.cellText(tds.eq(offset + 12)),
      clinicDistribution: C.cellText(tds.eq(offset + 13)),
    });
  });
  return rows;
}

function searchFields(html, captcha) {
  return {
    ...C.formState(html, ["ctl00_MainContent_ctl00_TSM", "ctl00$MainContent$ctl00_TSM"]),
    "ctl00_MainContent_ctl00_TSM": C.hidden(html, "ctl00_MainContent_ctl00_TSM") || "",
    "ctl00$MainContent$txt_index": "",
    "ctl00$MainContent$txt_groupnamefa": "",
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

  const log = new Progress("product_tree");
  log.start("درختواره کالای تجهیزات پزشکی");
  console.log("MongoDB:", mongoUri);

  if (!args.noResume && !args.maxRows && (await store.isJobDone(SOURCE.PRODUCT_TREE, "all"))) {
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
      parseRows: parseTreeRows,
      retries: CAPTCHA_RETRIES,
      delayMs: DELAY_MS,
      label: "productTree",
    });

    let rows = parseTreeRows(html);
    let info = C.parsePageInfo(html);
    for (let page = 2; page <= info.pageCount; page++) {
      await C.sleep(DELAY_MS);
      html = await session.postForm(PAGE_PATH, nextPageFields(html, page));
      rows = rows.concat(parseTreeRows(html));
      const nextInfo = C.parsePageInfo(html);
      if (nextInfo.pageCount > info.pageCount) info.pageCount = nextInfo.pageCount;
    }

    const maxRows = Number(args.maxRows || 0);
    if (maxRows) rows = rows.slice(0, maxRows);

    log.setSection("ذخیره درختواره");
    log.setDetected(rows.length, "کالا");
    const result = await store.saveProductTreeRows(rows);
    log.done = result.saved;

    if (!maxRows) {
      await store.markJob(SOURCE.PRODUCT_TREE, "all", {
        done: true,
        items: result.saved,
        pages: info.pageCount,
        finishedAt: new Date(),
      });
    }
    await store.saveRun({
      source: SOURCE.PRODUCT_TREE,
      okCount: 1,
      items: result.saved,
      finishedAt: new Date(),
    });
    log.finish(`${result.saved} کالا`);
  } finally {
    await worker.terminate();
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
