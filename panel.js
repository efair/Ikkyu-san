#!/usr/bin/env node
"use strict";

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { MongoClient, ObjectId } = require("mongodb");
const { MONGO_URI, DB_NAME } = require("./lib/imedClient");
const { WorkerManager } = require("./lib/workerManager");

const PORT = Number(process.env.PANEL_PORT || 5050);
const HOST = process.env.PANEL_HOST || "127.0.0.1";
const DEFAULT_USER = process.env.PANEL_USER || "admin";
const DEFAULT_PASSWORD = process.env.PANEL_PASSWORD || "imed1405";
const SESSION_SECRET = process.env.PANEL_SECRET || crypto.randomBytes(32).toString("hex");

const LICENSE_KINDS = {
  retail: "عرضه کنندگان مجاز",
  distribution: "توزیع کنندگان مجاز",
  export: "صادرکنندگان دارای پروانه ساخت",
  import: "شرکت های مجاز فعال در زمینه واردات تجهیزات و ملزومات پزشکی",
  import_foriati:
    "شرکت های وارد کننده دارای نمایندگی تامین کننده مجاز در زمینه واردات تجهیزات و ملزومات پزشکی",
};

const loginAttempts = new Map();

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function serialize(doc) {
  if (!doc) return null;
  const out = { ...doc, id: String(doc._id) };
  delete out._id;
  if (out.companyId) out.companyId = String(out.companyId);
  if (out.licenseId) out.licenseId = String(out.licenseId);
  if (out.productId) out.productId = String(out.productId);
  return out;
}

function searchFilter(q, fields) {
  const text = String(q || "").trim();
  if (!text || !fields.length) return {};
  const rx = new RegExp(escapeRegex(text), "i");
  return { $or: fields.map((field) => ({ [field]: rx })) };
}

function regexField(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  return new RegExp(escapeRegex(text), "i");
}

function applyExact(filter, req, keys) {
  for (const key of keys) {
    const value = String(req.query[key] || "").trim();
    if (value) filter[key] = value;
  }
}

function applyRegex(filter, req, mapping) {
  for (const [queryKey, field] of Object.entries(mapping)) {
    const rx = regexField(req.query[queryKey]);
    if (rx) filter[field] = rx;
  }
}

function combineFilters(...parts) {
  const clauses = parts.filter((part) => part && Object.keys(part).length);
  if (!clauses.length) return {};
  if (clauses.length === 1) return clauses[0];
  return { $and: clauses };
}

function cleanFacet(values) {
  return [...new Set((values || []).map((v) => String(v || "").trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "fa")
  );
}

function pageParams(req) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(50, Math.max(5, Number(req.query.pageSize) || 25));
  return { page, pageSize, skip: (page - 1) * pageSize, q: String(req.query.q || "").trim() };
}

function toObjectId(id) {
  if (!ObjectId.isValid(id)) return null;
  return new ObjectId(id);
}

function clientIp(req) {
  return req.ip || req.socket.remoteAddress || "local";
}

function tooManyLogins(ip) {
  const now = Date.now();
  const row = loginAttempts.get(ip) || { count: 0, start: now };
  if (now - row.start > 15 * 60 * 1000) {
    loginAttempts.set(ip, { count: 1, start: now });
    return false;
  }
  row.count += 1;
  loginAttempts.set(ip, row);
  return row.count > 20;
}

async function paginate(collection, filter, { page, pageSize, skip }, sort = { updatedAt: -1 }, projection) {
  let cursor = collection.find(filter);
  if (projection) cursor = cursor.project(projection);
  const [items, total] = await Promise.all([
    cursor.sort(sort).skip(skip).limit(pageSize).toArray(),
    collection.countDocuments(filter),
  ]);
  return {
    items: items.map(serialize),
    total,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

async function main() {
  const mongoUri = process.env.MONGO_URI || MONGO_URI;
  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db(DB_NAME);
  const users = db.collection("panel_users");
  await users.createIndex({ username: 1 }, { unique: true });
  await Promise.allSettled([
    db.collection("licenses").createIndex({ kind: 1 }),
    db.collection("licenses").createIndex({ type: 1 }),
    db.collection("companies").createIndex({ name: 1 }),
    db.collection("products").createIndex({ nameFa: 1 }),
    db.collection("imported_equipment").createIndex({ nameFa: 1 }),
  ]);

  const workers = new WorkerManager(db, __dirname);
  await workers.init();

  const existing = await users.findOne({ username: DEFAULT_USER });
  if (!existing) {
    await users.insertOne({
      username: DEFAULT_USER,
      passwordHash: await bcrypt.hash(DEFAULT_PASSWORD, 10),
      createdAt: new Date(),
    });
    console.log(`کاربر پنل ساخته شد: ${DEFAULT_USER} / ${DEFAULT_PASSWORD}`);
  }

  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(express.json({ limit: "200kb" }));
  app.use(
    session({
      name: "imed.sid",
      secret: SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    })
  );
  app.use("/assets", express.static(path.join(__dirname, "panel", "public", "assets")));

  function requireApi(req, res, next) {
    if (req.session && req.session.userId) return next();
    res.status(401).json({ error: "وارد نشده‌اید" });
  }

  function requirePage(req, res, next) {
    if (req.session && req.session.userId) return next();
    res.redirect("/login");
  }

  app.get("/login", (req, res) => {
    if (req.session && req.session.userId) return res.redirect("/");
    res.sendFile(path.join(__dirname, "panel", "public", "login.html"));
  });

  app.get("/", requirePage, (_req, res) => {
    res.sendFile(path.join(__dirname, "panel", "public", "app.html"));
  });

  app.post("/api/login", async (req, res) => {
    const ip = clientIp(req);
    if (tooManyLogins(ip)) {
      return res.status(429).json({ error: "تعداد تلاش ورود بیش از حد است. کمی بعد دوباره امتحان کنید." });
    }
    const username = String((req.body && req.body.username) || "").trim();
    const password = String((req.body && req.body.password) || "");
    const user = await users.findOne({ username });
    const ok = user && (await bcrypt.compare(password, user.passwordHash));
    if (!ok) return res.status(401).json({ error: "نام کاربری یا رمز عبور نادرست است" });
    req.session.userId = String(user._id);
    req.session.username = user.username;
    res.json({ username: user.username });
  });

  app.post("/api/logout", (req, res) => {
    req.session.destroy(() => {
      res.clearCookie("imed.sid");
      res.json({ ok: true });
    });
  });

  app.get("/api/me", requireApi, (req, res) => {
    res.json({ username: req.session.username });
  });

  app.post("/api/password", requireApi, async (req, res) => {
    const current = String((req.body && req.body.current) || "");
    const next = String((req.body && req.body.next) || "");
    if (next.length < 6) return res.status(400).json({ error: "رمز جدید باید حداقل ۶ کاراکتر باشد" });
    const user = await users.findOne({ _id: toObjectId(req.session.userId) });
    if (!user || !(await bcrypt.compare(current, user.passwordHash))) {
      return res.status(400).json({ error: "رمز فعلی نادرست است" });
    }
    await users.updateOne(
      { _id: user._id },
      { $set: { passwordHash: await bcrypt.hash(next, 10), updatedAt: new Date() } }
    );
    res.json({ ok: true });
  });

  const facetCache = new Map();
  async function cached(key, fn) {
    const hit = facetCache.get(key);
    if (hit && Date.now() - hit.at < 120000) return hit.value;
    const value = await fn();
    facetCache.set(key, { at: Date.now(), value });
    return value;
  }

  app.get("/api/facets", requireApi, async (req, res) => {
    const view = String(req.query.view || "");
    const province = String(req.query.province || "").trim();
    const out = {};
    if (view === "companies") {
      out.roles = await cached("roles", () => db.collection("companies").distinct("roles"));
      out.roles = cleanFacet(out.roles.flat ? out.roles.flat() : out.roles);
    } else if (view === "products") {
      out.methods = cleanFacet(await cached("methods", () => db.collection("products").distinct("method")));
      out.groups = await cached("product-groups", async () =>
        (await db.collection("product_groups").find({}).project({ id: 1, title: 1 }).sort({ title: 1 }).toArray()).map(
          (g) => ({ value: g.id, label: g.title || g.name || g.id })
        )
      );
    } else if (view === "retail" || view === "distribution") {
      const kind = view === "retail" ? "retail" : "distribution";
      out.provinces = cleanFacet(
        await cached(`prov-${kind}`, () => db.collection("licenses").distinct("province", { kind }))
      );
      const cityFilter = { kind };
      if (province) cityFilter.province = province;
      out.cities = cleanFacet(
        await db.collection("licenses").distinct("city", cityFilter)
      );
    } else if (view === "equipment") {
      out.countries = cleanFacet(
        await cached("eqp-countries", () => db.collection("imported_equipment").distinct("country"))
      );
    } else if (view === "tree") {
      out.level1 = cleanFacet(await cached("tree-l1", () => db.collection("product_tree").distinct("level1")));
      out.riskClass = cleanFacet(await cached("tree-risk", () => db.collection("product_tree").distinct("riskClass")));
      out.nature = cleanFacet(await cached("tree-nature", () => db.collection("product_tree").distinct("nature")));
    }
    res.json(out);
  });

  app.get("/api/stats", requireApi, async (_req, res) => {
    const kinds = await db
      .collection("licenses")
      .aggregate([{ $group: { _id: "$kind", count: { $sum: 1 } } }])
      .toArray();
    const byKind = Object.fromEntries(kinds.map((row) => [row._id, row.count]));
    const [companies, products, licenses, equipment, productTree, productSearch, productGroups] =
      await Promise.all([
        db.collection("companies").countDocuments(),
        db.collection("products").countDocuments(),
        db.collection("licenses").countDocuments(),
        db.collection("imported_equipment").countDocuments(),
        db.collection("product_tree").countDocuments(),
        db.collection("product_search").countDocuments(),
        db.collection("product_groups").countDocuments(),
      ]);
    res.json({
      companies,
      products,
      licenses,
      equipment,
      productTree,
      productSearch,
      productGroups,
      licenseKinds: Object.entries(LICENSE_KINDS).map(([kind, label]) => ({
        kind,
        label,
        count: byKind[kind] || 0,
      })),
    });
  });

  app.get("/api/companies", requireApi, async (req, res) => {
    const p = pageParams(req);
    const extra = {};
    if (req.query.role) extra.roles = String(req.query.role);
    applyRegex(extra, req, { nationalId: "nationalId", ceo: "ceo" });
    if (req.query.hasProfile === "1") extra.profileFetchedAt = { $exists: true };
    if (req.query.hasProfile === "0") extra.profileFetchedAt = { $exists: false };
    const filter = combineFilters(searchFilter(p.q, ["name", "nationalId", "ceo", "nameLatin", "email"]), extra);
    res.json(await paginate(db.collection("companies"), filter, p, { name: 1 }));
  });

  app.get("/api/companies/:id", requireApi, async (req, res) => {
    const id = toObjectId(req.params.id);
    if (!id) return res.status(400).json({ error: "شناسه نامعتبر است" });
    const company = await db.collection("companies").findOne({ _id: id });
    if (!company) return res.status(404).json({ error: "شرکت پیدا نشد" });
    const [products, licenses] = await Promise.all([
      db.collection("products").find({ companyId: id }).sort({ nameFa: 1 }).limit(80).toArray(),
      db
        .collection("licenses")
        .find({ $or: [{ companyId: id }, { nationalId: company.nationalId || "__none__" }] })
        .project({ agencies: 0, branches: 0, details: 0 })
        .limit(80)
        .toArray(),
    ]);
    res.json({
      ...serialize(company),
      relatedProducts: products.map(serialize),
      relatedLicenses: licenses.map(serialize),
    });
  });

  app.get("/api/products", requireApi, async (req, res) => {
    const p = pageParams(req);
    const extra = {};
    if (req.query.method) extra.method = String(req.query.method);
    if (req.query.group) extra["group.id"] = String(req.query.group);
    applyRegex(extra, req, { certNo: "certNo" });
    if (req.query.company) {
      const rx = regexField(req.query.company);
      const companies = await db
        .collection("companies")
        .find({ name: rx })
        .project({ _id: 1 })
        .limit(300)
        .toArray();
      extra.companyId = { $in: companies.map((c) => c._id) };
    }
    const filter = combineFilters(
      searchFilter(p.q, ["nameFa", "deviceName", "certNo", "method", "group.title"]),
      extra
    );
    const result = await paginate(db.collection("products"), filter, p);
    const companyIds = [...new Set(result.items.map((item) => item.companyId).filter(Boolean))].map(
      (id) => toObjectId(id)
    );
    const companies = companyIds.length
      ? await db
          .collection("companies")
          .find({ _id: { $in: companyIds } })
          .project({ name: 1, nationalId: 1 })
          .toArray()
      : [];
    const map = new Map(companies.map((c) => [String(c._id), c]));
    result.items = result.items.map((item) => ({
      ...item,
      companyName: (map.get(item.companyId) || {}).name || "",
      companyNationalId: (map.get(item.companyId) || {}).nationalId || "",
    }));
    res.json(result);
  });

  app.get("/api/products/:id", requireApi, async (req, res) => {
    const id = toObjectId(req.params.id);
    if (!id) return res.status(400).json({ error: "شناسه نامعتبر است" });
    const product = await db.collection("products").findOne({ _id: id });
    if (!product) return res.status(404).json({ error: "کالا پیدا نشد" });
    const company = product.companyId
      ? await db.collection("companies").findOne({ _id: product.companyId })
      : null;
    res.json({ ...serialize(product), company: serialize(company) });
  });

  app.get("/api/licenses", requireApi, async (req, res) => {
    const p = pageParams(req);
    const kind = String(req.query.kind || "").trim();
    const extra = {};
    if (kind) extra.kind = kind;
    applyExact(extra, req, ["province", "city", "distributorType"]);
    applyRegex(extra, req, {
      nationalId: "nationalId",
      certNo: "certNo",
      companyCode: "companyCode",
      legalManufacturer: "legalManufacturer",
      nameFa: "nameFa",
      ceo: "ceo",
    });
    const filter = combineFilters(
      extra,
      searchFilter(p.q, [
        "companyName",
        "distributorName",
        "exporterName",
        "nationalId",
        "ceo",
        "province",
        "city",
        "certNo",
        "companyCode",
        "nameFa",
        "technicalManager",
        "legalManufacturer",
      ])
    );
    const result = await paginate(
      db.collection("licenses"),
      filter,
      p,
      kind === "distribution" ? { province: 1, distributorName: 1 } : { updatedAt: -1 },
      { agencies: 0, branches: 0, details: 0 }
    );
    res.json(result);
  });

  app.get("/api/licenses/:id", requireApi, async (req, res) => {
    const id = toObjectId(req.params.id);
    if (!id) return res.status(400).json({ error: "شناسه نامعتبر است" });
    const doc = await db.collection("licenses").findOne({ _id: id });
    if (!doc) return res.status(404).json({ error: "مجوز پیدا نشد" });
    res.json(serialize(doc));
  });

  app.get("/api/equipment", requireApi, async (req, res) => {
    const p = pageParams(req);
    const extra = {};
    if (req.query.country) extra.country = regexField(req.query.country) || String(req.query.country);
    applyRegex(extra, req, { manufacturer: "manufacturer", umdns: "umdns", model: "model" });
    const filter = combineFilters(
      searchFilter(p.q, [
        "nameFa",
        "nameEn",
        "model",
        "manufacturer",
        "country",
        "agencyName",
        "umdns",
        "labelName",
      ]),
      extra
    );
    res.json(await paginate(db.collection("imported_equipment"), filter, p));
  });

  app.get("/api/equipment/:id", requireApi, async (req, res) => {
    const id = toObjectId(req.params.id);
    if (!id) return res.status(400).json({ error: "شناسه نامعتبر است" });
    const doc = await db.collection("imported_equipment").findOne({ _id: id });
    if (!doc) return res.status(404).json({ error: "رکورد پیدا نشد" });
    res.json(serialize(doc));
  });

  app.get("/api/product-tree", requireApi, async (req, res) => {
    const p = pageParams(req);
    const extra = {};
    applyExact(extra, req, ["level1", "riskClass", "nature"]);
    applyRegex(extra, req, { indexId: "indexId" });
    const filter = combineFilters(
      searchFilter(p.q, ["nameFa", "nameEn", "path", "indexId", "riskClass"]),
      extra
    );
    res.json(await paginate(db.collection("product_tree"), filter, p, { indexId: 1 }));
  });

  app.get("/api/product-tree/:id", requireApi, async (req, res) => {
    const id = toObjectId(req.params.id);
    if (!id) return res.status(400).json({ error: "شناسه نامعتبر است" });
    const doc = await db.collection("product_tree").findOne({ _id: id });
    if (!doc) return res.status(404).json({ error: "رکورد پیدا نشد" });
    res.json(serialize(doc));
  });

  app.get("/api/product-search", requireApi, async (req, res) => {
    const p = pageParams(req);
    const filter = searchFilter(p.q, ["name"]);
    res.json(await paginate(db.collection("product_search"), filter, p, { name: 1 }));
  });

  app.get("/api/workers", requireApi, async (_req, res) => {
    res.json({ items: await workers.list() });
  });

  app.get("/api/workers/:id", requireApi, async (req, res) => {
    const doc = await workers.get(req.params.id);
    if (!doc) return res.status(404).json({ error: "ورکر پیدا نشد" });
    res.json(doc);
  });

  app.post("/api/workers/:id/start", requireApi, async (req, res) => {
    try {
      const result = await workers.start(req.params.id, {
        noResume: Boolean(req.body && req.body.noResume),
        startedBy: req.session.username,
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/workers/:id/stop", requireApi, async (req, res) => {
    try {
      res.json(await workers.stop(req.params.id));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/workers/:id/audit", requireApi, async (req, res) => {
    if (workers.auditing.has(req.params.id)) {
      return res.status(409).json({ error: "بررسی این ورکر الان در جریان است" });
    }
    workers.startAudit(req.params.id).catch((err) => console.error("audit", req.params.id, err.message));
    res.json({ ok: true, started: true });
  });

  app.get("/api/product-groups", requireApi, async (req, res) => {
    const p = pageParams(req);
    const filter = searchFilter(p.q, ["title", "name", "id"]);
    res.json(await paginate(db.collection("product_groups"), filter, p, { title: 1 }));
  });

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: "خطای داخلی سرور" });
  });

  const server = app.listen(PORT, HOST, () => {
    console.log(`پنل: http://${HOST}:${PORT}`);
    console.log(`ورود با کاربر ${DEFAULT_USER}`);
  });

  const shutdown = async () => {
    server.close();
    await client.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
