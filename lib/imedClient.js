"use strict";

const dns = require("dns");
const https = require("https");
const { URL, URLSearchParams } = require("url");
const cheerio = require("cheerio");
const Tesseract = require("tesseract.js");

const HOST = "report.imed.ir";
const FALLBACK_IP = process.env.IMED_IP || "10.3.118.72";
const CAPTCHA_PATH = "/Piclogin.aspx";
const ORIGIN = `https://${HOST}`;
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017";
const DB_NAME = "devices";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function decodeHtml(s) {
  return String(s || "")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function cellText($el) {
  return $el.text().replace(/\s+/g, " ").trim();
}

function absUrl(href) {
  if (!href) return "";
  try {
    return new URL(href, ORIGIN + "/Additionals/").toString();
  } catch {
    return href;
  }
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
  // Node 20+ defaults autoSelectFamily=true and asks lookup for { all:true }.
  autoSelectFamily: false,
});

class Session {
  constructor(refererPath) {
    this.cookies = new Map();
    this.refererPath = refererPath || "/";
  }

  cookieHeader() {
    return [...this.cookies.entries()]
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  absorbCookies(setCookie) {
    const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    for (const raw of list) {
      const part = String(raw).split(";")[0];
      const eq = part.indexOf("=");
      if (eq < 1) continue;
      this.cookies.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
    }
  }

  request(method, urlPath, body) {
    const payload = body == null ? null : Buffer.from(String(body), "utf8");
    const headers = {
      Host: HOST,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "*/*",
      Origin: ORIGIN,
      Referer: ORIGIN + this.refererPath,
    };
    const jar = this.cookieHeader();
    if (jar) headers.Cookie = jar;
    if (payload) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      headers["Content-Length"] = payload.length;
    }

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: HOST,
          port: 443,
          path: urlPath,
          method,
          agent,
          headers,
          servername: HOST,
        },
        (res) => {
          this.absorbCookies(res.headers["set-cookie"]);
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            resolve({
              status: res.statusCode,
              headers: res.headers,
              buffer: Buffer.concat(chunks),
            });
          });
        }
      );
      req.on("error", reject);
      req.setTimeout(60000, () => {
        req.destroy(new Error("timeout"));
      });
      // اگر پاسخ شروع شد ولی بدنه طول کشید، جداگانه قطع کن
      req.on("socket", (socket) => {
        socket.setTimeout(90000, () => {
          socket.destroy(new Error("socket timeout"));
        });
      });
      if (payload) req.write(payload);
      req.end();
    });
  }

  async getHtml(urlPath) {
    const res = await this.request("GET", urlPath);
    return res.buffer.toString("utf8");
  }

  async getBuffer(urlPath) {
    const res = await this.request("GET", urlPath);
    return res.buffer;
  }

  async postForm(urlPath, fields) {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) continue;
      body.append(k, v == null ? "" : String(v));
    }
    const res = await this.request("POST", urlPath, body.toString());
    const html = res.buffer.toString("utf8");
    const loc = res.headers.location;
    const moved = html.match(/Object moved to <a href="([^"]+)"/i);
    const next = loc || (moved && decodeHtml(moved[1]));
    if (next && (res.status === 302 || res.status === 301 || moved)) {
      let dest;
      if (/^https?:\/\//i.test(next)) {
        const u = new URL(next);
        dest = u.pathname + u.search;
      } else if (next.startsWith("/")) {
        dest = next;
      } else {
        dest = urlPath.replace(/[^/]+$/, "") + next;
      }
      return this.getHtml(dest);
    }
    return html;
  }
}

function hidden(html, name) {
  const src = String(html || "");
  const escaped = String(name || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<input\\b[^>]*\\bname=["']${escaped}["'][^>]*>|<input\\b[^>]*\\bid=["']${escaped}["'][^>]*>`,
    "i"
  );
  const tag = src.match(re);
  if (!tag) return "";
  const val = tag[0].match(/\bvalue=["']([^"']*)["']/i);
  return val ? decodeHtml(val[1]) : "";
}

function formState(html, extraHidden = []) {
  const names = [
    "ctl00_MainContent_ScriptManager1_TSM",
    "__VIEWSTATE",
    "__VIEWSTATEGENERATOR",
    "__EVENTVALIDATION",
    "ctl00$MainContent$RadGrid1_ClientState",
    ...extraHidden,
  ];
  const state = {
    __EVENTTARGET: "",
    __EVENTARGUMENT: "",
  };
  for (const name of names) {
    const val = hidden(html, name);
    if (name === "ctl00_MainContent_ScriptManager1_TSM") {
      state.ctl00_MainContent_ScriptManager1_TSM = val;
    } else if (name === "ctl00$MainContent$RadGrid1_ClientState") {
      state["ctl00$MainContent$RadGrid1_ClientState"] = val || "";
    } else if (val !== "" || name.startsWith("__")) {
      state[name] = val;
    }
  }
  return state;
}

function parseSelectOptions(html, selector) {
  const src = String(html || "");
  // فقط برای select استان/گروه؛ با regex محدود به همان select
  const idMatch = String(selector || "").match(/#([A-Za-z0-9_:-]+)/);
  const selectId = idMatch ? idMatch[1] : "";
  let block = src;
  if (selectId) {
    const re = new RegExp(
      `<select[^>]*\\bid=["']${selectId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*>([\\s\\S]*?)<\\/select>`,
      "i"
    );
    const m = src.match(re);
    if (m) block = m[1];
  }
  const items = [];
  const optRe = /<option[^>]*\bvalue=["']([^"']*)["'][^>]*>([\s\S]*?)<\/option>/gi;
  let m;
  while ((m = optRe.exec(block))) {
    items.push({
      id: String(m[1] || "").trim(),
      name: decodeHtml(m[2]).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
    });
  }
  return items;
}

function parsePageInfo(html) {
  const block =
    html.match(/_gridTableViewsData":"(\[\{[\s\S]*?\}\])"/) ||
    html.match(/"PageCount":\d+[\s\S]{0,120}"CurrentPageIndex":\d+/);
  const src = block ? decodeHtml(block[1] || block[0]) : html;
  const pageCount = Number((src.match(/"PageCount":(\d+)/) || [])[1] || 1);
  const current = Number((src.match(/"CurrentPageIndex":(\d+)/) || [])[1] || 0);
  const pageSize = Number((src.match(/"PageSize":(\d+)/) || [])[1] || 0);
  const itemCount = Number(
    (src.match(/"VirtualItemCount":(\d+)/) || src.match(/"ItemCount":(\d+)/) || [])[1] || 0
  );
  const allow = /"AllowPaging":true/.test(src);
  return {
    pageCount: Math.max(1, pageCount),
    currentPage: current + 1,
    allowPaging: allow,
    pageSize,
    itemCount,
  };
}

function messageText(html) {
  const src = String(html || "");
  for (const id of [
    "ctl00_MainContent_lbl_msg",
    "ctl00_MainContent_lblMSG",
    "ctl00_MainContent_lbl_NoFile",
    "ctl00_MainContent_lblMsg",
  ]) {
    const re = new RegExp(
      `<[^>]+\\bid=["']${id}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`,
      "i"
    );
    const m = src.match(re);
    if (m) {
      const text = decodeHtml(m[1]).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      if (text) return text;
    }
  }
  return "";
}

function hasGridDataRows(html) {
  return /class=["'][^"']*\brgRow\b/i.test(html) || /class=["'][^"']*\brgAltRow\b/i.test(html);
}

function isCaptchaError(html, rows) {
  if (rows && rows.length > 0) return false;
  if (hasGridDataRows(html)) return false;
  const msg = messageText(html);
  return /کد|امني|امنی|captcha|verify|صحیح/i.test(msg) || /وارد/.test(msg);
}

function extractMasterTableHtml(html) {
  const src = String(html || "");
  const m =
    src.match(
      /<table\b[^>]*class=["'][^"']*\brgMasterTable\b[^"']*["'][^>]*>[\s\S]*?<\/table>/i
    ) ||
    src.match(
      /<table\b[^>]*id=["'][^"']*RadGrid1[^"']*["'][^>]*>[\s\S]*?<\/table>/i
    );
  return m ? m[0] : "";
}

function dataOffset(tds) {
  let i = 0;
  const first = cellText(tds.eq(0));
  if (!first || first === "+" || first === "-" || first === "»" || first === "«") i = 1;
  const next = cellText(tds.eq(i));
  if (/^\d+$/.test(next) && Number(next) < 100000) i += 1;
  return i;
}

function parseGridRows(html, mapRow) {
  const $ = cheerio.load(html);
  const rows = [];
  $("#ctl00_MainContent_RadGrid1 > table.rgMasterTable > tbody > tr.rgRow, #ctl00_MainContent_RadGrid1 > table.rgMasterTable > tbody > tr.rgAltRow").each(
    (_, el) => {
      const mapped = mapRow($(el), $);
      if (mapped) rows.push(mapped);
    }
  );
  if (rows.length) return rows;
  $("#ctl00_MainContent_RadGrid1 tr.rgRow, #ctl00_MainContent_RadGrid1 tr.rgAltRow").each(
    (_, el) => {
      if ($(el).closest("table.rgDetailTable").length) return;
      const mapped = mapRow($(el), $);
      if (mapped) rows.push(mapped);
    }
  );
  return rows;
}

function expandTargets(html) {
  const $ = cheerio.load(html);
  const targets = [];
  $("#ctl00_MainContent_RadGrid1 a").each((_, el) => {
    const href = $(el).attr("href") || "";
    const title = ($(el).attr("title") || $(el).text() || "").trim();
    const m = href.match(/__doPostBack\('([^']+)','([^']*)'\)/);
    if (!m) return;
    const target = decodeHtml(m[1]);
    const arg = decodeHtml(m[2]);
    if (
      /Expand|Detail|جزییات|جزئیات|مشاهده/i.test(target + title + $(el).text()) ||
      /rgExpand/i.test($(el).attr("class") || "")
    ) {
      targets.push({ target, argument: arg, label: title || cellText($(el)) });
    }
  });
  return targets;
}

async function createOcrWorker() {
  const worker = await Tesseract.createWorker("eng", 1);
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789",
    tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
  });
  return worker;
}

async function solveCaptcha(session, worker) {
  // چند بار OCR روی همان تصویر؛ اگر خالی بود تصویر تازه بگیر
  for (let round = 1; round <= 3; round++) {
    const img = await session.getBuffer(CAPTCHA_PATH);
    for (let tryOcr = 1; tryOcr <= 2; tryOcr++) {
      const { data } = await worker.recognize(img);
      const code = String(data.text || "").replace(/\D/g, "").slice(0, 5);
      if (code.length === 5) {
        return { code, confidence: data.confidence || 0 };
      }
    }
  }
  return { code: "", confidence: 0 };
}

async function searchWithCaptcha({
  session,
  worker,
  pagePath,
  startHtml,
  buildFields,
  parseRows,
  retries,
  delayMs,
  label,
}) {
  let html = startHtml;
  for (let attempt = 1; attempt <= retries; attempt++) {
    await sleep(delayMs);
    const captcha = await solveCaptcha(session, worker);
    console.log(`    [${label}] کپچا تلاش ${attempt}/${retries}`);
    if (captcha.code.length !== 5) {
      console.log(`    کپچا نامعتبر (${captcha.code || "خالی"}) — تلاش ${attempt}`);
      html = await session.getHtml(pagePath);
      continue;
    }
    console.log(`    کپچا: ${captcha.code} (اعتماد ${Math.round(captcha.confidence)}٪)`);
    await sleep(400);
    console.log(`    [${label}] ارسال فرم جستجو…`);
    const result = await session.postForm(pagePath, buildFields(html, captcha.code));
    console.log(
      `    [${label}] پاسخ جستجو دریافت شد (${Math.round(Buffer.byteLength(result, "utf8") / 1024)}KB)`
    );
    // برای تشخیص کپچا نیازی به پارس کامل جدول نیست (cheerio روی HTMLهای بزرگ OOM می‌سازد)
    const probeRows = hasGridDataRows(result) ? [{}] : [];
    if (isCaptchaError(result, probeRows)) {
      const msg = messageText(result) || "کپچا رد شد";
      console.log(`    ${msg} — تلاش ${attempt}`);
      html = result;
      continue;
    }
    return result;
  }
  throw new Error(`کپچا برای ${label} بعد از ${retries} تلاش حل نشد`);
}

function parseCommonArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === "--mongo") out.mongo = next, i++;
    else if (a === "--delay") out.delay = next, i++;
    else if (a === "--captcha-retries") out.captchaRetries = next, i++;
    else if (a === "--no-resume") out.noResume = true;
    else if (a === "--province") out.province = String(next), i++;
    else if (a === "--max-rows") out.maxRows = Number(next), i++;
    else if (a === "--group") out.group = String(next), i++;
    else if (a === "--from") out.from = String(next), i++;
    else if (a === "--companies-only") out.companiesOnly = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function pageFields(html, extra, pageNumber) {
  return {
    ...formState(html),
    ...extra,
    "ctl00$MainContent$txtVerifyCode": "",
    __EVENTTARGET: "ctl00$MainContent$RadGrid1$ctl00",
    __EVENTARGUMENT: `FireCommand:Page;${pageNumber}`,
  };
}

module.exports = {
  HOST,
  ORIGIN,
  CAPTCHA_PATH,
  MONGO_URI,
  DB_NAME,
  Session,
  sleep,
  decodeHtml,
  cellText,
  absUrl,
  hidden,
  formState,
  parseSelectOptions,
  parsePageInfo,
  messageText,
  isCaptchaError,
  hasGridDataRows,
  extractMasterTableHtml,
  parseGridRows,
  dataOffset,
  expandTargets,
  createOcrWorker,
  solveCaptcha,
  searchWithCaptcha,
  parseCommonArgs,
  pageFields,
};
