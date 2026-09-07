"use strict";

const cheerio = require("cheerio");

const SOURCE = {
  PROD_LICENSE: "prodconfirmedcmp",
  RETAIL: "retailcmp",
  DIST: "allalloweddist",
  EXPORT: "export_cert",
  PRODUCT_TREE: "product_tree_list",
  PRODUCT_SEARCH: "umdns_fname_only_child",
  EQP_REPORT: "cmpeqpreport",
  CONFIRMED_IMPORT: "srchconfirmedimedcompany",
  CONFIRMED_IMPORT_FORIATI: "srchconfirmedimedcompanyforiati",
};

const REFERENCE = {
  [SOURCE.PROD_LICENSE]: "شرکت های تولیدکننده دارای پروانه ساخت",
  [SOURCE.RETAIL]: "عرضه کنندگان مجاز",
  [SOURCE.DIST]: "توزیع کنندگان مجاز",
  [SOURCE.EXPORT]: "صادرکنندگان دارای پروانه ساخت",
  [SOURCE.CONFIRMED_IMPORT]: "شرکت های مجاز فعال در زمینه واردات تجهیزات و ملزومات پزشکی",
  [SOURCE.CONFIRMED_IMPORT_FORIATI]:
    "شرکت های وارد کننده دارای نمایندگی تامین کننده مجاز در زمینه واردات تجهیزات و ملزومات پزشکی",
};

const LICENSE_TYPE = {
  [SOURCE.RETAIL]: "عرضه کنندگان مجاز",
  [SOURCE.DIST]: "توزیع کنندگان مجاز",
  [SOURCE.EXPORT]: "صادرکنندگان دارای پروانه ساخت",
  [SOURCE.CONFIRMED_IMPORT]: "شرکت های مجاز فعال در زمینه واردات تجهیزات و ملزومات پزشکی",
  [SOURCE.CONFIRMED_IMPORT_FORIATI]:
    "شرکت های وارد کننده دارای نمایندگی تامین کننده مجاز در زمینه واردات تجهیزات و ملزومات پزشکی",
};

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function decodeImedId(companyUrl) {
  if (!companyUrl) return "";
  try {
    const u = new URL(companyUrl, "https://report.imed.ir/");
    const raw = u.searchParams.get("id") || "";
    return decodeURIComponent(raw);
  } catch {
    return "";
  }
}

function parseOfficesAndFactories(html) {
  const $ = cheerio.load(html);
  const rawHtml = $("#ctl00_MainContent_CompanyInfoControl1_lbl_factory").html() || "";
  const lines = rawHtml
    .split(/<br\s*\/?>/i)
    .map((line) => clean(cheerio.load(`<span>${line}</span>`)("span").text()))
    .filter(Boolean);
  const seen = new Set();
  const items = [];
  for (const raw of lines) {
    if (seen.has(raw)) continue;
    seen.add(raw);
    const parts = raw.split(/\s*-\s*/).map((p) => p.trim());
    items.push({
      kind: parts[0] || "",
      province: parts[1] || "",
      city: parts[2] || "",
      address: parts[3] || "",
      extra: parts.slice(4).filter(Boolean),
      raw,
    });
  }
  return items;
}

function parseBoard(html) {
  const $ = cheerio.load(html);
  const heading = $("h5.panel-title")
    .filter((_, el) => /هیئت/.test($(el).text()))
    .first();
  const panel = heading.closest(".panel");
  if (!panel.length) return [];
  const members = [];
  panel.find("table tr").each((_, el) => {
    const cells = [];
    $(el)
      .children("td, th")
      .each((__, td) => cells.push(clean($(td).text())));
    if (!cells.length || cells.every((c) => !c) || /نام|سمت|ردیف/.test(cells.join(" "))) {
      return;
    }
    members.push({
      name: cells[0] || "",
      role: cells[1] || "",
      nationalId: cells[2] || "",
      extra: cells.slice(3).filter(Boolean),
      cells,
    });
  });
  if (members.length) return members;
  const text = clean(panel.find(".panel-body").text());
  return text ? [{ raw: text }] : [];
}

function parseCompanyPage(html, companyUrl) {
  const $ = cheerio.load(html);
  const text = (id) => clean($(id).text());
  return {
    name: text("#ctl00_MainContent_CompanyInfoControl1_lbl_CmpName"),
    nameLatin: text("#ctl00_MainContent_CompanyInfoControl1_lbl_CmpNameLatin"),
    nationalId: text("#ctl00_MainContent_CompanyInfoControl1_lbl_CmpNationalId"),
    registerNo: text("#ctl00_MainContent_CompanyInfoControl1_lbl_RegisterNo"),
    registerPlace: text("#ctl00_MainContent_CompanyInfoControl1_lbl_RegisterAddress"),
    registerDate: text("#ctl00_MainContent_CompanyInfoControl1_lbl_RegisterDate"),
    nationality: text("#ctl00_MainContent_CompanyInfoControl1_lbl_Nationality"),
    postalBox: text("#ctl00_MainContent_CompanyInfoControl1_lbl_PostalBox"),
    website: text("#ctl00_MainContent_CompanyInfoControl1_lbl_Web"),
    email: text("#ctl00_MainContent_CompanyInfoControl1_lbl_Email"),
    ceo: text("#ctl00_MainContent_CompanyInfoControl1_lbl_CEO"),
    technicalManager: text("#ctl00_MainContent_CompanyInfoControl1_lbl_Technical"),
    activityType: text("#ctl00_MainContent_CompanyInfoControl1_lbl_CmpActivityType"),
    hq: {
      city: text("#ctl00_MainContent_CompanyInfoControl1_lbl_City"),
      postalCode: text("#ctl00_MainContent_CompanyInfoControl1_lbl_PostalCode"),
      address: text("#ctl00_MainContent_CompanyInfoControl1_lbl_PostalAddress"),
      phone: text("#ctl00_MainContent_CompanyInfoControl1_lbl_Phone"),
      fax: text("#ctl00_MainContent_CompanyInfoControl1_lbl_Fax"),
    },
    officesAndFactories: parseOfficesAndFactories(html),
    factoriesText: text("#ctl00_MainContent_CompanyInfoControl1_lbl_factory"),
    board: parseBoard(html),
    imedId: decodeImedId(companyUrl),
    profileUrl: companyUrl || "",
  };
}

class Store {
  constructor(db) {
    this.db = db;
    this.companies = db.collection("companies");
    this.licenses = db.collection("licenses");
    this.products = db.collection("products");
    this.ircs = db.collection("ircs");
    this.productGroups = db.collection("product_groups");
    this.productTree = db.collection("product_tree");
    this.productSearch = db.collection("product_search");
    this.importedEquipment = db.collection("imported_equipment");
    this.scrapeJobs = db.collection("scrape_jobs");
    this.runs = db.collection("runs");
  }

  async init() {
    await this.companies.createIndex({ nationalId: 1 }, { unique: true, sparse: true });
    await this.companies.createIndex({ imedIds: 1 });
    await this.companies.createIndex({ name: 1 });
    await this.licenses.createIndex({ companyId: 1 });
    await this.licenses.createIndex({ certNo: 1 });
    try {
      await this.licenses.dropIndex("source_1_certNo_1");
    } catch (_) {
      /* old unique index may already be gone */
    }
    await this.licenses.createIndex(
      { source: 1, certNo: 1 },
      { unique: true, partialFilterExpression: { certNo: { $type: "string" } } }
    );
    try {
      await this.licenses.dropIndex("source_1_uniqueKey_1");
    } catch (_) {
      /* replace sparse unique with partial */
    }
    await this.licenses.createIndex(
      { source: 1, uniqueKey: 1 },
      { unique: true, partialFilterExpression: { uniqueKey: { $type: "string" } } }
    );
    await this.licenses.updateMany(
      { uniqueKey: null },
      { $unset: { uniqueKey: "" } }
    );
    await this.products.createIndex({ companyId: 1 });
    await this.products.createIndex({ certNo: 1 });
    try {
      await this.products.dropIndex("source_1_companyId_1_licenseId_1_nameFa_1_model_1");
    } catch (_) {
      /* old unique index may already be gone */
    }
    await this.products.createIndex(
      { source: 1, certNo: 1 },
      { unique: true, partialFilterExpression: { certNo: { $type: "string" } } }
    );
    await this.products.createIndex(
      { source: 1, uniqueKey: 1 },
      { unique: true, partialFilterExpression: { uniqueKey: { $type: "string" } } }
    );
    await this.ircs.createIndex({ irc: 1 }, { unique: true, sparse: true });
    await this.ircs.createIndex({ companyId: 1 });
    await this.ircs.createIndex({ productId: 1 });
    await this.ircs.createIndex({ licenseId: 1 });
    await this.productGroups.createIndex({ source: 1, id: 1 }, { unique: true });
    await this.productTree.createIndex(
      { source: 1, indexId: 1 },
      { unique: true, partialFilterExpression: { indexId: { $type: "string" } } }
    );
    await this.productTree.createIndex({ nameFa: 1 });
    await this.productTree.createIndex({ nameEn: 1 });
    await this.productSearch.createIndex(
      { source: 1, name: 1 },
      { unique: true, partialFilterExpression: { name: { $type: "string" } } }
    );
    await this.importedEquipment.createIndex(
      { source: 1, code: 1 },
      { unique: true, partialFilterExpression: { code: { $type: "string" } } }
    );
    await this.importedEquipment.createIndex({ nameFa: 1 });
    await this.importedEquipment.createIndex({ umdns: 1 });
    await this.importedEquipment.createIndex({ searchNames: 1 });
    await this.scrapeJobs.createIndex({ source: 1, key: 1 }, { unique: true });
  }

  async findCompany({ nationalId, imedId, name }) {
    const nid = clean(nationalId);
    if (nid) {
      const byNational = await this.companies.findOne({ nationalId: nid });
      if (byNational) return byNational;
    }
    const mid = clean(imedId);
    if (mid) {
      const byImed = await this.companies.findOne({ imedIds: mid });
      if (byImed) return byImed;
    }
    const nm = clean(name);
    if (!nid && nm) {
      return this.companies.findOne({ name: nm, nationalId: { $in: [null, ""] } });
    }
    return null;
  }

  async upsertCompany(input) {
    const now = new Date();
    const nationalId = clean(input.nationalId);
    const imedId = clean(input.imedId || decodeImedId(input.profileUrl || input.companyUrl));
    const name = clean(input.name);
    const existing = await this.findCompany({ nationalId, imedId, name });

    const set = { updatedAt: now };
    const addToSet = {};
    const setOnInsert = { createdAt: now };

    if (nationalId) set.nationalId = nationalId;
    if (name) set.name = existing?.name || name;
    if (name && existing?.name && existing.name !== name) addToSet.aliases = name;
    if (clean(input.nameLatin)) set.nameLatin = clean(input.nameLatin);
    if (clean(input.registerNo)) set.registerNo = clean(input.registerNo);
    if (clean(input.registerPlace)) set.registerPlace = clean(input.registerPlace);
    if (clean(input.registerDate)) set.registerDate = clean(input.registerDate);
    if (clean(input.nationality)) set.nationality = clean(input.nationality);
    if (clean(input.email)) set.email = clean(input.email);
    if (clean(input.website)) set.website = clean(input.website);
    if (clean(input.ceo)) set.ceo = clean(input.ceo);
    if (clean(input.technicalManager)) set.technicalManager = clean(input.technicalManager);
    if (clean(input.activityType)) set.activityType = clean(input.activityType);
    if (clean(input.postalBox)) set.postalBox = clean(input.postalBox);
    if (input.hq && Object.values(input.hq).some((v) => clean(v))) set.hq = input.hq;
    if (Array.isArray(input.officesAndFactories) && input.officesAndFactories.length) {
      set.officesAndFactories = input.officesAndFactories;
    }
    if (clean(input.factoriesText)) set.factoriesText = clean(input.factoriesText);
    if (Array.isArray(input.board) && input.board.length) set.board = input.board;
    if (clean(input.profileUrl || input.companyUrl)) {
      set.profileUrl = clean(input.profileUrl || input.companyUrl);
    }
    if (imedId) addToSet.imedIds = imedId;
    if (input.source) addToSet.sources = input.source;
    const reference = clean(input.reference) || REFERENCE[input.source];
    if (reference) addToSet.references = reference;
    if (input.role) addToSet.roles = input.role;

    const update = { $set: set, $setOnInsert: setOnInsert };
    if (Object.keys(addToSet).length) update.$addToSet = addToSet;

    if (existing) {
      await this.companies.updateOne({ _id: existing._id }, update);
      return existing._id;
    }

    if (nationalId) {
      const result = await this.companies.updateOne({ nationalId }, update, { upsert: true });
      if (result.upsertedId) return result.upsertedId;
      return (await this.findCompany({ nationalId, imedId, name }))._id;
    }

    if (imedId) {
      const result = await this.companies.updateOne({ imedIds: imedId }, update, { upsert: true });
      if (result.upsertedId) return result.upsertedId;
      return (await this.findCompany({ nationalId, imedId, name }))._id;
    }

    const inserted = await this.companies.insertOne({
      ...set,
      ...setOnInsert,
      imedIds: imedId ? [imedId] : [],
      sources: input.source ? [input.source] : [],
      references: reference ? [reference] : [],
      roles: input.role ? [input.role] : [],
      aliases: [],
    });
    return inserted.insertedId;
  }

  async findCompanyIdByNationalId(nationalId) {
    const nid = clean(nationalId);
    if (!nid) return null;
    const doc = await this.companies.findOne({ nationalId: nid }, { projection: { _id: 1 } });
    return doc ? doc._id : null;
  }

  async findCompanyIdByName(name) {
    const nm = clean(name);
    if (!nm) return null;
    const docs = await this.companies.find({ name: nm }).limit(2).toArray();
    return docs.length === 1 ? docs[0]._id : null;
  }

  async upsertLicense(input) {
    const certNo = clean(input.certNo);
    const source = input.source || SOURCE.PROD_LICENSE;
    const now = new Date();
    const group = input.groupId
      ? { id: clean(input.groupId), name: clean(input.groupName) }
      : null;

    const set = {
      nationalId: clean(input.nationalId),
      source,
      kind: input.kind || "production",
      updatedAt: now,
    };
    if (input.companyId) set.companyId = input.companyId;
    if (certNo) set.certNo = certNo;
    const licenseType = clean(input.type) || LICENSE_TYPE[source];
    if (licenseType) set.type = licenseType;
    if (clean(input.deviceName || input.device)) set.deviceName = clean(input.deviceName || input.device);
    if (clean(input.method)) set.method = clean(input.method);
    if (clean(input.factoryAddress)) set.factoryAddress = clean(input.factoryAddress);
    if (clean(input.validDate)) set.validDate = clean(input.validDate);
    if (input.attachments) set.attachments = input.attachments;
    if (clean(input.companyUrl)) set.companyUrl = clean(input.companyUrl);
    if (input.fetchedAt) set.fetchedAt = input.fetchedAt;
    if (input.extra) set.extra = input.extra;
    if (input.details) set.details = input.details;
    if (clean(input.uniqueKey)) set.uniqueKey = clean(input.uniqueKey);
    if (clean(input.uniqueId)) set.uniqueId = clean(input.uniqueId);
    if (clean(input.pageUpdatedAt)) set.pageUpdatedAt = clean(input.pageUpdatedAt);
    if (clean(input.distributorName || input.name)) {
      set.distributorName = clean(input.distributorName || input.name);
    }
    if (clean(input.ceo)) set.ceo = clean(input.ceo);
    if (clean(input.province)) set.province = clean(input.province);
    if (clean(input.city)) set.city = clean(input.city);
    if (clean(input.address)) set.address = clean(input.address);
    if (clean(input.gln)) set.gln = clean(input.gln);
    if (clean(input.phone)) set.phone = clean(input.phone);
    if (clean(input.distOrGuild)) set.distOrGuild = clean(input.distOrGuild);
    if (clean(input.distributorType)) set.distributorType = clean(input.distributorType);
    if (clean(input.exporterName)) set.exporterName = clean(input.exporterName);
    if (clean(input.issueDate)) set.issueDate = clean(input.issueDate);
    if (clean(input.mainGroup)) set.mainGroup = clean(input.mainGroup);
    if (clean(input.itemIndex)) set.itemIndex = clean(input.itemIndex);
    if (clean(input.nameFa)) set.nameFa = clean(input.nameFa);
    if (clean(input.nameEn)) set.nameEn = clean(input.nameEn);
    if (clean(input.contractCompanyName)) set.contractCompanyName = clean(input.contractCompanyName);
    if (clean(input.contractCompanyType)) set.contractCompanyType = clean(input.contractCompanyType);
    if (clean(input.legalManufacturer)) set.legalManufacturer = clean(input.legalManufacturer);
    if (clean(input.agencyValidDate)) set.agencyValidDate = clean(input.agencyValidDate);
    if (Array.isArray(input.branches)) set.branches = input.branches;
    if (Array.isArray(input.agencies)) set.agencies = input.agencies;
    if (clean(input.companyName || input.importerName)) {
      set.companyName = clean(input.companyName || input.importerName);
    }
    if (clean(input.companyCode)) set.companyCode = clean(input.companyCode);
    if (clean(input.technicalManager)) set.technicalManager = clean(input.technicalManager);

    const update = {
      $set: set,
      $setOnInsert: { createdAt: now },
    };
    if (group && group.id) update.$addToSet = { groups: group };

    const uniqueKey = clean(input.uniqueKey);
    const uniqueId = clean(input.uniqueId);
    if (!uniqueKey && !uniqueId && !certNo) {
      const inserted = await this.licenses.insertOne({
        ...set,
        createdAt: now,
      });
      return inserted.insertedId;
    }

    const filter = uniqueKey
      ? { source, uniqueKey }
      : certNo
        ? { source, certNo }
        : { source, uniqueId };

    const result = await this.licenses.updateOne(filter, update, { upsert: true });
    if (result.upsertedId) return result.upsertedId;
    const doc = await this.licenses.findOne(filter);
    return doc._id;
  }

  async upsertProduct(input) {
    const companyId = input.companyId;
    if (!companyId) throw new Error("product needs companyId");
    const now = new Date();
    const nameFa = clean(input.nameFa || input.name || input.deviceName || input.device);
    const model = clean(input.model);
    const source = input.source || SOURCE.PROD_LICENSE;
    const licenseId = input.licenseId || null;
    const certNo = clean(input.certNo);
    const uniqueKey = clean(input.uniqueKey);

    const set = {
      companyId,
      source,
      nameFa,
      nameEn: clean(input.nameEn),
      brand: clean(input.brand),
      model,
      umdns: clean(input.umdns),
      fetchedAt: input.fetchedAt || now,
      updatedAt: now,
    };
    if (licenseId) set.licenseId = licenseId;
    if (certNo) set.certNo = certNo;
    if (uniqueKey) set.uniqueKey = uniqueKey;
    if (clean(input.deviceName || input.device)) set.deviceName = clean(input.deviceName || input.device);
    if (clean(input.method)) set.method = clean(input.method);
    if (clean(input.factoryAddress || input.address)) {
      set.factoryAddress = clean(input.factoryAddress || input.address);
    }
    if (clean(input.validDate)) set.validDate = clean(input.validDate);
    if (input.groupId) {
      set.group = { id: clean(input.groupId), title: clean(input.groupName || input.groupTitle) };
    }
    if (input.goods) set.goods = input.goods;
    if (input.extra) set.extra = input.extra;

    const filter = uniqueKey
      ? { source, uniqueKey }
      : certNo
        ? { source, certNo }
        : { source, companyId, nameFa, model };

    const result = await this.products.updateOne(
      filter,
      { $set: set, $setOnInsert: { createdAt: now } },
      { upsert: true }
    );
    if (result.upsertedId) return result.upsertedId;
    const doc = await this.products.findOne(filter);
    return doc && doc._id;
  }

  async upsertIrc(input) {
    const irc = clean(input.irc);
    if (!irc) throw new Error("irc code is required");
    const now = new Date();
    const set = {
      irc,
      updatedAt: now,
      fetchedAt: input.fetchedAt || now,
    };
    if (input.companyId) set.companyId = input.companyId;
    if (input.productId) set.productId = input.productId;
    if (input.licenseId) set.licenseId = input.licenseId;
    if (input.source) set.source = input.source;
    if (clean(input.nameFa || input.name)) set.nameFa = clean(input.nameFa || input.name);
    if (clean(input.nameEn)) set.nameEn = clean(input.nameEn);
    if (clean(input.brand)) set.brand = clean(input.brand);
    if (clean(input.model)) set.model = clean(input.model);
    if (clean(input.status)) set.status = clean(input.status);
    if (clean(input.validDate)) set.validDate = clean(input.validDate);
    if (input.extra) set.extra = input.extra;

    await this.ircs.updateOne(
      { irc },
      { $set: set, $setOnInsert: { createdAt: now } },
      { upsert: true }
    );
  }

  async upsertProductGroups(source, list) {
    if (!list.length) return;
    await this.productGroups.bulkWrite(
      list.map((g) => ({
        updateOne: {
          filter: { source, id: g.id },
          update: {
            $set: {
              source,
              id: g.id,
              title: g.title || g.name,
              name: g.name || g.title,
              extra: g.extra || {},
            },
          },
          upsert: true,
        },
      })),
      { ordered: false }
    );
  }

  async isJobDone(source, key) {
    return Boolean(await this.scrapeJobs.findOne({ source, key, done: true }));
  }

  async markJob(source, key, fields) {
    await this.scrapeJobs.updateOne(
      { source, key },
      { $set: { source, key, ...fields } },
      { upsert: true }
    );
  }

  async saveRun(summary) {
    await this.runs.insertOne({
      ...summary,
      createdAt: new Date(),
    });
  }

  async saveProductionRows(group, rows) {
    const fetchedAt = new Date();
    let saved = 0;
    for (const row of rows) {
      const profile = row.profile || {};
      const companyId = await this.upsertCompany({
        ...profile,
        name: profile.name || row.company,
        nationalId: profile.nationalId || row.nationalId,
        companyUrl: profile.profileUrl || row.companyUrl,
        source: SOURCE.PROD_LICENSE,
        reference: REFERENCE[SOURCE.PROD_LICENSE],
        role: "manufacturer",
      });
      await this.upsertProduct({
        companyId,
        source: SOURCE.PROD_LICENSE,
        certNo: row.certNo,
        deviceName: row.device,
        nameFa: row.device,
        method: row.method,
        factoryAddress: row.address,
        validDate: row.validDate,
        groupId: group.id,
        groupTitle: group.name,
        goods: row.goods || [],
        extra: {
          hasLicenseImage: row.hasLicenseImage,
          hasTechnicalAttachment: row.hasTechnicalAttachment,
          hasProductAttachment: row.hasProductAttachment,
          hasCommitmentAttachment: row.hasCommitmentAttachment,
        },
        fetchedAt,
      });
      saved += 1;
    }
    return saved;
  }

  async saveRetailRows(rows, pageUpdatedAt, onProgress) {
    const fetchedAt = new Date();
    let saved = 0;
    let linked = 0;
    for (const row of rows) {
      const companyId = await this.findCompanyIdByNationalId(row.nationalId);
      if (companyId) linked += 1;
      await this.upsertLicense({
        companyId,
        source: SOURCE.RETAIL,
        kind: "retail",
        uniqueKey: row.nationalId,
        uniqueId: row.nationalId,
        pageUpdatedAt,
        distributorName: row.distributorName,
        nationalId: row.nationalId,
        ceo: row.ceo,
        validDate: row.validDate,
        province: row.province,
        city: row.city,
        address: row.address,
        gln: row.gln,
        phone: row.phone,
        distOrGuild: row.distOrGuild,
        distributorType: row.distributorType,
        type: LICENSE_TYPE[SOURCE.RETAIL],
        fetchedAt,
      });
      saved += 1;
      if (onProgress) onProgress(saved, rows.length, row);
    }
    return { saved, linked };
  }

  async saveDistRows(rows, onProgress) {
    const fetchedAt = new Date();
    let saved = 0;
    let linked = 0;
    for (const row of rows) {
      const companyId = await this.findCompanyIdByName(row.distName);
      if (companyId) linked += 1;
      await this.upsertLicense({
        companyId,
        source: SOURCE.DIST,
        kind: "distribution",
        type: LICENSE_TYPE[SOURCE.DIST],
        distributorName: row.distName,
        distOrGuild: row.distOrGuild,
        distributorType: row.distType,
        province: row.distProvince,
        city: row.distCity,
        validDate: row.distValidDate,
        ceo: row.distManager,
        mainGroup: row.mainName,
        itemIndex: row.umdnsGroup,
        nameFa: row.groupNameFa,
        nameEn: row.groupName,
        deviceName: row.groupNameFa || row.groupName,
        contractCompanyName: row.repCompanyName,
        contractCompanyType: row.repCompanyType,
        legalManufacturer: row.legalCompanyName,
        agencyValidDate: row.repValidDate,
        companyUrl: row.companyUrl,
        branches: row.branches || [],
        fetchedAt,
      });
      saved += 1;
      if (onProgress) onProgress(saved, rows.length, row);
    }
    return { saved, linked };
  }

  async saveExportRows(rows) {
    const fetchedAt = new Date();
    let saved = 0;
    for (const row of rows) {
      const companyId = await this.findCompanyIdByNationalId(row.nationalId);
      const details = (row.details || []).map((d) => ({
        deviceName: d.deviceName || d.nameFa || d.name || "",
        model: d.model || "",
        umdns: d.umdns || "",
        irc: d.irc || "",
        imd: d.imd || "",
        usability: d.usability || "",
      }));
      await this.upsertLicense({
        companyId,
        source: SOURCE.EXPORT,
        kind: "export",
        type: LICENSE_TYPE[SOURCE.EXPORT],
        uniqueId: row.certNo,
        uniqueKey: row.certNo,
        certNo: row.certNo,
        exporterName: row.company,
        nationalId: row.nationalId,
        deviceName: row.groupNameFa || row.deviceName,
        issueDate: row.issueDate,
        validDate: row.expiredDate || row.validDate,
        details,
        fetchedAt,
      });
      saved += 1;
    }
    return saved;
  }

  async saveProductTreeRows(rows) {
    const now = new Date();
    const byIndex = new Map();
    for (const row of rows) {
      const indexId = clean(row.indexId);
      if (!indexId) continue;
      byIndex.set(indexId, {
        source: SOURCE.PRODUCT_TREE,
        indexId,
        level1: clean(row.level1),
        level2: clean(row.level2),
        level3: clean(row.level3),
        nature: clean(row.nature),
        nameFa: clean(row.nameFa),
        nameEn: clean(row.nameEn),
        path: clean(row.path),
        riskClass: clean(row.riskClass),
        insuranceCovered: clean(row.insuranceCovered),
        unlimitedDistribution: clean(row.unlimitedDistribution),
        singlePrescription: clean(row.singlePrescription),
        hospitalSinglePrescription: clean(row.hospitalSinglePrescription),
        clinicDistribution: clean(row.clinicDistribution),
        fetchedAt: now,
        updatedAt: now,
      });
    }
    const docs = [...byIndex.values()];
    if (!docs.length) return { saved: 0 };
    await this.productTree.bulkWrite(
      docs.map((doc) => ({
        updateOne: {
          filter: { source: SOURCE.PRODUCT_TREE, indexId: doc.indexId },
          update: { $set: doc, $setOnInsert: { createdAt: now } },
          upsert: true,
        },
      })),
      { ordered: false }
    );
    return { saved: docs.length };
  }

  async saveProductSearchRows(rows) {
    const now = new Date();
    const byName = new Map();
    for (const row of rows) {
      const name = clean(typeof row === "string" ? row : row.name);
      if (!name) continue;
      byName.set(name, {
        source: SOURCE.PRODUCT_SEARCH,
        name,
        fetchedAt: now,
        updatedAt: now,
      });
    }
    const docs = [...byName.values()];
    if (!docs.length) return { saved: 0 };
    await this.productSearch.bulkWrite(
      docs.map((doc) => ({
        updateOne: {
          filter: { source: SOURCE.PRODUCT_SEARCH, name: doc.name },
          update: { $set: doc, $setOnInsert: { createdAt: now } },
          upsert: true,
        },
      })),
      { ordered: false }
    );
    return { saved: docs.length };
  }

  async saveEqpRows(rows, searchName) {
    const now = new Date();
    const byCode = new Map();
    for (const row of rows) {
      const code = clean(row.code);
      if (!code) continue;
      byCode.set(code, row);
    }
    const docs = [...byCode.values()];
    if (!docs.length) return { saved: 0 };
    await this.importedEquipment.bulkWrite(
      docs.map((row) => {
        const set = {
          source: SOURCE.EQP_REPORT,
          code: clean(row.code),
          agencyName: clean(row.agencyName),
          nameEn: clean(row.nameEn),
          nameFa: clean(row.nameFa),
          umdns: clean(row.umdns),
          labelName: clean(row.labelName),
          model: clean(row.model),
          group: clean(row.group),
          manufacturer: clean(row.manufacturer),
          country: clean(row.country),
          nature: clean(row.nature),
          detailUrl: clean(row.detailUrl),
          updatedAt: now,
          fetchedAt: now,
        };
        if (clean(row.registerCode)) set.registerCode = clean(row.registerCode);
        if (clean(row.clearanceNo)) set.clearanceNo = clean(row.clearanceNo);
        if (clean(row.clearanceDate)) set.clearanceDate = clean(row.clearanceDate);
        if (clean(row.manufactureDate)) set.manufactureDate = clean(row.manufactureDate);
        if (clean(row.expiryDate)) set.expiryDate = clean(row.expiryDate);
        if (clean(row.invoiceNo)) set.invoiceNo = clean(row.invoiceNo);
        if (clean(row.invoiceDate)) set.invoiceDate = clean(row.invoiceDate);
        if (row.detailsFetched) set.detailsFetched = true;
        const update = { $set: set, $setOnInsert: { createdAt: now } };
        if (clean(searchName)) update.$addToSet = { searchNames: clean(searchName) };
        return {
          updateOne: {
            filter: { source: SOURCE.EQP_REPORT, code: clean(row.code) },
            update,
            upsert: true,
          },
        };
      }),
      { ordered: false }
    );
    return { saved: docs.length };
  }

  async eqpCodesWithDetails(codes) {
    if (!codes.length) return new Set();
    const docs = await this.importedEquipment
      .find(
        { source: SOURCE.EQP_REPORT, code: { $in: codes }, detailsFetched: true },
        { projection: { code: 1 } }
      )
      .toArray();
    return new Set(docs.map((d) => d.code));
  }

  async doneJobKeys(source) {
    const docs = await this.scrapeJobs
      .find({ source, done: true }, { projection: { key: 1 } })
      .toArray();
    return new Set(docs.map((d) => d.key));
  }

  async saveConfirmedImporterRows(rows, searchName, source = SOURCE.CONFIRMED_IMPORT) {
    const fetchedAt = new Date();
    let saved = 0;
    let linked = 0;
    for (const row of rows) {
      const uniqueKey = clean(row.cmpCode) || clean(row.nationalId);
      const companyId = await this.findCompanyIdByNationalId(row.nationalId);
      if (companyId) linked += 1;
      const existing = uniqueKey
        ? await this.licenses.findOne({ source, uniqueKey })
        : null;
      const agencies = mergeAgencyTrees(existing && existing.agencies, row.agencies);
      await this.upsertLicense({
        companyId,
        source,
        kind: source === SOURCE.CONFIRMED_IMPORT_FORIATI ? "import_foriati" : "import",
        type: LICENSE_TYPE[source] || LICENSE_TYPE[SOURCE.CONFIRMED_IMPORT],
        uniqueKey: uniqueKey || undefined,
        uniqueId: uniqueKey || undefined,
        nationalId: row.nationalId,
        companyName: row.name,
        companyCode: row.cmpCode,
        ceo: row.ceo,
        technicalManager: row.technicalManager,
        companyUrl: row.companyUrl,
        agencies,
        fetchedAt,
      });
      if (uniqueKey && clean(searchName)) {
        await this.licenses.updateOne(
          { source, uniqueKey },
          { $addToSet: { searchNames: clean(searchName) } }
        );
      }
      saved += 1;
    }
    return { saved, linked };
  }
}

function agencyKey(agency) {
  return [agency.legalManufacturer, agency.legalCountry, agency.agencyValidDate]
    .map(clean)
    .join("|");
}

function productKey(product) {
  return [product.nameFa, product.model, product.umdns, product.confirmedEqUrl]
    .map(clean)
    .join("|");
}

function mergeAgencyTrees(existing, incoming) {
  const map = new Map();
  for (const agency of existing || []) {
    map.set(agencyKey(agency), { ...agency, products: [...(agency.products || [])] });
  }
  for (const agency of incoming || []) {
    const key = agencyKey(agency);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...agency, products: [...(agency.products || [])] });
      continue;
    }
    const products = new Map();
    for (const p of prev.products || []) products.set(productKey(p), p);
    for (const p of agency.products || []) products.set(productKey(p), { ...products.get(productKey(p)), ...p });
    map.set(key, { ...prev, ...agency, products: [...products.values()] });
  }
  return [...map.values()];
}

module.exports = {
  Store,
  SOURCE,
  REFERENCE,
  LICENSE_TYPE,
  clean,
  decodeImedId,
  parseCompanyPage,
  parseOfficesAndFactories,
  parseBoard,
};
