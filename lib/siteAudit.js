"use strict";

const cheerio = require("cheerio");
const C = require("./imedClient");

function countGridRows(html) {
  const $ = cheerio.load(html);
  return $(
    "#ctl00_MainContent_RadGrid1 tr.rgRow, #ctl00_MainContent_RadGrid1 tr.rgAltRow, tr.rgRow, tr.rgAltRow"
  ).length;
}

function estimateFromPager(info, firstPageRows) {
  if (info.itemCount) return { siteCount: info.itemCount, method: "VirtualItemCount" };
  if (info.pageCount <= 1) return { siteCount: firstPageRows, method: "صفحه اول" };
  const size = info.pageSize || firstPageRows || 0;
  if (!size) return { siteCount: firstPageRows, method: "صفحه اول" };
  return {
    siteCount: (info.pageCount - 1) * size + firstPageRows,
    method: `تخمین ${info.pageCount} صفحه`,
    estimate: true,
  };
}

function verdict({ localCount, siteCount, doneJobs, expectedJobs }) {
  const jobsDone = !expectedJobs || doneJobs >= expectedJobs;
  if (siteCount == null) {
    if (!localCount) return { verdict: "empty", note: "هنوز داده‌ای ذخیره نشده" };
    if (!jobsDone) return { verdict: "incomplete", note: "کار ورکر تمام نشده" };
    return { verdict: "unknown", note: "شمارش سایت در دسترس نیست" };
  }
  if (!localCount && siteCount > 0) return { verdict: "incomplete", note: "سایت رکورد دارد ولی دیتابیس خالی است" };
  const ratio = siteCount ? localCount / siteCount : 1;
  if (ratio >= 0.98 && ratio <= 1.05 && jobsDone) {
    return { verdict: "complete", note: "تعداد محلی با سایت هم‌خوان است" };
  }
  if (ratio >= 0.9 && jobsDone) {
    return { verdict: "close", note: "نزدیک به سایت است؛ ممکن است چند رکورد تکراری یا جاافتاده باشد" };
  }
  return {
    verdict: "incomplete",
    note: localCount < siteCount ? "داده نسبت به سایت ناقص است" : "داده محلی بیشتر از سایت است",
  };
}

async function captchaSearch({ pagePath, buildFields, retries = 10 }) {
  const session = new C.Session(pagePath);
  const worker = await C.createOcrWorker();
  try {
    let html = await session.getHtml(pagePath);
    html = await C.searchWithCaptcha({
      session,
      worker,
      pagePath,
      startHtml: html,
      buildFields,
      parseRows: (h) => cheerio.load(h)("tr.rgRow, tr.rgAltRow").toArray(),
      retries,
      delayMs: 400,
      label: "audit",
    });
    return { session, html };
  } finally {
    await worker.terminate();
  }
}

function retailFields(html, captcha) {
  return {
    ...C.formState(html, ["ctl00$MainContent$txt_rad_DistCompany_ClientState"]),
    "ctl00$MainContent$txt_rad_DistCompany": "",
    "ctl00$MainContent$Txt_NationalId": "",
    "ctl00$MainContent$DRP_Province": "انتخاب کنید",
    "ctl00$MainContent$DRP_City": "",
    "ctl00$MainContent$Drp_CompanyType": "",
    "ctl00$MainContent$txtVerifyCode": captcha,
    "ctl00$MainContent$btn_search": "جستجو",
  };
}

function exportFields(html, captcha) {
  return {
    ...C.formState(html),
    "ctl00$MainContent$txt_company": "",
    "ctl00$MainContent$txt_Cert_No": "",
    "ctl00$MainContent$txt_KalaEn": "",
    "ctl00$MainContent$Txt_NationalId": "",
    "ctl00$MainContent$txtVerifyCode": captcha,
    "ctl00$MainContent$btn_Search": "جستجو",
  };
}

function treeFields(html, captcha) {
  return {
    ...C.formState(html),
    "ctl00$MainContent$txt_index": "",
    "ctl00$MainContent$txt_groupnamefa": "",
    "ctl00$MainContent$txtVerifyCode": captcha,
    "ctl00$MainContent$btn_Search": "جستجو",
  };
}

function distFields(html, captcha, provinceId) {
  return {
    ...C.formState(html),
    "ctl00$MainContent$drpDistOrGuild": "",
    "ctl00$MainContent$txt_rad_DistCompany": "",
    "ctl00$MainContent$drpDistType": "",
    "ctl00$MainContent$rad_txtTarafGharardad": "",
    "ctl00$MainContent$txtKalaName": "",
    "ctl00$MainContent$txt_ManuName": "",
    "ctl00$MainContent$drpProvince": provinceId,
    "ctl00$MainContent$DrpCity": "",
    "ctl00$MainContent$txtVerifyCode": captcha,
    "ctl00$MainContent$btn_Search": "جستجو",
  };
}

function importFields(html, captcha, nameFa) {
  return {
    ...C.formState(html),
    "ctl00$MainContent$txt_company": "",
    "ctl00$MainContent$txt_cmpCode": "",
    "ctl00$MainContent$DrpCity": "0",
    "ctl00$MainContent$txt_Country": "",
    "ctl00$MainContent$txt_Manuf": "",
    "ctl00$MainContent$txt_BossFamily": "",
    "ctl00$MainContent$txt_TechFamily": "",
    "ctl00$MainContent$Txt_NationalId": "",
    "ctl00$MainContent$Txt_umdns": "",
    "ctl00$MainContent$txt_KalaEn": "",
    "ctl00$MainContent$txt_Kala": nameFa,
    "ctl00$MainContent$txtVerifyCode": captcha,
    "ctl00$MainContent$btn_Search": "جستجو",
  };
}

function prodFields(html, captcha, groupId) {
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

async function gridAudit(pagePath, buildFields) {
  const { html } = await captchaSearch({ pagePath, buildFields });
  const firstPage = countGridRows(html);
  const info = C.parsePageInfo(html);
  const estimated = estimateFromPager(info, firstPage);
  return {
    ...estimated,
    firstPage,
    pageCount: info.pageCount,
    message: C.messageText(html),
  };
}

async function auditRetail() {
  return gridAudit("/Additionals/NewDistConfirmedRetailcmp.aspx", retailFields);
}

async function auditExport() {
  return gridAudit("/additionals/export_cert.aspx", exportFields);
}

async function auditTree() {
  return gridAudit("/Additionals/productTreeList.aspx", treeFields);
}

async function auditSearch() {
  const session = new C.Session("/SrchInAutoComplete/Search_UMDNSfnameonlychild.ashx?q=&limit=15000");
  const text = await session.getHtml("/SrchInAutoComplete/Search_UMDNSfnameonlychild.ashx?q=&limit=15000");
  const raw = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const unique = new Set(raw);
  return { siteCount: unique.size, rawLines: raw.length, method: "فهرست autocomplete" };
}

async function auditDist(onProgress) {
  const pagePath = "/additionals/AllAllowedDist.aspx";
  const session = new C.Session(pagePath);
  const worker = await C.createOcrWorker();
  try {
    let html = await session.getHtml(pagePath);
    const provinces = C.parseSelectOptions(html, "#ctl00_MainContent_drpProvince").filter((p) => p.id);
    let siteCount = 0;
    const samples = [];
    for (let i = 0; i < provinces.length; i++) {
      const province = provinces[i];
      if (onProgress) onProgress(`استان ${i + 1}/${provinces.length} — ${province.name}`);
      html = await session.getHtml(pagePath);
      html = await C.searchWithCaptcha({
        session,
        worker,
        pagePath,
        startHtml: html,
        buildFields: (h, captcha) => distFields(h, captcha, province.id),
        parseRows: (h) => cheerio.load(h)("tr.rgRow, tr.rgAltRow").toArray(),
        retries: 10,
        delayMs: 350,
        label: province.name,
      });
      const firstPage = countGridRows(html);
      const info = C.parsePageInfo(html);
      const estimated = estimateFromPager(info, firstPage);
      siteCount += estimated.siteCount;
      samples.push({ name: province.name, siteCount: estimated.siteCount, pageCount: info.pageCount });
    }
    return { siteCount, method: "جمع استان‌ها", samples, expectedJobs: provinces.length };
  } finally {
    await worker.terminate();
  }
}

async function auditProd(db, onProgress) {
  const pagePath = "/Additionals/prodconfirmedcmp.aspx";
  const session = new C.Session(pagePath);
  let html = await session.getHtml(pagePath);
  const groups = C.parseSelectOptions(html, "#ctl00_MainContent_drpGroup").filter(
    (g) => g.id && g.id !== "0"
  );
  const localGroups = await db.collection("product_groups").countDocuments({ source: "prodconfirmedcmp" });
  const sampleIds = groups.slice(0, 4).map((g) => g.id);
  const worker = await C.createOcrWorker();
  const samples = [];
  try {
    for (let i = 0; i < sampleIds.length; i++) {
      const group = groups.find((g) => g.id === sampleIds[i]);
      if (onProgress) onProgress(`نمونه گروه ${i + 1}/${sampleIds.length} — ${group.name}`);
      html = await session.getHtml(pagePath);
      html = await C.searchWithCaptcha({
        session,
        worker,
        pagePath,
        startHtml: html,
        buildFields: (h, captcha) => prodFields(h, captcha, group.id),
        parseRows: (h) => cheerio.load(h)("tr.rgRow, tr.rgAltRow").toArray(),
        retries: 8,
        delayMs: 350,
        label: group.name,
      });
      const firstPage = countGridRows(html);
      const info = C.parsePageInfo(html);
      const estimated = estimateFromPager(info, firstPage);
      const local = await db.collection("products").countDocuments({
        source: "prodconfirmedcmp",
        "group.id": group.id,
      });
      samples.push({
        name: group.name,
        siteCount: estimated.siteCount,
        localCount: local,
        match: local >= estimated.siteCount * 0.95,
      });
    }
  } finally {
    await worker.terminate();
  }
  return {
    siteCount: null,
    siteGroups: groups.length,
    localGroups,
    method: "گروه‌ها + نمونه",
    samples,
    expectedJobs: groups.length,
  };
}

async function auditNamedSearch(db, { pagePath, source, kind, onProgress }) {
  const names = await db
    .collection("product_search")
    .find({}, { projection: { name: 1 } })
    .limit(5)
    .toArray();
  const session = new C.Session(pagePath);
  const worker = await C.createOcrWorker();
  const samples = [];
  try {
    for (let i = 0; i < names.length; i++) {
      const name = names[i].name;
      if (onProgress) onProgress(`نمونه ${i + 1}/${names.length} — ${name}`);
      let html = await session.getHtml(pagePath);
      html = await C.searchWithCaptcha({
        session,
        worker,
        pagePath,
        startHtml: html,
        buildFields: (h, captcha) => importFields(h, captcha, name),
        parseRows: (h) => cheerio.load(h)("tr.rgRow, tr.rgAltRow").toArray(),
        retries: 8,
        delayMs: 350,
        label: name,
      });
      const siteCount = countGridRows(html) || (/موردی وجود ندارد/.test(C.messageText(html)) ? 0 : 0);
      const localCount = await db.collection("licenses").countDocuments({
        source,
        kind,
        searchNames: name,
      });
      samples.push({ name, siteCount, localCount, match: siteCount === localCount || (siteCount === 0 && localCount === 0) });
    }
  } finally {
    await worker.terminate();
  }
  const expectedJobs = await db.collection("product_search").countDocuments();
  return { siteCount: null, method: "نمونه نام کالا", samples, expectedJobs };
}

async function auditEquipment(db, onProgress) {
  const names = await db.collection("product_search").find({}, { projection: { name: 1 } }).limit(200).toArray();
  const tokens = new Set();
  for (const doc of names) {
    String(doc.name || "")
      .split(/[\s\/\\|_+,،؛:.*()[\]{}«»]+/)
      .filter((part) => [...part].length >= 3 && part !== "و")
      .forEach((part) => tokens.add(part));
  }
  const sample = [...tokens].slice(0, 3);
  const session = new C.Session("/additionals/cmpeqpreport.aspx");
  const samples = [];
  for (let i = 0; i < sample.length; i++) {
    const token = sample[i];
    if (onProgress) onProgress(`نمونه ${i + 1}/${sample.length} — ${token}`);
    let html = await session.getHtml("/additionals/cmpeqpreport.aspx");
    html = await session.postForm("/additionals/cmpeqpreport.aspx", {
      ...C.formState(html),
      "ctl00$MainContent$txtEqName": token,
      "ctl00$MainContent$btnSubmit": "جستجو",
    });
    const $ = cheerio.load(html);
    const msg = C.cellText($("#ctl00_MainContent_lblMsg"));
    const m = msg.match(/(\d+)/);
    const siteCount = m ? Number(m[1]) : cheerio.load(html)("tr").length;
    const localCount = await db.collection("imported_equipment").countDocuments({
      searchNames: token,
    });
    samples.push({ name: token, siteCount, localCount, message: msg });
  }
  return {
    siteCount: null,
    method: "نمونه توکن + شغل‌های part:",
    samples,
    expectedJobs: tokens.size,
  };
}

async function auditProfiles(db) {
  const total = await db.collection("companies").countDocuments();
  const withUrl = await db.collection("companies").countDocuments({ profileUrl: { $exists: true, $ne: "" } });
  const fetched = await db.collection("companies").countDocuments({ profileFetchedAt: { $exists: true } });
  return {
    siteCount: withUrl,
    method: "شرکت‌های دارای لینک پروفایل",
    pending: Math.max(0, withUrl - fetched),
    expectedJobs: withUrl,
    extra: { total, withUrl, fetched },
  };
}

async function runAudit(worker, db, onProgress) {
  switch (worker.audit) {
    case "retail":
      return auditRetail();
    case "export":
      return auditExport();
    case "tree":
      return auditTree();
    case "search":
      return auditSearch();
    case "dist":
      return auditDist(onProgress);
    case "prod":
      return auditProd(db, onProgress);
    case "import":
      return auditNamedSearch(db, {
        pagePath: "/Additionals/srchconfirmedimedcompany.aspx",
        source: "srchconfirmedimedcompany",
        kind: "import",
        onProgress,
      });
    case "foriati":
      return auditNamedSearch(db, {
        pagePath: "/Additionals/SrchConfirmedImedCompanyForiati.aspx",
        source: "srchconfirmedimedcompanyforiati",
        kind: "import_foriati",
        onProgress,
      });
    case "equipment":
      return auditEquipment(db, onProgress);
    case "profiles":
      return auditProfiles(db);
    default:
      return { siteCount: null, method: "تعریف نشده" };
  }
}

module.exports = { runAudit, verdict, estimateFromPager };
