"use strict";

const cheerio = require("cheerio");
const C = require("./imedClient");

function countTopLevelRows(html) {
  const $ = cheerio.load(html);
  let n = $(
    "#ctl00_MainContent_RadGrid1 > table.rgMasterTable > tbody > tr.rgRow, #ctl00_MainContent_RadGrid1 > table.rgMasterTable > tbody > tr.rgAltRow"
  ).length;
  if (n) return n;
  n = 0;
  $("#ctl00_MainContent_RadGrid1 tr.rgRow, #ctl00_MainContent_RadGrid1 tr.rgAltRow").each((_, el) => {
    if ($(el).closest("table.rgDetailTable").length) return;
    n += 1;
  });
  return n;
}

function stripSearchButtons(fields) {
  const out = { ...fields };
  for (const key of Object.keys(out)) {
    if (/btn_?search|btn_?serach|btnSubmit/i.test(key)) delete out[key];
  }
  return out;
}

function pageJumpFields(html, pageNumber, sticky = {}) {
  return {
    ...C.formState(html),
    ...sticky,
    __EVENTTARGET: "ctl00$MainContent$RadGrid1$ctl00",
    __EVENTARGUMENT: `FireCommand:Page;${pageNumber}`,
  };
}

/**
 * تعداد رکورد سطح‌اول یک نتیجهٔ جستجو:
 * - بدون صفحه‌بندی: تعداد ردیف جدول
 * - با صفحه‌بندی: رفتن به صفحه آخر → (pageCount-1)*pageSize + lastPageRows
 */
async function countPagedResult({
  session,
  pagePath,
  html,
  stickyFields = {},
  onProgress,
  label = "",
}) {
  const firstRows = countTopLevelRows(html);
  const info = C.parsePageInfo(html);
  const pageCount = Math.max(1, info.pageCount || 1);
  const pageSize = info.pageSize || firstRows || 0;
  const prefix = label ? `${label} | ` : "";

  if (pageCount <= 1 || !info.allowPaging) {
    if (onProgress) onProgress(`${prefix}بدون صفحه‌بندی — ${firstRows} رکورد`);
    return {
      siteCount: firstRows,
      firstPageRows: firstRows,
      lastPageRows: firstRows,
      pageCount: 1,
      pageSize: pageSize || firstRows,
      method: "جدول بدون صفحه‌بندی",
      message: C.messageText(html),
    };
  }

  if (onProgress) {
    onProgress(
      `${prefix}صفحه ۱/${pageCount} — اندازه صفحه ${pageSize || firstRows} — در حال رفتن به صفحه آخر`
    );
  }

  const lastPage = pageCount;
  const sticky = stripSearchButtons(stickyFields);
  let lastHtml = await session.postForm(pagePath, pageJumpFields(html, lastPage, sticky));
  let lastRows = countTopLevelRows(lastHtml);
  let lastInfo = C.parsePageInfo(lastHtml);

  // اگر ایندکس صفحه درست نرفت، یک‌بار دیگر با pageCount تازه‌شده تلاش کن
  if (lastInfo.currentPage && lastInfo.currentPage !== lastPage && lastInfo.pageCount >= lastPage) {
    lastHtml = await session.postForm(pagePath, pageJumpFields(lastHtml, lastPage, sticky));
    lastRows = countTopLevelRows(lastHtml);
    lastInfo = C.parsePageInfo(lastHtml);
  }

  const size = pageSize || firstRows || lastInfo.pageSize || 0;
  const siteCount = size > 0 ? (pageCount - 1) * size + lastRows : lastRows;

  if (onProgress) {
    onProgress(
      `${prefix}صفحه آخر ${lastPage}/${pageCount} — ${lastRows} ردیف | جمع ${(pageCount - 1)}×${size}+${lastRows}=${siteCount}`
    );
  }

  return {
    siteCount,
    firstPageRows: firstRows,
    lastPageRows: lastRows,
    pageCount,
    pageSize: size,
    method: `صفحه آخر (${pageCount} صفحه، ${size}تایی + ${lastRows})`,
    message: C.messageText(lastHtml),
  };
}

function stickyFromBuildFields(html, buildFields, captchaPlaceholder = "00000") {
  try {
    return stripSearchButtons(buildFields(html, captchaPlaceholder) || {});
  } catch {
    return {};
  }
}

async function captchaSearch({ pagePath, buildFields, retries = 10, label = "audit" }) {
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
      parseRows: (h) => {
        const n = countTopLevelRows(h);
        return n ? new Array(n).fill(1) : [];
      },
      retries,
      delayMs: 400,
      label,
    });
    return { session, worker, html };
  } catch (err) {
    await worker.terminate();
    throw err;
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
    "ctl00$MainContent$txt_Kala": nameFa || "",
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

async function gridAudit(pagePath, buildFields, onProgress) {
  if (onProgress) onProgress("ورود به صفحه و حل کپچا");
  const { session, worker, html } = await captchaSearch({ pagePath, buildFields });
  try {
    const sticky = stickyFromBuildFields(html, buildFields);
    const counted = await countPagedResult({
      session,
      pagePath,
      html,
      stickyFields: sticky,
      onProgress,
    });
    return counted;
  } finally {
    await worker.terminate();
  }
}

async function auditRetail(onProgress) {
  return gridAudit("/Additionals/NewDistConfirmedRetailcmp.aspx", retailFields, onProgress);
}

async function auditExport(onProgress) {
  return gridAudit("/additionals/export_cert.aspx", exportFields, onProgress);
}

async function auditTree(onProgress) {
  return gridAudit("/Additionals/productTreeList.aspx", treeFields, onProgress);
}

async function auditSearch(onProgress) {
  if (onProgress) onProgress("دریافت فهرست autocomplete");
  const session = new C.Session("/SrchInAutoComplete/Search_UMDNSfnameonlychild.ashx?q=&limit=15000");
  const text = await session.getHtml("/SrchInAutoComplete/Search_UMDNSfnameonlychild.ashx?q=&limit=15000");
  const raw = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const unique = new Set(raw);
  if (onProgress) onProgress(`فهرست کالا — ${unique.size} نام یکتا`);
  return { siteCount: unique.size, rawLines: raw.length, method: "فهرست autocomplete" };
}

async function sumFieldAudits({
  pagePath,
  items,
  buildFieldsForItem,
  onProgress,
  itemLabel = (it) => it.name || it.id,
}) {
  const session = new C.Session(pagePath);
  const worker = await C.createOcrWorker();
  let siteCount = 0;
  const samples = [];
  try {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const label = itemLabel(item);
      if (onProgress) {
        onProgress(`فیلد ${i + 1}/${items.length} — ${label} | جمع تا الان ${siteCount}`);
      }
      let html = await session.getHtml(pagePath);
      html = await C.searchWithCaptcha({
        session,
        worker,
        pagePath,
        startHtml: html,
        buildFields: (h, captcha) => buildFieldsForItem(h, captcha, item),
        parseRows: (h) => {
          const n = countTopLevelRows(h);
          return n ? new Array(n).fill(1) : [];
        },
        retries: 10,
        delayMs: 350,
        label,
      });

      if (/موردی وجود ندارد/.test(C.messageText(html)) && countTopLevelRows(html) === 0) {
        samples.push({ name: label, siteCount: 0, pageCount: 0 });
        if (onProgress) {
          onProgress(`فیلد ${i + 1}/${items.length} — ${label}: 0 | جمع ${siteCount}`);
        }
        continue;
      }

      const sticky = stickyFromBuildFields(html, (h, c) => buildFieldsForItem(h, c, item));
      const counted = await countPagedResult({
        session,
        pagePath,
        html,
        stickyFields: sticky,
        onProgress,
        label: `${i + 1}/${items.length} ${label}`,
      });
      siteCount += counted.siteCount;
      samples.push({
        name: label,
        siteCount: counted.siteCount,
        pageCount: counted.pageCount,
        pageSize: counted.pageSize,
        lastPageRows: counted.lastPageRows,
      });
      if (onProgress) {
        onProgress(
          `فیلد ${i + 1}/${items.length} — ${label}: ${counted.siteCount} | جمع کل ${siteCount}`
        );
      }
    }
  } finally {
    await worker.terminate();
  }
  return {
    siteCount,
    method: `جمع ${items.length} فیلد (سطح اول)`,
    samples,
    expectedJobs: items.length,
  };
}

async function auditDist(onProgress) {
  const pagePath = "/additionals/AllAllowedDist.aspx";
  if (onProgress) onProgress("خواندن لیست استان‌ها");
  const session = new C.Session(pagePath);
  const html = await session.getHtml(pagePath);
  const provinces = C.parseSelectOptions(html, "#ctl00_MainContent_drpProvince").filter((p) => p.id);
  return sumFieldAudits({
    pagePath,
    items: provinces,
    buildFieldsForItem: (h, captcha, province) => distFields(h, captcha, province.id),
    onProgress,
    itemLabel: (p) => p.name,
  });
}

async function auditProd(db, onProgress) {
  const pagePath = "/Additionals/prodconfirmedcmp.aspx";
  if (onProgress) onProgress("خواندن لیست گروه‌های تخصصی");
  const session = new C.Session(pagePath);
  const html = await session.getHtml(pagePath);
  const groups = C.parseSelectOptions(html, "#ctl00_MainContent_drpGroup").filter(
    (g) => g.id && g.id !== "0"
  );
  const localGroups = await db.collection("product_groups").countDocuments({ source: "prodconfirmedcmp" });
  const result = await sumFieldAudits({
    pagePath,
    items: groups,
    buildFieldsForItem: (h, captcha, group) => prodFields(h, captcha, group.id),
    onProgress,
    itemLabel: (g) => g.name,
  });
  return {
    ...result,
    siteGroups: groups.length,
    localGroups,
    method: `جمع ${groups.length} گروه تخصصی (سطح اول جدول)`,
  };
}

async function auditNamedSearch(db, { pagePath, source, kind, onProgress }) {
  if (onProgress) onProgress("تلاش جستجوی خالی برای کل جدول سطح اول");
  // اول بدون نام کالا؛ اگر جدول آمد همان را بشمار
  try {
    const blank = await gridAudit(pagePath, (h, c) => importFields(h, c, ""), onProgress);
    if (blank.siteCount > 0) {
      const expectedJobs = await db.collection("product_search").countDocuments();
      return { ...blank, method: "جستجوی خالی — سطح اول", expectedJobs };
    }
  } catch (err) {
    if (onProgress) onProgress(`جستجوی خالی نشد: ${err.message} — شمارش با نام کالاها`);
  }

  const names = await db
    .collection("product_search")
    .find({}, { projection: { name: 1 } })
    .toArray();
  const items = names.map((d) => ({ id: d.name, name: d.name })).filter((x) => x.name);
  const result = await sumFieldAudits({
    pagePath,
    items,
    buildFieldsForItem: (h, captcha, item) => importFields(h, captcha, item.name),
    onProgress,
    itemLabel: (it) => it.name,
  });
  return {
    ...result,
    method: `جمع ${items.length} نام کالا (سطح اول؛ ممکن است شرکت تکراری بین نام‌ها باشد)`,
    source,
    kind,
  };
}

async function auditEquipment(db, onProgress) {
  const pagePath = "/additionals/cmpeqpreport.aspx";
  if (onProgress) onProgress("جستجوی خالی تجهیزات وارداتی");
  const session = new C.Session(pagePath);
  let html = await session.getHtml(pagePath);
  html = await session.postForm(pagePath, {
    ...C.formState(html),
    "ctl00$MainContent$txtEqName": "",
    "ctl00$MainContent$btnSubmit": "جستجو",
  });
  const $ = cheerio.load(html);
  const msg = C.cellText($("#ctl00_MainContent_lblMsg"));
  const m = msg.match(/(\d+)/);
  if (m) {
    const siteCount = Number(m[1]);
    if (onProgress) onProgress(`پیام سایت: ${msg} → ${siteCount}`);
    const expectedJobs = await db.collection("product_search").countDocuments();
    return { siteCount, method: "شمارش از پیام صفحه (جستجوی خالی)", message: msg, expectedJobs };
  }

  const counted = await countPagedResult({
    session,
    pagePath,
    html,
    onProgress,
    label: "تجهیزات",
  });
  const expectedJobs = await db.collection("product_search").countDocuments();
  return { ...counted, expectedJobs, message: msg };
}

async function auditProfiles(db, onProgress) {
  if (onProgress) onProgress("شمارش وضعیت پروفایل شرکت‌ها در دیتابیس");
  const total = await db.collection("companies").countDocuments();
  const withUrl = await db.collection("companies").countDocuments({
    profileUrl: { $exists: true, $ne: "" },
  });
  const fetched = await db.collection("companies").countDocuments({
    profileUrl: { $exists: true, $ne: "" },
    profileFetchedAt: { $exists: true, $ne: null },
  });
  const pending = Math.max(0, withUrl - fetched);
  if (onProgress) {
    onProgress(`هدف ${withUrl} | غنی‌شده ${fetched} | باقیمانده ${pending}`);
  }
  return {
    // هدف ورکر = شرکت‌های دارای لینک؛ نه شمارش زنده از سایت IMED
    siteCount: withUrl,
    method: "هدف: شرکت دارای لینک پروفایل | محلی: غنی‌شده",
    pending,
    expectedJobs: withUrl,
    extra: { total, withUrl, fetched, pending },
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

async function runAudit(worker, db, onProgress) {
  switch (worker.audit) {
    case "retail":
      return auditRetail(onProgress);
    case "export":
      return auditExport(onProgress);
    case "tree":
      return auditTree(onProgress);
    case "search":
      return auditSearch(onProgress);
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
      return auditProfiles(db, onProgress);
    default:
      return { siteCount: null, method: "تعریف نشده" };
  }
}

module.exports = {
  runAudit,
  verdict,
  countPagedResult,
  countTopLevelRows,
};
