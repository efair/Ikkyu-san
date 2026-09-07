#!/usr/bin/env node
"use strict";

const { MongoClient } = require("mongodb");
const { Store, SOURCE } = require("./lib/store");
const C = require("./lib/imedClient");
const { Progress } = require("./lib/progress");

const PAGE_PATH = "/SrchInAutoComplete/Search_UMDNSfnameonlychild.ashx?q=&limit=15000";
const args = C.parseCommonArgs(process.argv.slice(2));

function usage() {
  console.log(`
لیست کالاها برای جستجو — Search_UMDNSfnameonlychild

Usage:
  node imed_product_search.js [options]

Options:
  --mongo <uri>
  --no-resume
`);
}

function parseNames(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
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

  const log = new Progress("product_search");
  log.start("لیست کالاها برای جستجو");
  console.log("MongoDB:", mongoUri);

  if (!args.noResume && (await store.isJobDone(SOURCE.PRODUCT_SEARCH, "all"))) {
    console.log("قبلاً تمام شده. برای اجرای مجدد --no-resume بزن.");
    await client.close();
    return;
  }

  const session = new C.Session(PAGE_PATH);
  try {
    log.setSection("دریافت لیست");
    const text = await session.getHtml(PAGE_PATH);
    const names = parseNames(text);
    log.setDetected(names.length, "نام کالا");
    const result = await store.saveProductSearchRows(names);
    log.done = result.saved;

    await store.markJob(SOURCE.PRODUCT_SEARCH, "all", {
      done: true,
      items: result.saved,
      rawLines: names.length,
      finishedAt: new Date(),
    });
    await store.saveRun({
      source: SOURCE.PRODUCT_SEARCH,
      okCount: 1,
      items: result.saved,
      finishedAt: new Date(),
    });
    log.finish(`${result.saved} کالا`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
