#!/usr/bin/env node
"use strict";

const { MongoClient } = require("mongodb");
const cheerio = require("cheerio");
const { Store, SOURCE, parseCompanyPage } = require("./lib/store");
const C = require("./lib/imedClient");
const { Progress } = require("./lib/progress");

const PAGE_PATH = "/Additionals/prodconfirmedcmp.aspx";
const args = C.parseCommonArgs(process.argv.slice(2));
const DELAY_MS = Number(args.delay || 1200);
const CAPTCHA_RETRIES = Number(args.captchaRetries || 8);

function usage() {
  console.log(`
استعلام تولیدکنندگان دارای پروانه ساخت — report.imed.ir

Usage:
  node imed_prodconfirmedcmp.js [options]

Options:
  --mongo <uri>
  --group <id>             فقط همین گروه تخصصی
  --from <id>              از این گروه به بعد
  --delay <ms>
  --captcha-retries <n>
  --max-rows <n>           فقط n ردیف اول هر گروه (تست)
  --companies-only         فقط پروفایل شرکت‌ها (بدون مشاهده کالا و IRC)
  --no-resume
`);
}

function parseGrid(html) {
  const $ = cheerio.load(html);
  const rows = [];
  $("#ctl00_MainContent_RadGrid1 tr.rgRow, #ctl00_MainContent_RadGrid1 tr.rgAltRow").each(
    (_, el) => {
      const tds = $(el).children("td");
      if (tds.length < 8) return;
      const companyA = tds.eq(1).find("a").first();
      let productsTarget = "";
      let productsArg = "";
      tds.eq(8).find("a").each((__, a) => {
        const href = $(a).attr("href") || "";
        const mm = href.match(/__doPostBack\('([^']+)','([^']*)'\)/);
        if (mm && /LinkButton1/i.test(mm[1])) {
          productsTarget = C.decodeHtml(mm[1]);
          productsArg = C.decodeHtml(mm[2]);
        }
      });
      rows.push({
        company: C.cellText(companyA.length ? companyA : tds.eq(1)),
        companyUrl: C.absUrl(companyA.attr("href")),
        nationalId: C.cellText(tds.eq(2)),
        device: C.cellText(tds.eq(3)),
        method: C.cellText(tds.eq(4)),
        address: C.cellText(tds.eq(5)),
        certNo: C.cellText(tds.eq(6)),
        validDate: C.cellText(tds.eq(7)),
        productsTarget,
        productsArg,
        hasLicenseImage: tds.eq(9).find("a").length > 0,
        hasTechnicalAttachment: tds.eq(10).find("a").length > 0,
        hasProductAttachment: tds.eq(11).find("a").length > 0,
        hasCommitmentAttachment: tds.eq(12).find("a").length > 0,
      });
    }
  );
  return rows;
}

function searchFields(html, captcha, groupId) {
  return {
    ...C.formState(html),
    "ctl00$MainContent$txt_asker": "",
    "ctl00$MainContent$txt_UMDNSGroup": "",
    "ctl00$MainContent$drpGroup": groupId,
    "ctl00$MainContent$txt_kala": "",
    "ctl00$MainContent$drpMethod": " ",
    "ctl00$MainContent$txt_CertNo": "",
    "ctl00$MainContent$txtAddress": "",
    "ctl00$MainContent$txt_Brand": "",
    "ctl00$MainContent$Txt_NationalID": "",
    "ctl00$MainContent$txtVerifyCode": captcha,
    "ctl00$MainContent$btn_serach": "جستجو",
  };
}

function nextPageFields(html, groupId, pageNumber) {
  const fields = searchFields(html, "", groupId);
  delete fields["ctl00$MainContent$btn_serach"];
  fields.__EVENTTARGET = "ctl00$MainContent$RadGrid1$ctl00";
  fields.__EVENTARGUMENT = `FireCommand:Page;${pageNumber}`;
  return fields;
}

function productsFields(html, groupId, target, argument) {
  const fields = searchFields(html, "", groupId);
  delete fields["ctl00$MainContent$btn_serach"];
  fields.__EVENTTARGET = target;
  fields.__EVENTARGUMENT = argument || "";
  return fields;
}

function profilePath(companyUrl) {
  if (!companyUrl) return "";
  try {
    const u = new URL(companyUrl, C.ORIGIN + "/Additionals/");
    return u.pathname + u.search;
  } catch {
    return "";
  }
}

function parseGoods(html) {
  const $ = cheerio.load(html);
  const items = [];
  $("table.rgMasterTable tbody > tr.rgRow, table.rgMasterTable tbody > tr.rgAltRow").each(
    (_, el) => {
      const tds = $(el).children("td");
      if (tds.length < 8) return;
      const offset = C.dataOffset(tds);
      const ircA = tds.find("a[href*='IRCList']").first();
      items.push({
        legalCompany: C.cellText(tds.eq(offset)),
        legalCountry: C.cellText(tds.eq(offset + 1)),
        specialtyGroup: C.cellText(tds.eq(offset + 2)),
        productGroup: C.cellText(tds.eq(offset + 3)),
        nameFa: C.cellText(tds.eq(offset + 4)),
        nameEn: C.cellText(tds.eq(offset + 5)),
        deviceName: C.cellText(tds.eq(offset + 6)),
        model: C.cellText(tds.eq(offset + 7)),
        brand: C.cellText(tds.eq(offset + 8)),
        umdns: C.cellText(tds.eq(offset + 9)),
        method: C.cellText(tds.eq(offset + 10)),
        ircListUrl: C.absUrl(ircA.attr("href")),
        ircs: [],
      });
    }
  );
  return items;
}

function parseIrcs(html) {
  const $ = cheerio.load(html);
  const items = [];
  $("table.rgMasterTable tbody > tr.rgRow, table.rgMasterTable tbody > tr.rgAltRow").each(
    (_, el) => {
      const tds = $(el).children("td");
      if (tds.length < 2) return;
      const offset = C.dataOffset(tds);
      const irc = C.cellText(tds.eq(offset)).replace(/['"]/g, "");
      if (!irc) return;
      items.push({
        irc,
        distinctFa: C.cellText(tds.eq(offset + 1)),
        distinctEn: C.cellText(tds.eq(offset + 2)),
        gtin: C.cellText(tds.eq(offset + 3)).replace(/['"]/g, ""),
      });
    }
  );
  return items;
}

function isGoodsPage(html) {
  return /ProdConfirmedCmpDetails|فهرست کالاهای ثبت شده/i.test(html);
}

async function fetchAllIrcs(session, firstHtml, listPath) {
  const items = parseIrcs(firstHtml);
  let html = firstHtml;
  let info = C.parsePageInfo(html);
  for (let page = 2; page <= info.pageCount; page++) {
    await C.sleep(250);
    html = await session.postForm(listPath, {
      ...C.formState(html),
      __EVENTTARGET: "ctl00$MainContent$RadGrid1$ctl00",
      __EVENTARGUMENT: `FireCommand:Page;${page}`,
    });
    items.push(...parseIrcs(html));
  }
  return items;
}

async function fetchGoods(session, listHtml, groupId, row) {
  if (!row.productsTarget) return [];
  await C.sleep(400);
  let html = await session.postForm(
    PAGE_PATH,
    productsFields(listHtml, groupId, row.productsTarget, row.productsArg)
  );
  if (!isGoodsPage(html)) return [];

  const goods = parseGoods(html);
  let info = C.parsePageInfo(html);
  const detailsPath = "/Additionals/ProdConfirmedCmpDetails.aspx";
  for (let page = 2; page <= info.pageCount; page++) {
    await C.sleep(300);
    html = await session.postForm(detailsPath, {
      ...C.formState(html),
      __EVENTTARGET: "ctl00$MainContent$RadGrid1$ctl00",
      __EVENTARGUMENT: `FireCommand:Page;${page}`,
    });
    goods.push(...parseGoods(html));
  }

  for (const item of goods) {
    if (!item.ircListUrl) continue;
    await C.sleep(250);
    const path = profilePath(item.ircListUrl);
    const ircHtml = await session.getHtml(path);
    item.ircs = await fetchAllIrcs(session, ircHtml, path);
  }
  return goods;
}

async function enrichRows(session, store, listHtml, group, rows, profileCache, log) {
  for (const row of rows) {
    const cacheKey = row.nationalId || row.companyUrl;
    if (cacheKey && profileCache.has(cacheKey)) {
      row.profile = profileCache.get(cacheKey);
    } else if (row.companyUrl) {
      await C.sleep(DELAY_MS);
      const html = await session.getHtml(profilePath(row.companyUrl));
      row.profile = parseCompanyPage(html, row.companyUrl);
      if (!row.profile.name) row.profile.name = row.company;
      if (!row.profile.nationalId) row.profile.nationalId = row.nationalId;
      if (cacheKey) profileCache.set(cacheKey, row.profile);
    }
    if (args.companiesOnly) {
      row.goods = [];
    } else {
      row.goods = await fetchGoods(session, listHtml, group.id, row);
    }
    await store.saveProductionRows(group, [row]);
    if (log) {
      log.tick(
        `${row.company || row.profile?.name || row.certNo}${row.goods && row.goods.length ? ` (${row.goods.length} کالا)` : ""}`
      );
    }
  }
}

async function scrapeGroup(store, session, worker, group, startHtml, profileCache, log) {
  if (!args.noResume && (await store.isJobDone(SOURCE.PROD_LICENSE, group.id))) {
    if (log) log.skip(`${group.id} ${group.name} (قبلاً تمام شده)`);
    return { skipped: true, items: 0 };
  }

  if (log) log.setSection(`جستجو گروه ${group.id} — ${group.name}`);
  let html = await C.searchWithCaptcha({
    session,
    worker,
    pagePath: PAGE_PATH,
    startHtml,
    buildFields: (h, captcha) => searchFields(h, captcha, group.id),
    parseRows: parseGrid,
    retries: CAPTCHA_RETRIES,
    delayMs: DELAY_MS,
    label: group.name,
  });

  const maxRows = Number(args.maxRows || 0);
  let remaining = maxRows || Infinity;
  let info = C.parsePageInfo(html);
  let rows = parseGrid(html).slice(0, remaining || undefined);
  remaining -= rows.length;
  if (log) {
    log.setSection(`گروه ${group.id} — ${group.name} | صفحه 1/${info.pageCount}`);
    log.setDetected(rows.length, "ردیف");
  }
  await enrichRows(session, store, html, group, rows, profileCache, log);
  let total = rows.length;

  for (let page = 2; page <= info.pageCount && remaining > 0; page++) {
    await C.sleep(DELAY_MS);
    html = await session.postForm(PAGE_PATH, nextPageFields(html, group.id, page));
    const nextInfo = C.parsePageInfo(html);
    if (nextInfo.pageCount > info.pageCount) info.pageCount = nextInfo.pageCount;
    rows = parseGrid(html).slice(0, remaining || undefined);
    remaining -= rows.length;
    if (log) {
      log.setSection(`گروه ${group.id} — ${group.name} | صفحه ${page}/${info.pageCount}`);
      log.setDetected(rows.length, "ردیف");
    }
    await enrichRows(session, store, html, group, rows, profileCache, log);
    total += rows.length;
    if (!rows.length) break;
  }

  if (!maxRows) {
    await store.markJob(SOURCE.PROD_LICENSE, group.id, {
      done: true,
      name: group.name,
      pages: info.pageCount,
      items: total,
      finishedAt: new Date(),
    });
  }
  return { skipped: false, pages: info.pageCount, items: total };
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

  const log = new Progress("prodconfirmedcmp");
  log.start("تولیدکنندگان دارای پروانه ساخت");
  console.log("MongoDB:", mongoUri);

  const session = new C.Session(PAGE_PATH);
  const worker = await C.createOcrWorker();
  const profileCache = new Map();
  try {
    let html = await session.getHtml(PAGE_PATH);
    const groups = C.parseSelectOptions(html, "#ctl00_MainContent_drpGroup").filter(
      (g) => g.id && g.id !== "0"
    );
    if (!groups.length) throw new Error("لیست گروه تخصصی از صفحه خوانده نشد");

    await store.upsertProductGroups(
      SOURCE.PROD_LICENSE,
      groups.map((g) => ({ id: g.id, title: g.name, name: g.name }))
    );

    let selected = groups;
    if (args.group) {
      selected = groups.filter((g) => g.id === args.group);
      if (!selected.length) throw new Error(`گروه ${args.group} در لیست نیست`);
    } else if (args.from) {
      const idx = groups.findIndex((g) => g.id === args.from);
      if (idx < 0) throw new Error(`گروه شروع ${args.from} پیدا نشد`);
      selected = groups.slice(idx);
    }

    log.setDetected(selected.length, `گروه از ${groups.length}`);
    const summary = { source: SOURCE.PROD_LICENSE, startedAt: new Date(), groups: [] };
    let groupDone = 0;
    for (const group of selected) {
      log.setSection(`گروه ${groupDone + 1}/${selected.length} — ${group.name}`);
      try {
        const result = await scrapeGroup(store, session, worker, group, html, profileCache, log);
        summary.groups.push({ ...group, ...result, ok: true });
      } catch (err) {
        log.error(`گروه ${group.id}: ${err.message}`);
        summary.groups.push({ ...group, ok: false, error: err.message });
      }
      groupDone += 1;
      html = await session.getHtml(PAGE_PATH);
    }

    summary.finishedAt = new Date();
    summary.okCount = summary.groups.filter((g) => g.ok).length;
    await store.saveRun(summary);
    log.finish(`گروه موفق ${summary.okCount}/${selected.length}`);
  } finally {
    await worker.terminate();
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
