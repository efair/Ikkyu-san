(() => {
  const NAV = [
    { id: "dashboard", label: "نمای کلی" },
    { id: "workers", label: "ورکرها" },
    { id: "companies", label: "شرکت‌ها", api: "/api/companies" },
    { id: "products", label: "پروانه‌های ساخت", api: "/api/products" },
    {
      group: "مجوزها",
      items: [
        { id: "retail", label: "عرضه کنندگان مجاز", api: "/api/licenses", kind: "retail" },
        { id: "distribution", label: "توزیع کنندگان مجاز", api: "/api/licenses", kind: "distribution" },
        { id: "export", label: "صادرکنندگان", api: "/api/licenses", kind: "export" },
        { id: "import", label: "شرکت های مجاز فعال در زمینه واردات تجهیزات و ملزومات پزشکی", api: "/api/licenses", kind: "import" },
        { id: "import_foriati", label: "شرکت های وارد کننده دارای نمایندگی تامین کننده مجاز در زمینه واردات تجهیزات و ملزومات پزشکی", api: "/api/licenses", kind: "import_foriati" },
      ],
    },
    { id: "equipment", label: "تجهیزات وارداتی", api: "/api/equipment" },
    { id: "tree", label: "درختواره کالا", api: "/api/product-tree" },
    { id: "search", label: "فهرست کالا", api: "/api/product-search" },
    { id: "groups", label: "گروه‌های تولید", api: "/api/product-groups" },
    { id: "password", label: "تغییر رمز" },
  ];

  const COLUMNS = {
    companies: [
      ["name", "نام شرکت"],
      ["nationalId", "شناسه ملی"],
      ["ceo", "مدیرعامل"],
      ["roles", "نقش‌ها"],
      ["email", "ایمیل"],
    ],
    products: [
      ["nameFa", "نام کالا"],
      ["companyName", "شرکت"],
      ["certNo", "شماره پروانه"],
      ["method", "روش"],
      ["validDate", "اعتبار"],
      ["group", "گروه"],
    ],
    retail: [
      ["distributorName", "نام واحد"],
      ["nationalId", "شناسه ملی"],
      ["ceo", "مدیرعامل"],
      ["province", "استان"],
      ["city", "شهر"],
      ["validDate", "اعتبار"],
      ["phone", "تلفن"],
    ],
    distribution: [
      ["distributorName", "توزیع‌کننده"],
      ["nationalId", "شناسه ملی"],
      ["ceo", "مدیرعامل"],
      ["province", "استان"],
      ["city", "شهر"],
      ["nameFa", "کالا"],
      ["legalManufacturer", "سازنده قانونی"],
    ],
    export: [
      ["exporterName", "صادرکننده"],
      ["certNo", "شماره گواهی"],
      ["issueDate", "صدور"],
      ["validDate", "اعتبار"],
      ["contractCompanyName", "طرف قرارداد"],
    ],
    import: [
      ["companyName", "شرکت"],
      ["companyCode", "کد"],
      ["nationalId", "شناسه ملی"],
      ["ceo", "مدیرعامل"],
      ["technicalManager", "مسئول فنی"],
    ],
    import_foriati: [
      ["companyName", "شرکت"],
      ["companyCode", "کد"],
      ["nationalId", "شناسه ملی"],
      ["ceo", "مدیرعامل"],
      ["technicalManager", "مسئول فنی"],
    ],
    equipment: [
      ["nameFa", "نام فارسی"],
      ["nameEn", "نام انگلیسی"],
      ["model", "مدل"],
      ["manufacturer", "سازنده"],
      ["country", "کشور"],
      ["agencyName", "نمایندگی"],
      ["umdns", "UMDNS"],
    ],
    tree: [
      ["indexId", "کد"],
      ["nameFa", "نام فارسی"],
      ["nameEn", "نام انگلیسی"],
      ["path", "مسیر"],
      ["riskClass", "کلاس خطر"],
      ["nature", "ماهیت"],
    ],
    search: [["name", "نام کالا"]],
    groups: [
      ["id", "کد"],
      ["title", "عنوان"],
      ["source", "منبع"],
    ],
  };

  const DETAIL = {
    companies: "/api/companies/",
    products: "/api/products/",
    retail: "/api/licenses/",
    distribution: "/api/licenses/",
    export: "/api/licenses/",
    import: "/api/licenses/",
    import_foriati: "/api/licenses/",
    equipment: "/api/equipment/",
    tree: "/api/product-tree/",
  };

  const FILTERS = {
    companies: [
      { key: "q", type: "search", label: "جستجو", placeholder: "نام شرکت، شناسه ملی، مدیرعامل، ایمیل" },
      { key: "nationalId", type: "text", label: "شناسه ملی" },
      { key: "ceo", type: "text", label: "مدیرعامل" },
      { key: "role", type: "select", label: "نقش", facet: "roles" },
      { key: "hasProfile", type: "select", label: "پروفایل", options: [["", "همه"], ["1", "تکمیل‌شده"], ["0", "بدون پروفایل"]] },
    ],
    products: [
      { key: "q", type: "search", label: "جستجو", placeholder: "نام کالا یا شماره پروانه" },
      { key: "company", type: "text", label: "شرکت" },
      { key: "certNo", type: "text", label: "شماره پروانه" },
      { key: "method", type: "select", label: "روش تولید", facet: "methods" },
      { key: "group", type: "select", label: "گروه تخصصی", facet: "groups" },
    ],
    retail: [
      { key: "q", type: "search", label: "جستجو", placeholder: "نام واحد، شناسه ملی، مدیرعامل، تلفن" },
      { key: "nationalId", type: "text", label: "شناسه ملی" },
      { key: "province", type: "select", label: "استان", facet: "provinces" },
      { key: "city", type: "select", label: "شهر", facet: "cities" },
    ],
    distribution: [
      { key: "q", type: "search", label: "جستجو", placeholder: "توزیع‌کننده، کالا، سازنده، شناسه" },
      { key: "nameFa", type: "text", label: "کالا" },
      { key: "legalManufacturer", type: "text", label: "سازنده قانونی" },
      { key: "province", type: "select", label: "استان", facet: "provinces" },
      { key: "city", type: "select", label: "شهر", facet: "cities" },
    ],
    export: [
      { key: "q", type: "search", label: "جستجو", placeholder: "صادرکننده، طرف قرارداد" },
      { key: "certNo", type: "text", label: "شماره گواهی" },
    ],
    import: [
      { key: "q", type: "search", label: "جستجو", placeholder: "شرکت، مدیرعامل، مسئول فنی" },
      { key: "nationalId", type: "text", label: "شناسه ملی" },
      { key: "companyCode", type: "text", label: "کد شرکت" },
    ],
    import_foriati: [
      { key: "q", type: "search", label: "جستجو", placeholder: "شرکت، مدیرعامل، مسئول فنی" },
      { key: "nationalId", type: "text", label: "شناسه ملی" },
      { key: "companyCode", type: "text", label: "کد شرکت" },
    ],
    equipment: [
      { key: "q", type: "search", label: "جستجو", placeholder: "نام کالا، مدل، نمایندگی" },
      { key: "umdns", type: "text", label: "UMDNS" },
      { key: "manufacturer", type: "text", label: "سازنده" },
      { key: "country", type: "select", label: "کشور", facet: "countries" },
    ],
    tree: [
      { key: "q", type: "search", label: "جستجو", placeholder: "نام فارسی، انگلیسی یا مسیر" },
      { key: "indexId", type: "text", label: "کد" },
      { key: "level1", type: "select", label: "سطح ۱", facet: "level1" },
      { key: "riskClass", type: "select", label: "کلاس خطر", facet: "riskClass" },
      { key: "nature", type: "select", label: "ماهیت", facet: "nature" },
    ],
    search: [{ key: "q", type: "search", label: "جستجو", placeholder: "نام کالا" }],
    groups: [{ key: "q", type: "search", label: "جستجو", placeholder: "عنوان یا کد گروه" }],
    workers: [
      { key: "q", type: "search", label: "جستجو", placeholder: "نام ورکر یا اسکریپت" },
      {
        key: "status",
        type: "select",
        label: "وضعیت اجرا",
        options: [
          ["", "همه"],
          ["running", "در حال اجرا"],
          ["idle", "آماده"],
          ["success", "موفق"],
          ["error", "خطا"],
          ["stopped", "متوقف"],
        ],
      },
      {
        key: "verdict",
        type: "select",
        label: "کامل‌بودن داده",
        options: [
          ["", "همه"],
          ["complete", "کامل"],
          ["close", "نزدیک به کامل"],
          ["incomplete", "ناقص"],
          ["empty", "خالی"],
          ["unknown", "بررسی‌نشده"],
        ],
      },
    ],
  };

  const state = { view: "dashboard", page: 1, q: "", filters: {}, facets: {}, stats: null, workerPoll: null, openWorker: "" };
  const els = {
    nav: document.getElementById("nav"),
    content: document.getElementById("content"),
    title: document.getElementById("title"),
    crumb: document.getElementById("crumb"),
    searchForm: document.getElementById("search-form"),
    search: document.getElementById("search"),
    who: document.getElementById("who"),
    drawer: document.getElementById("drawer"),
    drawerBody: document.getElementById("drawer-body"),
    drawerTitle: document.getElementById("drawer-title"),
    drawerKicker: document.getElementById("drawer-kicker"),
    backdrop: document.getElementById("backdrop"),
  };

  function flatNav() {
    return NAV.flatMap((item) => (item.items ? item.items : [item]));
  }

  function currentNav() {
    return flatNav().find((item) => item.id === state.view) || NAV[0];
  }

  const ROLE_FA = {
    manufacturer: "تولیدکننده",
    importer: "واردکننده",
    retailer: "عرضه‌کننده",
    distributor: "توزیع‌کننده",
  };

  function dash(value) {
    if (value == null || value === "") return "—";
    if (Array.isArray(value)) {
      return value.map((item) => ROLE_FA[item] || item).filter(Boolean).join("، ") || "—";
    }
    if (typeof value === "object") return value.title || value.name || value.id || "—";
    return ROLE_FA[value] || String(value);
  }

  function fmtNum(n) {
    return Number(n || 0).toLocaleString("fa-IR");
  }

  async function api(url) {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (res.status === 401) {
      location.href = "/login";
      throw new Error("unauthorized");
    }
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "خطا");
    return body;
  }

  function renderNav() {
    els.nav.innerHTML = NAV.map((item) => {
      if (item.group) {
        return `<p class="nav-group">${item.group}</p>${item.items
          .map(
            (sub) =>
              `<a class="nav-link ${state.view === sub.id ? "active" : ""}" href="#/${sub.id}">${sub.label}</a>`
          )
          .join("")}`;
      }
      return `<a class="nav-link ${state.view === item.id ? "active" : ""}" href="#/${item.id}">${item.label}</a>`;
    }).join("");
  }

  function closeDrawer() {
    els.drawer.hidden = true;
    els.drawer.classList.remove("is-open");
    els.backdrop.hidden = true;
    state.openWorker = "";
  }

  function openDrawer(title, kicker, html) {
    els.drawerTitle.textContent = title;
    els.drawerKicker.textContent = kicker;
    els.drawerBody.innerHTML = html;
    els.drawer.hidden = false;
    els.drawer.classList.add("is-open");
    els.backdrop.hidden = false;
  }

  function kv(pairs) {
    return `<dl class="kv">${pairs
      .filter((row) => row[1] !== undefined)
      .map(([label, value]) => `<dt>${label}</dt><dd>${escapeHtml(dash(value))}</dd>`)
      .join("")}</dl>`;
  }

  function miniTable(columns, rows) {
    if (!rows || !rows.length) return `<p class="muted">موردی ثبت نشده است.</p>`;
    return `<div class="table-wrap"><table><thead><tr>${columns
      .map((c) => `<th>${c[1]}</th>`)
      .join("")}</tr></thead><tbody>${rows
      .map(
        (row) =>
          `<tr>${columns.map((c) => `<td>${escapeHtml(dash(pick(row, c[0])))}</td>`).join("")}</tr>`
      )
      .join("")}</tbody></table></div>`;
  }

  function pick(row, key) {
    if (key === "group") return row.group && (row.group.title || row.group.name);
    return row[key];
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function block(title, html) {
    return `<section class="block"><h3>${title}</h3>${html}</section>`;
  }

  function renderCompany(doc) {
    return (
      kv([
        ["نام", doc.name],
        ["نام لاتین", doc.nameLatin],
        ["شناسه ملی", doc.nationalId],
        ["مدیرعامل", doc.ceo],
        ["مسئول فنی", doc.technicalManager],
        ["ایمیل", doc.email],
        ["وب‌سایت", doc.website],
        ["شماره ثبت", doc.registerNo],
        ["محل ثبت", doc.registerPlace],
        ["تاریخ ثبت", doc.registerDate],
        ["نقش‌ها", doc.roles],
        ["منابع", doc.references],
      ]) +
      (doc.officesAndFactories && doc.officesAndFactories.length
        ? block(
            "دفاتر و کارخانه‌ها",
            miniTable(
              [
                ["kind", "نوع"],
                ["province", "استان"],
                ["city", "شهر"],
                ["address", "نشانی"],
              ],
              doc.officesAndFactories
            )
          )
        : "") +
      (doc.relatedLicenses && doc.relatedLicenses.length
        ? block(
            "مجوزهای مرتبط",
            miniTable(
              [
                ["type", "دسته"],
                ["companyName", "شرکت"],
                ["distributorName", "واحد"],
                ["exporterName", "صادرکننده"],
                ["certNo", "شماره"],
              ],
              doc.relatedLicenses
            )
          )
        : "") +
      (doc.relatedProducts && doc.relatedProducts.length
        ? block(
            "پروانه‌های ساخت",
            miniTable(
              [
                ["nameFa", "کالا"],
                ["certNo", "پروانه"],
                ["validDate", "اعتبار"],
              ],
              doc.relatedProducts
            )
          )
        : "")
    );
  }

  function renderProduct(doc) {
    return (
      kv([
        ["نام کالا", doc.nameFa || doc.deviceName],
        ["شرکت", doc.company && doc.company.name],
        ["شناسه ملی شرکت", doc.company && doc.company.nationalId],
        ["شماره پروانه", doc.certNo],
        ["روش", doc.method],
        ["اعتبار", doc.validDate],
        ["گروه", doc.group && doc.group.title],
        ["نشانی کارخانه", doc.factoryAddress],
      ]) +
      (doc.goods && doc.goods.length
        ? block(
            "اقلام",
            miniTable(
              [
                ["nameFa", "نام"],
                ["model", "مدل"],
                ["brand", "برند"],
              ],
              doc.goods
            )
          )
        : "")
    );
  }

  function renderImport(doc) {
    const agencies = (doc.agencies || [])
      .map((agency) => {
        const products = (agency.products || [])
          .map((product) => {
            const regs = (product.registeredProducts || [])
              .map((item) => {
                return `<div class="nest">
                  ${kv([
                    ["نام فارسی", item.nameFa],
                    ["نام انگلیسی", item.nameEn],
                    ["مدل", item.model],
                    ["برند", item.brand],
                    ["UMDNS", item.umdns],
                    ["سازنده قانونی", item.legalManufacturer],
                    ["کشور", item.legalCountry],
                  ])}
                  ${item.specs ? block("مشخصات کالا", kv(Object.entries(item.specs).map(([k, v]) => [specLabel(k), v]))) : ""}
                  ${block(
                    "توزیع استانی",
                    miniTable(
                      [
                        ["distributorName", "توزیع‌کننده"],
                        ["province", "استان"],
                        ["nationalId", "شناسه ملی"],
                        ["validityStatus", "وضعیت"],
                      ],
                      item.provincialDistributors
                    )
                  )}
                  ${block(
                    "فهرست IRC",
                    miniTable(
                      [
                        ["irc", "IRC"],
                        ["nameFa", "نام"],
                        ["gtin", "GTIN"],
                      ],
                      item.ircs
                    )
                  )}
                </div>`;
              })
              .join("");
            return `<div class="nest">
              <p><b>${escapeHtml(dash(product.nameFa))}</b> <span class="pill">${escapeHtml(dash(product.riskClass))}</span></p>
              ${kv([
                ["گروه اصلی", product.mainGroup],
                ["زیرگروه", product.subGroup],
                ["مسیر", product.catalogPath],
                ["UMDNS", product.umdns],
              ])}
              ${regs || "<p class='muted'>کالای ثبت‌شده‌ای نیست.</p>"}
            </div>`;
          })
          .join("");
        return `<div class="nest">
          <p><b>${escapeHtml(dash(agency.legalManufacturer))}</b> — ${escapeHtml(dash(agency.legalCountry))}</p>
          ${kv([
            ["اعتبار نمایندگی", agency.agencyValidDate],
            ["فروش / خدمات", agency.saleOrService],
          ])}
          ${products || "<p class='muted'>کالایی ثبت نشده است.</p>"}
        </div>`;
      })
      .join("");
    return (
      kv([
        ["شرکت", doc.companyName],
        ["کد شرکت", doc.companyCode],
        ["شناسه ملی", doc.nationalId],
        ["مدیرعامل", doc.ceo],
        ["مسئول فنی", doc.technicalManager],
        ["دسته", doc.type],
        ["نام‌های جستجو", doc.searchNames],
      ]) + block("نمایندگی‌ها", agencies || "<p class='muted'>نمایندگی ثبت نشده است.</p>")
    );
  }

  function specLabel(key) {
    return (
      {
        name: "نام",
        nameEn: "نام انگلیسی",
        description: "شرح",
        umdns: "UMDNS",
        legalManufacturer: "سازنده قانونی",
        legalCountry: "کشور",
        oem: "OEM",
        model: "مدل",
        companyType: "نوع شرکت",
        agencyStatus: "وضعیت نمایندگی",
        unit: "واحد",
        usability: "کاربری",
        commonName: "نام رایج",
        labelName: "لیبل",
        brand: "برند",
        catalogNo: "کاتالوگ",
      }[key] || key
    );
  }

  function renderDist(doc) {
    const branches = (doc.branches || [])
      .map((branch) => {
        return `<div class="nest">
          ${kv([
            ["شعبه", branch.name || branch.distributorName],
            ["نوع", branch.branchType],
            ["استان", branch.province],
            ["شهر", branch.city],
            ["مسئول فنی", branch.technicalManager],
            ["نشانی", branch.address],
          ])}
          ${block(
            "انبارها",
            miniTable(
              [
                ["name", "نام"],
                ["city", "شهر"],
                ["address", "نشانی"],
                ["postalCode", "کد پستی"],
                ["createdDate", "ایجاد"],
              ],
              branch.warehouses
            )
          )}
        </div>`;
      })
      .join("");
    return (
      kv([
        ["توزیع‌کننده", doc.distributorName || doc.companyName],
        ["شناسه ملی", doc.nationalId],
        ["مدیرعامل", doc.ceo],
        ["استان", doc.province],
        ["شهر", doc.city],
        ["کالا", doc.nameFa],
        ["سازنده قانونی", doc.legalManufacturer],
        ["گروه", doc.mainGroup],
      ]) + block("شعب", branches || "<p class='muted'>شعبه‌ای ثبت نشده است.</p>")
    );
  }

  function renderExport(doc) {
    return (
      kv([
        ["صادرکننده", doc.exporterName],
        ["شماره گواهی", doc.certNo],
        ["تاریخ صدور", doc.issueDate],
        ["اعتبار", doc.validDate],
        ["طرف قرارداد", doc.contractCompanyName],
      ]) +
      block(
        "اقلام گواهی",
        miniTable(
          [
            ["deviceName", "کالا"],
            ["model", "مدل"],
            ["umdns", "UMDNS"],
            ["irc", "IRC"],
            ["imd", "IMD"],
          ],
          doc.details
        )
      )
    );
  }

  function renderRetail(doc) {
    return kv([
      ["نام واحد", doc.distributorName],
      ["شناسه ملی", doc.nationalId],
      ["مدیرعامل", doc.ceo],
      ["استان", doc.province],
      ["شهر", doc.city],
      ["نشانی", doc.address],
      ["تلفن", doc.phone],
      ["GLN", doc.gln],
      ["اعتبار", doc.validDate],
      ["نوع", doc.distributorType],
      ["صنف / توزیع", doc.distOrGuild],
    ]);
  }

  function renderGeneric(doc, pairs) {
    return kv(pairs.map(([key, label]) => [label, doc[key]]));
  }

  function renderDetail(view, doc) {
    if (view === "companies") return renderCompany(doc);
    if (view === "products") return renderProduct(doc);
    if (view === "import" || view === "import_foriati") return renderImport(doc);
    if (view === "distribution") return renderDist(doc);
    if (view === "export") return renderExport(doc);
    if (view === "retail") return renderRetail(doc);
    if (view === "equipment") {
      return kv([
        ["نام فارسی", doc.nameFa],
        ["نام انگلیسی", doc.nameEn],
        ["مدل", doc.model],
        ["سازنده", doc.manufacturer],
        ["کشور", doc.country],
        ["نمایندگی", doc.agencyName],
        ["UMDNS", doc.umdns],
        ["گروه", doc.group],
        ["لیبل", doc.labelName],
        ["ماهیت", doc.nature],
        ["شماره ترخیص", doc.clearanceNo],
        ["تاریخ ترخیص", doc.clearanceDate],
        ["تاریخ ساخت", doc.manufactureDate],
        ["انقضا", doc.expiryDate],
        ["فاکتور", doc.invoiceNo],
        ["تاریخ فاکتور", doc.invoiceDate],
      ]);
    }
    if (view === "tree") {
      return kv([
        ["کد", doc.indexId],
        ["نام فارسی", doc.nameFa],
        ["نام انگلیسی", doc.nameEn],
        ["مسیر", doc.path],
        ["سطح ۱", doc.level1],
        ["سطح ۲", doc.level2],
        ["سطح ۳", doc.level3],
        ["کلاس خطر", doc.riskClass],
        ["ماهیت", doc.nature],
        ["پوشش بیمه", doc.insuranceCovered],
      ]);
    }
    return renderGeneric(doc, Object.keys(doc).slice(0, 16).map((k) => [k, k]));
  }

  function titleOf(view, doc) {
    return (
      doc.companyName ||
      doc.distributorName ||
      doc.exporterName ||
      doc.name ||
      doc.nameFa ||
      doc.deviceName ||
      "جزئیات"
    );
  }

  async function openRow(view, id) {
    const base = DETAIL[view];
    if (!base) return;
    const doc = await api(base + id);
    openDrawer(titleOf(view, doc), currentNav().label, renderDetail(view, doc));
  }

  function renderPager(data) {
    return `<div class="pager">
      <span>${fmtNum(data.total)} مورد — صفحه ${fmtNum(data.page)} از ${fmtNum(data.pages)}</span>
      <div>
        <button type="button" data-page="${data.page - 1}" ${data.page <= 1 ? "disabled" : ""}>قبلی</button>
        <button type="button" data-page="${data.page + 1}" ${data.page >= data.pages ? "disabled" : ""}>بعدی</button>
      </div>
    </div>`;
  }

  function renderTable(view, data) {
    const cols = COLUMNS[view] || [];
    if (!data.items.length) {
      return `<div class="panel"><p class="empty">در این دسته موردی پیدا نشد.</p></div>`;
    }
    return `<div class="panel">
      <div class="table-wrap"><table>
        <thead><tr>${cols.map((c) => `<th>${c[1]}</th>`).join("")}</tr></thead>
        <tbody>
          ${data.items
            .map(
              (row) =>
                `<tr class="${DETAIL[view] ? "clickable" : ""}" ${DETAIL[view] ? `data-id="${row.id}"` : ""}>${cols
                  .map((c) => `<td>${escapeHtml(dash(pick(row, c[0])))}</td>`)
                  .join("")}</tr>`
            )
            .join("")}
        </tbody>
      </table></div>
      ${renderPager(data)}
    </div>`;
  }

  async function renderDashboard() {
    const stats = await api("/api/stats");
    state.stats = stats;
    const cards = [
      ["companies", "شرکت‌ها", stats.companies],
      ["products", "پروانه‌های ساخت", stats.products],
      ...stats.licenseKinds.map((row) => [row.kind, row.label, row.count]),
      ["equipment", "تجهیزات وارداتی", stats.equipment],
      ["tree", "درختواره کالا", stats.productTree],
      ["search", "فهرست کالا", stats.productSearch],
    ];
    els.content.innerHTML = `<div class="cards">${cards
      .map(
        ([id, label, count]) =>
          `<button class="card" data-go="${id}"><p>${label}</p><div class="count">${fmtNum(count)}</div><p>مشاهده دسته</p></button>`
      )
      .join("")}</div>`;
    els.content.querySelectorAll("[data-go]").forEach((btn) => {
      btn.addEventListener("click", () => {
        location.hash = "#/" + btn.dataset.go;
      });
    });
  }

  function stopWorkerPoll() {
    if (state.workerPoll) {
      clearInterval(state.workerPoll);
      state.workerPoll = null;
    }
  }

  function badge(status, running, auditing) {
    if (running) return `<span class="badge run">در حال اجرا</span>`;
    if (auditing) return `<span class="badge wait">در حال بررسی سایت</span>`;
    if (status === "success") return `<span class="badge ok">موفق</span>`;
    if (status === "error") return `<span class="badge err">خطا</span>`;
    if (status === "stopped") return `<span class="badge wait">متوقف</span>`;
    return `<span class="badge idle">آماده</span>`;
  }

  function verdictFa(v) {
    return (
      {
        complete: "کامل",
        close: "نزدیک به کامل",
        incomplete: "ناقص",
        empty: "خالی",
        unknown: "نامشخص",
        error: "خطای بررسی",
      }[v] || "بررسی نشده"
    );
  }

  function pct(done, total) {
    if (!total) return 0;
    return Math.min(100, Math.round((done / total) * 100));
  }

  function workerCard(item) {
    const p = item.progress || {};
    const total = p.total || item.jobs.recordedJobs || 0;
    const done = p.done || item.jobs.doneJobs || 0;
    const bar = item.running ? pct(done, total) : item.lastAudit ? pct(item.localCount, item.lastAudit.siteCount || item.localCount) : pct(item.jobs.doneJobs, item.jobs.recordedJobs);
    return `<article class="worker-card" data-worker="${item.id}">
      <header>
        <div>
          <strong>${escapeHtml(item.label)}</strong>
          <p class="muted">${escapeHtml(item.script)}</p>
          ${
            item.url
              ? `<p class="worker-url"><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.pagePath || item.url)}</a></p>`
              : ""
          }
          ${item.pageNote ? `<p class="muted">${escapeHtml(item.pageNote)}</p>` : ""}
        </div>
        ${badge(item.lastRun && item.lastRun.status, item.running, item.auditing)}
      </header>
      <div class="worker-meta">
        <span>${escapeHtml((item.countLabels && item.countLabels.local) || "محلی")}: ${fmtNum(item.localCount)}</span>
        <span>${escapeHtml((item.countLabels && item.countLabels.site) || "سایت")}: ${
          item.auditing && item.lastAudit && item.lastAudit.siteCountSoFar != null
            ? fmtNum(item.lastAudit.siteCountSoFar) + "…"
            : item.lastAudit && item.lastAudit.siteCount != null
              ? fmtNum(item.lastAudit.siteCount)
              : "—"
        }</span>
        <span>وضعیت داده: ${verdictFa(item.lastAudit && item.lastAudit.verdict)}</span>
      </div>
      <div class="bar"><i style="width:${bar}%"></i></div>
      <p class="muted">${escapeHtml(
        (item.auditing && item.lastAudit && item.lastAudit.section) ||
          p.section ||
          (item.lastAudit && item.lastAudit.section) ||
          (item.lastRun && item.lastRun.summary) ||
          "هنوز گزارشی نیست"
      )}</p>
      ${p.lastItem ? `<p class="muted">الان: ${escapeHtml(p.lastItem)}</p>` : ""}
      ${p.lastError ? `<p class="form-error">${escapeHtml(p.lastError)}</p>` : ""}
      <div class="worker-actions">
        <button type="button" class="act" data-act="start" ${item.running ? "disabled" : ""}>اجرا</button>
        <button type="button" class="act ghost-btn" data-act="fresh" ${item.running ? "disabled" : ""}>اجرا از اول</button>
        <button type="button" class="act" data-act="stop" ${item.running ? "" : "disabled"}>توقف</button>
        <button type="button" class="act ghost-btn" data-act="audit" ${item.auditing ? "disabled" : ""}>بررسی با سایت</button>
      </div>
    </article>`;
  }

  async function openWorker(id) {
    const doc = await api("/api/workers/" + id);
    state.openWorker = id;
    const logs = (doc.liveLog || []).map((line) => `<div>${escapeHtml(line)}</div>`).join("");
    const errors = (doc.liveErrors || []).map((line) => `<div class="form-error">${escapeHtml(line)}</div>`).join("");
    const audits = (doc.audits || [])
      .map(
        (a) => `<div class="nest">
          <p><span class="badge ${a.verdict === "complete" ? "ok" : a.verdict === "incomplete" || a.verdict === "error" ? "err" : "wait"}">${verdictFa(a.verdict)}</span> ${escapeHtml(a.note || "")}</p>
          <p class="muted">${escapeHtml(a.section || "")}</p>
          <p class="muted">محلی ${fmtNum(a.localCount)} — سایت ${a.siteCount == null ? "—" : fmtNum(a.siteCount)} — ${escapeHtml(a.method || "")}</p>
          ${
            a.samples && a.samples.length
              ? miniTable(
                  [
                    ["name", "فیلد"],
                    ["siteCount", "سایت"],
                    ["pageCount", "صفحه"],
                    ["lastPageRows", "ردیف آخر"],
                  ],
                  a.samples
                )
              : ""
          }
        </div>`
      )
      .join("");
    const runs = (doc.runs || [])
      .map(
        (r) => `<div class="nest">
          ${kv([
            ["وضعیت", r.status],
            ["شروع", r.startedAt && new Date(r.startedAt).toLocaleString("fa-IR")],
            ["پایان", r.finishedAt && new Date(r.finishedAt).toLocaleString("fa-IR")],
            ["گزارش", r.summary],
            ["خطاها", r.errorCount],
          ])}
        </div>`
      )
      .join("");
    openDrawer(
      doc.label,
      doc.running ? "در حال اجرا" : "گزارش ورکر",
      kv([
        ["اسکریپت", doc.script],
        ["صفحه", doc.url ? undefined : doc.pagePath || "—"],
        [(doc.countLabels && doc.countLabels.local) || "محلی", fmtNum(doc.localCount)],
        [
          (doc.countLabels && doc.countLabels.site) || "سایت",
          doc.lastAudit && doc.lastAudit.siteCount != null ? fmtNum(doc.lastAudit.siteCount) : "—",
        ],
        ["شغل‌های انجام‌شده", `${fmtNum(doc.jobs.doneJobs)} / ${fmtNum(doc.jobs.recordedJobs)}`],
        ["PID", doc.pid],
      ]) +
        (doc.url
          ? `<p class="worker-url"><a href="${escapeHtml(doc.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(doc.url)}</a></p>${
              doc.pageNote ? `<p class="muted">${escapeHtml(doc.pageNote)}</p>` : ""
            }`
          : "") +
        block("گزارش خطا", errors || "<p class='muted'>خطای ثبت‌شده‌ای نیست.</p>") +
        block("گزارش کار", logs || "<p class='muted'>لاگی نیست.</p>") +
        block("بررسی کامل‌بودن با سایت", audits || "<p class='muted'>هنوز بررسی نشده.</p>") +
        block("اجراهای قبلی", runs || "<p class='muted'>اجرایی ثبت نشده.</p>")
    );
  }

  function bindWorkerActions(root) {
    root.querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", async (event) => {
        event.stopPropagation();
        const id = btn.closest("[data-worker]").dataset.worker;
        const act = btn.dataset.act;
        btn.disabled = true;
        try {
          if (act === "start" || act === "fresh") {
            const res = await fetch("/api/workers/" + id + "/start", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ noResume: act === "fresh" }),
            });
            const body = await res.json();
            if (!res.ok) throw new Error(body.error || "اجرا نشد");
          } else if (act === "stop") {
            const res = await fetch("/api/workers/" + id + "/stop", { method: "POST" });
            const body = await res.json();
            if (!res.ok) throw new Error(body.error || "توقف نشد");
          } else if (act === "audit") {
            const res = await fetch("/api/workers/" + id + "/audit", { method: "POST" });
            const body = await res.json();
            if (!res.ok) throw new Error(body.error || "بررسی شروع نشد");
          }
          await renderWorkers(true);
        } catch (err) {
          alert(err.message);
        }
      });
    });
    root.querySelectorAll(".worker-card").forEach((card) => {
      card.addEventListener("click", (event) => {
        if (event.target.closest("[data-act]")) return;
        openWorker(card.dataset.worker);
      });
    });
  }

  function filterDefs(view) {
    return FILTERS[view] || [];
  }

  function facetOptions(facet, defs) {
    const raw = (state.facets && state.facets[facet]) || [];
    return raw.map((item) =>
      typeof item === "object" ? [item.value, item.label] : [item, ROLE_FA[item] || item]
    );
  }

  function renderFilterBar(view) {
    const defs = filterDefs(view);
    if (!defs.length) return "";
    return `<form class="filters" id="filter-form">
      ${defs
        .map((field) => {
          const value = state.filters[field.key] || "";
          if (field.type === "select") {
            const options = field.options || [["", "همه"], ...facetOptions(field.facet)];
            if (!field.options) options[0] = ["", field.label || "همه"];
            return `<label>${field.label || ""}
              <select name="${field.key}">
                ${options
                  .map(([v, l]) => `<option value="${escapeHtml(v)}" ${String(v) === String(value) ? "selected" : ""}>${escapeHtml(l)}</option>`)
                  .join("")}
              </select>
            </label>`;
          }
          return `<label>${field.label || ""}
            <input name="${field.key}" type="${field.type === "search" ? "search" : "text"}" value="${escapeHtml(value)}" placeholder="${escapeHtml(field.placeholder || field.label || "")}">
          </label>`;
        })
        .join("")}
      <div class="filter-actions">
        <button type="submit">اعمال فیلتر</button>
        <button type="button" id="filter-reset" class="ghost-btn">پاک کردن</button>
      </div>
    </form>`;
  }

  function readFilterForm(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    const next = {};
    for (const [key, value] of Object.entries(data)) {
      if (String(value).trim()) next[key] = String(value).trim();
    }
    return next;
  }

  function bindFilters() {
    const form = document.getElementById("filter-form");
    if (!form) return;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      state.filters = readFilterForm(form);
      state.q = state.filters.q || "";
      state.page = 1;
      render();
    });
    const reset = document.getElementById("filter-reset");
    if (reset) {
      reset.addEventListener("click", () => {
        state.filters = {};
        state.q = "";
        state.page = 1;
        render();
      });
    }
    const province = form.querySelector('[name="province"]');
    if (province) {
      province.addEventListener("change", async () => {
        state.filters = readFilterForm(form);
        delete state.filters.city;
        state.page = 1;
        await loadFacets(currentNav().id);
        render();
      });
    }
  }

  async function loadFacets(view) {
    if (!filterDefs(view).some((field) => field.facet)) {
      state.facets = {};
      return;
    }
    const params = new URLSearchParams({ view });
    if (state.filters.province) params.set("province", state.filters.province);
    state.facets = await api("/api/facets?" + params);
  }

  function matchWorkerFilters(item) {
    const q = (state.filters.q || "").trim();
    if (q && ![item.label, item.script].some((v) => String(v).includes(q))) return false;
    const status = state.filters.status;
    if (status) {
      const current = item.running ? "running" : (item.lastRun && item.lastRun.status) || "idle";
      if (status === "idle" && item.running) return false;
      if (status !== "idle" && current !== status) return false;
    }
    const verdict = state.filters.verdict;
    if (verdict) {
      const current = (item.lastAudit && item.lastAudit.verdict) || "unknown";
      if (current !== verdict) return false;
    }
    return true;
  }

  async function renderWorkers(silent) {
    const data = await api("/api/workers");
    const items = data.items.filter(matchWorkerFilters);
    const grid = `<div class="worker-grid">${
      items.length ? items.map(workerCard).join("") : `<div class="panel"><p class="empty">ورکری با این فیلتر پیدا نشد.</p></div>`
    }</div>`;
    if (silent) {
      const existing = els.content.querySelector(".worker-grid");
      if (existing) {
        existing.outerHTML = grid;
        bindWorkerActions(els.content);
        return;
      }
    }
    els.content.innerHTML = renderFilterBar("workers") + grid;
    bindFilters();
    bindWorkerActions(els.content);
  }

  function renderPassword() {
    els.content.innerHTML = `<form class="panel pass-form" id="pass-form" style="padding:1.2rem">
      <label>رمز فعلی <input name="current" type="password" required></label>
      <label>رمز جدید <input name="next" type="password" minlength="6" required></label>
      <p id="pass-msg" class="muted"></p>
      <button type="submit">ذخیره رمز</button>
    </form>`;
    document.getElementById("pass-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.target).entries());
      const res = await fetch("/api/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = await res.json();
      const msg = document.getElementById("pass-msg");
      msg.textContent = res.ok ? "رمز به‌روز شد." : body.error || "خطا";
      msg.style.color = res.ok ? "var(--ok)" : "var(--danger)";
    });
  }

  async function renderList() {
    const item = currentNav();
    await loadFacets(item.id);
    const params = new URLSearchParams({ page: String(state.page) });
    if (item.kind) params.set("kind", item.kind);
    for (const [key, value] of Object.entries(state.filters)) {
      if (value) params.set(key, value);
    }
    const data = await api(`${item.api}?${params}`);
    els.content.innerHTML = renderFilterBar(item.id) + renderTable(item.id, data);
    bindFilters();
    els.content.querySelectorAll("tr[data-id]").forEach((row) => {
      row.addEventListener("click", () => openRow(item.id, row.dataset.id));
    });
    els.content.querySelectorAll(".pager button[data-page]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const next = Number(btn.dataset.page);
        if (next >= 1) {
          state.page = next;
          render();
        }
      });
    });
  }

  async function render() {
    const item = currentNav();
    els.title.textContent = item.label;
    els.crumb.textContent = item.group || item.kind ? "مجوزها" : "کارپوشه";
    if (item.id === "password") els.crumb.textContent = "حساب";
    if (item.id === "workers") els.crumb.textContent = "اجرا";
    renderNav();
    els.searchForm.hidden = true;
    stopWorkerPoll();
    els.content.innerHTML = `<p class="status">در حال خواندن داده…</p>`;
    try {
      if (item.id === "dashboard") await renderDashboard();
      else if (item.id === "password") renderPassword();
      else if (item.id === "workers") {
        await renderWorkers();
        state.workerPoll = setInterval(() => {
          if (state.view === "workers") renderWorkers(true).catch(() => {});
        }, 2500);
      }
      else await renderList();
    } catch (err) {
      els.content.innerHTML = `<p class="empty">${escapeHtml(err.message)}</p>`;
    }
  }

  function readHash() {
    const raw = (location.hash.replace(/^#\/?/, "") || "dashboard").split("?")[0];
    const found = flatNav().some((item) => item.id === raw);
    state.view = found ? raw : "dashboard";
    state.page = 1;
  }

  document.getElementById("logout").addEventListener("click", async () => {
    await fetch("/api/logout", { method: "POST" });
    location.href = "/login";
  });
  document.getElementById("drawer-close").addEventListener("click", closeDrawer);
  els.backdrop.addEventListener("click", closeDrawer);
  els.searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    state.q = els.search.value.trim();
    state.page = 1;
    render();
  });
  window.addEventListener("hashchange", () => {
    closeDrawer();
    state.q = "";
    state.filters = {};
    state.facets = {};
    readHash();
    render();
  });

  (async () => {
    const me = await api("/api/me");
    els.who.textContent = me.username;
    readHash();
    render();
  })();
})();
