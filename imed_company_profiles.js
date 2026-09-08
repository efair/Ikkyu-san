#!/usr/bin/env node
"use strict";

/**
 * غنی‌سازی پروفایل شرکت‌ها از صفحه CompanyInfoCmp.aspx
 * شرکت‌ها را با شناسه ملی / imedId مشترک نگه می‌دارد تا صفحات بعدی هم همان رکورد را پر کنند.
 */

const dns = require("dns");
const https = require("https");
const { URL } = require("url");
const { MongoClient } = require("mongodb");
const { Store, SOURCE, parseCompanyPage } = require("./lib/store");

const HOST = "report.imed.ir";
const FALLBACK_IP = process.env.IMED_IP || "10.3.118.72";
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017";
const DB_NAME = "devices";
const DELAY_MS = Number(process.env.DELAY_MS || 800);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function replyLookup(callback, options, address, family = 4) {
  if (options && options.all) {
    const list = Array.isArray(address)
      ? address
      : [{ address, family }];
    return callback(null, list);
  }
  if (Array.isArray(address)) {
    const first = address[0] || { address: FALLBACK_IP, family: 4 };
    return callback(null, first.address, first.family || 4);
  }
  return callback(null, address, family);
}

function lookup(hostname, options, callback) {
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  if (hostname !== HOST) return dns.lookup(hostname, options, callback);
  dns.lookup(hostname, options, (err, address, family) => {
    if (err || !address || (Array.isArray(address) && !address.length)) {
      return replyLookup(callback, options, FALLBACK_IP, 4);
    }
    return replyLookup(callback, options, address, family);
  });
}

const agent = new https.Agent({
  keepAlive: true,
  rejectUnauthorized: false,
  servername: HOST,
  lookup,
  autoSelectFamily: false,
});

function getHtml(urlPath) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: HOST,
        port: 443,
        path: urlPath,
        method: "GET",
        agent,
        headers: {
          Host: HOST,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        servername: HOST,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      }
    );
    req.on("error", reject);
    req.setTimeout(30000, () => req.destroy(new Error("timeout")));
    req.end();
  });
}

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  const store = new Store(db);
  await store.init();

  const query = {
    profileUrl: { $exists: true, $ne: "" },
    $or: [{ profileFetchedAt: { $exists: false } }, { profileFetchedAt: null }],
  };
  const total = await db.collection("companies").countDocuments(query);
  console.log(`غنی‌سازی پروفایل ${total} شرکت ...`);

  const cursor = db.collection("companies").find(query).batchSize(50);
  let ok = 0;
  let fail = 0;
  while (await cursor.hasNext()) {
    const company = await cursor.next();
    try {
      const u = new URL(company.profileUrl);
      await sleep(DELAY_MS);
      const html = await getHtml(u.pathname + u.search);
      const profile = parseCompanyPage(html, company.profileUrl);
      await store.upsertCompany({
        ...profile,
        source: SOURCE.PROD_LICENSE,
        role: "manufacturer",
      });
      await db.collection("companies").updateOne(
        { _id: company._id },
        { $set: { profileFetchedAt: new Date() } }
      );
      ok += 1;
      if (ok % 25 === 0) console.log(`  ok=${ok} fail=${fail}`);
    } catch (err) {
      fail += 1;
      console.error(`  خطا ${company.nationalId || company.name}:`, err.message);
    }
  }

  console.log(`تمام. ok=${ok} fail=${fail}`);
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
