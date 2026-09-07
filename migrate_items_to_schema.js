#!/usr/bin/env node
"use strict";

/**
 * مهاجرت داده‌های تخت قبلی (items) به ساختار رابطه‌ای:
 * companies / licenses / products / ircs
 */

const { MongoClient } = require("mongodb");
const { Store, SOURCE } = require("./lib/store");

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017";
const DB_NAME = "devices";

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  const store = new Store(db);
  await store.init();

  const oldItems = db.collection("items");
  const total = await oldItems.countDocuments();
  console.log(`مهاجرت ${total} سند از items ...`);

  const cursor = oldItems.find({}).batchSize(200);
  let n = 0;
  while (await cursor.hasNext()) {
    const item = await cursor.next();
    const group = {
      id: String(item.groupId || ""),
      name: item.groupName || "",
    };
    await store.saveProductionRows(group, [
      {
        company: item.company,
        companyUrl: item.companyUrl,
        nationalId: item.nationalId,
        device: item.device,
        method: item.method,
        address: item.address,
        certNo: item.certNo,
        validDate: item.validDate,
        hasProductsLink: item.hasProductsLink,
        hasLicenseImage: item.hasLicenseImage,
        hasTechnicalAttachment: item.hasTechnicalAttachment,
        hasProductAttachment: item.hasProductAttachment,
        hasCommitmentAttachment: item.hasCommitmentAttachment,
      },
    ]);
    n += 1;
    if (n % 500 === 0) console.log(`  ${n}/${total}`);
  }

  console.log("تمام.");
  console.log({
    companies: await db.collection("companies").countDocuments(),
    licenses: await db.collection("licenses").countDocuments(),
    products: await db.collection("products").countDocuments(),
    ircs: await db.collection("ircs").countDocuments(),
  });
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
