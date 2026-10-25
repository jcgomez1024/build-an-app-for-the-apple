// ui1 (2026-10-16): photo menu, step-by-step photo customization, DOBLE bar, photo cart and visual receipt.
// Real data only: /api/<tenant>/menu (items + modifier groups in website order) and /api/<tenant>/ui/catalog
// (website categories + hours). The cart is app.js's cart (window.elviBridge), so taps, chat and voice share it.
const TENANT = "cocina-elvis";
// v3menu: the browsable menu is the default (Carlos approved 10/21). ?menu=old = previous ui1 home.
const Q3 = (() => { try { return new URLSearchParams(location.search); } catch { return new Map(); } })();
const V3 = Q3.get("menu") !== "old";
// time1: browsing/adding is never blocked by store hours; timing (ASAP / Programar) is chosen at checkout.
// v3menu: photos with no recorded source (img/SOURCES.tsv) are not shown in the preview.
const UNVERIFIED_IMG = new Set(["meat-carnitas.jpg", "opt-burrito-grande.jpg", "opt-burrito-regular.jpg", "opt-gordita.jpg", "opt-pico-chips.jpg", "opt-quesadilla-comal.jpg", "opt-quesadilla-harina.jpg", "opt-quesadilla-street.jpg", "opt-queso-gordita.jpg", "opt-queso-torta.jpg", "opt-torta.jpg"]);
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const money = (c) => `$${(Number(c || 0) / 100).toFixed(2)}`;
const B = () => window.elviBridge || null;
// Spanish first (most callers); follows the EN/ES pills once a language is picked in app.js.
const lang = () => (B()?.state?.language ? (B().lang() === "en" ? "en" : "es") : "es");
const t = (es, en) => (lang() === "es" ? es : en);
const CUST = { me: null, step: "phone", phone: "", err: "", greeted: false }; // cust1

// ---------- photos ----------
const PRODUCT_PHOTO = {"Gordita":"gordita.jpg","Quesadilla":"quesadilla.jpg","Medium Fiesta Platter":"medium-fiesta-platter.jpg","Large Fiesta Platter":"large-fiesta-platter.jpg","Extras":"extras.jpg","3 Pack MEAL":"3-pack-meal.jpg","4 Pack MEAL":"4-pack-meal.jpg","5 Pack MEAL":"5-pack-meal.jpg","6 Pack MEAL":"6-pack-meal.jpg","Aguas Frescas":"aguas-frescas.jpg","7 Pack MEAL":"7-pack-meal.jpg","Esquite Elvis":"esquite-elvis.jpg","Taco":"taco.jpg","Chilaquiles con Huevo":"chilaquiles-con-huevo.jpg","Birria de Chivo / Goat Birria":"birria-de-chivo-goat-birria.jpg","Mole Tradicional Platillo":"mole-tradicional-platillo.jpg","Rice / Beans Fiesta Pan":"rice-beans-fiesta-pan.jpg","Fiesta Fajitas":"fiesta-fajitas.jpg","Chiles Rellenos Platillo / Stuffed Poblano Pepper":"chiles-rellenos-platillo-stuffed-poblano-pepper.jpg","8 Pack MEAL":"8-pack-meal.jpg","Enchiladas":"enchiladas.jpg","Menudo":"menudo.jpg","Coca Cola / Pepsi":"coca-cola-pepsi.jpg","Jarrito":"jarrito.jpg","Dips":"dips.jpg","Sangria / Fanta / Squirt / Sprite":"sangria-fanta-squirt-sprite.jpg","Agua or Mineral":"agua-or-mineral.jpg","Ceviche":"ceviche.jpg","Pozole Rojo / Red Pozole":"pozole-rojo-red-pozole.jpg","Traditional Elvis Bowl":"traditional-elvis-bowl.jpg","Nachos Elvis":"nachos-elvis.jpg","Queso Birrias":"queso-birrias.jpg","Platillo de Guisado":"platillo-de-guisado.jpg","Tacos Dorados":"tacos-dorados.jpg","Tortillas":"tortillas.jpg","Torta":"torta.jpg","Tacos al Vapor / Steamed Tacos":"tacos-al-vapor-steamed-tacos.jpg","Huarache Elvis":"huarache-elvis.jpg","Fajitas Elvis":"fajitas-elvis.jpg","Burrito":"burrito.jpg","Sides":"sides.jpg","Platillo Filete de Pescado":"platillo-filete-de-pescado.jpg","Sopesaso Elvis":"sopesaso-elvis.jpg","(QD) Quesadilla Dorada":"qd-quesadilla-dorada.jpg","COMBO Quesadillas":"combo-quesadillas.jpg","COMBO Tacos":"combo-tacos.jpg","COMBO Tortas":"combo-tortas.jpg","COMBO Gorditas":"combo-gorditas.jpg","COMBO Mix":"combo-mix.jpg","COMBO Burrito":"combo-burrito.jpg","Coctel de Camarones / Shrimp Cocktail":"coctel-de-camarones-shrimp-cocktail.jpg","Filete de Pescado / Fish":"filete-de-pescado-fish.jpg","Elvis Dip":"elvis-dip.jpg","Chimichanga":"chimichanga.jpg","Small Fiesta Platter":"small-fiesta-platter.jpg","Pambazo Elvis":"pambazo-elvis.jpg"};
// Carlos's photos with crops (designer PHOTOS list).
const CROPS = { "carlos-frijoles.jpg": { focus: "50% 47%", zoom: 1.85 }, "carlos-arroz.jpg": { focus: "48% 46%", zoom: 1.85 }, "carlos-cabeza.jpg": { focus: "70% 54%", zoom: 1.9 } };
const CATEGORY_PHOTO = [[/most popular/i, null, "Más populares", "Most popular"], [/favorit/i, "taco.jpg", "Favoritos", "Top Favorites"], [/combos/i, "combo-tacos.jpg", "Elvis Combos", "Elvis Combos"], [/traditional/i, "mole-tradicional-platillo.jpg", "Platillos Tradicionales", "Traditional Meals"], [/elvis meals/i, "4-pack-meal.jpg", "Elvis Meals (Packs)", "Elvis Meals (Packs)"], [/especial del dia/i, "birria-de-chivo-goat-birria.jpg", "Especial del Día", "Day Special"], [/traditional/i, "mole-tradicional-platillo.jpg", "Platillos Tradicionales", "Traditional Meals"], [/enchiladas/i, "enchiladas.jpg", "Enchiladas / Tacos al Vapor", "Enchiladas / Steamed Tacos"], [/sabado/i, "menudo.jpg", "Sábado / Domingo", "Sat / Sun Special"], [/mariscos/i, "coctel-de-camarones-shrimp-cocktail.jpg", "Mariscos", "Seafood"], [/dips/i, "dips.jpg", "Dips / Acompañantes", "Dips / Sides"], [/bebidas/i, "aguas-frescas.jpg", "Bebidas", "Drinks"], [/fiesta/i, "medium-fiesta-platter.jpg", "Fiesta Platters", "Fiesta Platters"]];
// Option photos (designer mapping). First match wins; null = gray placeholder on purpose.
const OPTION_PHOTO = [
  // warm1 (Carlos): QD Versión thumbs — Regular vs Deluxe Preparada (not shared qd-quesadilla-dorada.jpg)
  [/^regular\s+dorada/i, "qd-regular.jpg"], [/^deluxe\s+preparada/i, "qd-deluxe.jpg"],
  [/horchata|jamaica|costilla/i, null],
  [/extra\s+side\s+crema|crema\s+aparte/i, "taco-10.jpg"], [/extra\s+side\s+queso\s+fresco/i, "taco-9.jpg"], [/lim[oó]n|lime/i, "taco-8.jpg"],
  [/guacamole\s+salsa/i, "taco-7.jpg"], [/cebolla\s+y\s+chiles/i, "taco-2.jpg"],
  [/salsa\s+asada/i, "taco-6.jpg"], [/salsa\s+tomato/i, "taco-5.jpg"], [/salsa\s+verde/i, "taco-4.jpg"], [/salsa\s+roja/i, "taco-3.jpg"],
  [/^quesadilla\s+comal|\(qc[o0]\)/i, "opt-quesadilla-comal.jpg"], [/^quesadilla\s+(de\s+)?harina|\(qhr\)/i, "opt-quesadilla-harina.jpg"], [/quesadilla\s+taquera|\(qst\)/i, "opt-quesadilla-street.jpg"],
  [/comal\s*\/\s*homemade/i, "taco.jpg"], [/harina\s*\/\s*flour/i, "taco-11.jpg"], [/taquero|street/i, "taco-12.jpg"],
  [/^queso\s+gordita/i, "opt-queso-gordita.jpg"], [/^\(?gd\)?\s*gordita|^gordita$/i, "opt-gordita.jpg"], [/^queso\s+torta/i, "opt-queso-torta.jpg"], [/^\(?to\)?\s*torta$|^torta$/i, "opt-torta.jpg"],
  [/grande\s*'?\s*12/i, "opt-burrito-grande.jpg"], [/regular\s*'?\s*10/i, "opt-burrito-regular.jpg"], [/pico\s+de\s+gallo/i, "opt-pico-chips.jpg"],
  [/^bistec/i, "taco-15.jpg"], [/alpastor/i, "taco-18.jpg"], [/^pollo/i, "taco-17.jpg"], [/^chorizo/i, "taco-24.jpg"], [/^carnitas/i, "meat-carnitas.jpg"], [/^cabeza/i, "carlos-cabeza.jpg"],
  [/^buche/i, "taco-19.jpg"], [/^lengua/i, "taco-20.jpg"], [/^tripa/i, "taco-21.jpg"], [/^prensado/i, "taco-22.jpg"], [/^duro/i, "taco-23.jpg"], [/^deshebrada/i, "taco-1.jpg"],
  [/^picadillo/i, "taco-16.jpg"], [/^nopales/i, "taco-13.jpg"], [/^vegetal/i, "taco-14.jpg"],
  [/frijol/i, "carlos-frijoles.jpg"], [/arroz/i, "carlos-arroz.jpg"], [/queso\s+fresco/i, "taco-9.jpg"], [/crema/i, "taco-10.jpg"], [/cebolla/i, "carlos-cebolla.jpg"], [/cilantro/i, "carlos-cilantro.jpg"],
];
function img(file, label, extra = "") {
  if (V3 && file && UNVERIFIED_IMG.has(file)) file = null;
  if (!file) return `<div class="u1-ph ${extra}"><span>${esc(label || "")}</span></div>`;
  if (/^https?:/.test(file)) return `<img class="u1-img ${extra}" src="${esc(file)}" alt="" loading="lazy">`;
  const c = CROPS[file];
  return c
    ? `<div class="u1-crop ${extra}"><img src="./img/${file}" alt="" loading="lazy" style="transform:scale(${c.zoom});transform-origin:${c.focus}"></div>`
    : `<img class="u1-img ${extra}" src="./img/${file}" alt="" loading="lazy">`;
}
function itemPhoto(item) {
  const product = U.productOf.get(item.id) || "";
  if (/horchata|jamaica/i.test(item.name)) return null;
  return PRODUCT_PHOTO[product] || PRODUCT_PHOTO[item.name] || item.imageUrl || null;
}
function optionPhoto(name) {
  const clean = cleanOpt(name);
  for (const [re, f] of OPTION_PHOTO) if (re.test(clean)) return f;
  return null;
}

// ---------- labels ----------
function cleanOpt(name) {
  return String(name || "").replace(/\s*\(\s*[+-]?\$[\d.]+\s*\)/g, "").replace(/^\s*\*+\s*/, "").replace(/^\s*\([A-Za-z0-9]{1,4}\)\s*/, "").replace(/\s+/g, " ").trim();
}
function optLabel(name) {
  if (globalThis.ElviI18n) return globalThis.ElviI18n.label(cleanOpt(name).replace(/^EXTRA\s+/i, "").replace(/^SIDE\s+/i, ""), lang()); // i18n1 (tile shows its +$ chip; no EXTRA/SIDE noise, as before)
  const c = cleanOpt(name).replace(/^EXTRA\s+/i, "").replace(/^SIDE\s+/i, "");
  const parts = c.split(" / ");
  return lang() === "es" ? parts[0] : (parts[1] || parts[0]);
}
function groupLabel(g) {
  const n = cleanOpt(g.name).replace(/^(T|Q|G|TO|CB|GQT|B)\s+/i, "");
  // warm1 (Carlos): QD first group = Versión / Version (Regular | Deluxe Preparada)
  if (/dorada.*options|quesadilla dorada options|versi[oó]n/i.test(n) || (isSkuOption(g) && (g.options || []).some((o) => /regular|deluxe/i.test(String(o.name || o))))) return t("Versión", "Version");
  if (isSkuOption(g)) return t("Estilo", "Style");
  // Estilo on screen for tortilla option groups (site customize lead step)
  if (/tortilla|shell/i.test(n)) return t("Estilo", "Style");
  if (/size|tama/i.test(n)) return t("Tamaño", "Size");
  // fill1 (Carlos): a "meat" group that also offers cheese / potatoes is a filling, not a meat.
  if (/carne|meat/i.test(n) && (g.options || []).some((o) => /\b(queso|cheese|papas?|potato(es)?)\b/i.test(cleanOpt(o.name || o)))) return t("Relleno", "Filling (Relleno)");
  if (/carne|meat/i.test(n)) return t("Carne", "Meat");
  if (/burrito.*options|adentro/i.test(n)) return t("Adentro", "Inside");
  if (/salsa/i.test(n)) return "Salsa";
  if (/^con\b/i.test(n)) return t("Con", "With");
  if (/deluxe/i.test(n)) return "Deluxe";
  if (/agua fresca/i.test(n)) return "Agua Fresca";
  if (/extra/i.test(n)) return "Extras";
  if (/side|dip/i.test(n)) return t("Acompañante", "Side");
  const parts = n.split(" / ");
  return lang() === "es" ? parts[0] : (parts[1] || parts[0]);
}
const itemName = (it) => { const n = String((lang() === "es" ? it.nameEs : it.name) || it.name); return /fiesta pan/i.test(n) ? n : n.split(" / ")[0]; };

// ---------- rules ----------
const isFillings = (g) => /burrito\s+(combo\s+)?options/i.test(g.name) && !/salsa/i.test(g.name);
// sku1: reviewed-*-options (multi-SKU flatten: Regular/Deluxe, pack style, etc.) — always required first.
const isSkuOption = (g) => /^reviewed-.*-options$/i.test(String(g?.id || "")) || (/\boptions\b/i.test(String(g?.name || "")) && Number(g?.maxSelections) === 1 && !/salsa|carne|meat|extra|con\b|with\b|burrito/i.test(String(g?.name || "")));
const isDouble = (o) => /^\W*double\s+/i.test(String(o.name || o));
const isIncludedSalsa = (g) => /\bsalsa\b.*\b(preferencia|preference|options)\b/i.test(g.name) && !/^\W*(\(\w+\)\s*)?(extra|add)\b|\b\d\s*oz\b/i.test(g.name);
const minOf = (g) => Math.max(Number(g.minSelections || 0), isFillings(g) ? 1 : 0, isSkuOption(g) ? 1 : 0);
const maxOf = (g) => (Number(g.maxSelections) > 0 ? Number(g.maxSelections) : 99);
function defaultsOf(g) {
  const out = new Set(g.defaultOptions || []);
  if (isIncludedSalsa(g)) {
    const a = (g.options || []).find((o) => cleanOpt(o.name).toLowerCase() === "mild salsa asada" && !Number(o.priceDeltaCents || 0));
    if (a) out.add(a.name);
  }
  return [...out];
}
const isMain = (g) => minOf(g) > 0 || defaultsOf(g).length > 0;
function baseOptions(g) { return (g.options || []).filter((o) => !isDouble(o)); }
function twinOf(g, o) {
  const key = cleanOpt(o.name).toLowerCase();
  return (g.options || []).find((x) => isDouble(x) && cleanOpt(String(x.name).replace(/^\W*double\s+/i, "")).toLowerCase() === key) || null;
}

// ---------- state ----------
const U = { menu: [], cats: [], productOf: new Map(), screen: "home", cat: null, item: null, step: 0, sel: {}, dbl: {}, last: {}, toast: null };

async function load() {
  const [m, c] = await Promise.all([fetch(`/api/${TENANT}/menu`).then((r) => r.json()), fetch(`/api/${TENANT}/ui/catalog${V3 ? "?v3=1" : ""}`).then((r) => r.json())]);
  if (V3) { U.store = v3Store(c.storeState); U.popular = c.popular || []; }
  U.menu = m.items || [];
  const cats = c.categories || [];
  for (const cat of cats) for (const x of cat.items) U.productOf.set(x.id, x.product);
  // ui5: same categories, same order as cocinaelvis.com (Most popular first, like the site).
  U.cats = cats;
}

function catMeta(cat) { const m = CATEGORY_PHOTO.find(([re]) => re.test(cat.name)); return m ? { photo: m[1], es: m[2], en: m[3] } : { photo: null, es: cat.name, en: cat.name }; }

// ---------- render ----------
function render() {
  const root = $("#ui1-main");
  if (!root) return;
  globalThis.__custRefresh?.(); // i18n1: header "Iniciar sesión" / "Sign in" follows the language
  document.documentElement.lang = lang();
  U.lang = lang();
  const sub = $("#ui1 .u1-head small"); if (sub) sub.textContent = V3 ? "101 W Walnut Ave · Painesville" : t("Pide con Elvi · Painesville", "Order with Elvi · Painesville");
  if (V3) document.body.classList.remove("v3-view-elvi"); // carlos-ux: menu-only; Hablar always the voice entry
  if (V3 && U.screen === "item") { if (!root.innerHTML) root.innerHTML = v3HTML(); v3RenderSheet(); renderBar(); renderCartStrip(); v3Side(); v3Line(); return; }
  if (V3) { U.v3focused = false; v3RenderSheet(); }
  if (U.screen === "home") { if (V3) { const y = window.scrollY; root.innerHTML = v3HTML(); v3After(y); } else root.innerHTML = homeHTML(); }
  else if (U.screen === "cat" || U.screen === "prod") root.innerHTML = catHTML();
  else if (U.screen === "item") root.innerHTML = itemHTML();
  else if (U.screen === "receipt") root.innerHTML = receiptHTML();
  renderBar();
  renderCartStrip();
  if (V3) { v3Side(); v3Line(); }
}
function homeHTML() {
  return `<h2 class="u1-h2">${t("¿Qué se te antoja?", "What are you craving?")}</h2><div class="u1-grid">${U.cats.map((c, i) => {
    const m = catMeta(c);
    const closed = !c.available;
    const first = !m.photo && c.items[0] && U.menu.find((it) => it.id === c.items[0].id);
    const hours = c.window ? t(c.window.es, c.window.en) : "";
    return `<button class="u1-tile ${closed ? "is-closed" : ""}" data-cat="${i}">${img(m.photo || (first && itemPhoto(first)), m.es)}<div class="u1-lbl">${esc(t(m.es, m.en))}${c.customTimes ? `<small>${closed ? esc(t("Cerrado ahora · ", "Closed now · ") + hours) : esc(c.today ? t("Hoy ", "Today ") + c.today : "")}</small>` : ""}</div></button>`;
  }).join("")}</div>`;
}
function catHTML() {
  const c = U.cats[U.cat]; if (!c) return "";
  const m = catMeta(c);
  // ui5: one tile per website product (drinks: "Coca Cola / Pepsi" opens its choices), website order.
  const groups = [];
  for (const x of c.items) { const it = U.menu.find((m2) => m2.id === x.id); if (!it) continue; let g = groups.find((y) => y.product === x.product); if (!g) groups.push(g = { product: x.product, list: [] }); g.list.push({ it, x }); }
  const tile = (g) => {
    const off = g.list.every(({ x }) => x.available === false) || !c.available;
    const w = g.list[0].x.window || c.window;
    const hours = off && w ? `<small class="u1-hours">${esc(t("Cerrado ahora · ", "Closed now · ") + t(w.es, w.en))}</small>` : "";
    if (g.list.length === 1) { const it = g.list[0].it; return `<button class="u1-tile ${off ? "is-closed" : ""}" data-item="${esc(it.id)}" id="u1-it-${esc(it.id)}">${img(itemPhoto(it), itemName(it))}<div class="u1-lbl">${esc(itemName(it))}<small class="u1-price">${money(it.priceCents)}</small>${hours}</div></button>`; }
    const prices = g.list.map(({ it }) => it.priceCents || 0); const lo = Math.min(...prices), hi = Math.max(...prices);
    const name = String(g.product).replace(/\s+or\s+/i, t(" o ", " or "));
    return `<button class="u1-tile ${off ? "is-closed" : ""}" data-prod="${esc(g.product)}">${img(itemPhoto(g.list[0].it), name)}<div class="u1-lbl">${esc(name)}<small class="u1-price">${money(lo)}${hi > lo ? " – " + money(hi) : ""} · ${g.list.length} ${t("opciones", "choices")}</small>${hours}</div></button>`;
  };
  if (U.screen === "prod" && U.prod) {
    const g = groups.find((y) => y.product === U.prod);
    if (g) return `<div class="u1-row"><button class="u1-btn s" data-go="cat">←</button><h2 class="u1-h2">${esc(U.prod)}</h2></div><div class="u1-grid">${g.list.map(({ it, x }) => tile({ product: it.name, list: [{ it, x }] })).join("")}</div>`;
  }
  return `<div class="u1-row"><button class="u1-btn s" data-go="home">←</button><h2 class="u1-h2">${esc(t(m.es, m.en))}</h2></div>
  ${!c.available ? `<p class="u1-note">${t("Esta categoría no está disponible ahora", "This category isn't available right now")}${c.window ? ` · ${esc(t(c.window.es, c.window.en))}` : ""}</p>` : ""}
  <div class="u1-grid">${groups.map(tile).join("")}</div>`;
}
function steps() {
  const gs = U.item.modifierGroups || [];
  const main = gs.map((g, i) => i).filter((i) => isMain(gs[i]));
  // warm1: keep Square/website modifier order (a-b). Only reviewed-*-options (QD Versión, pack style) floats to front.
  main.sort((a, b) => Number(isSkuOption(gs[b])) - Number(isSkuOption(gs[a])) || a - b);
  return { main, extra: gs.map((g, i) => i).filter((i) => !isMain(gs[i])) };
}
function itemTotal() {
  const it = U.item; let c = Number(it.priceCents || 0);
  for (const m of buildModifiers()) c += Number(m.priceDeltaCents || 0) * (Number(m.quantity) || 1);
  return c;
}
function openItem(id) {
  const it = U.menu.find((m) => m.id === id);
  if (!it) return;
  U.item = it; U.sel = {}; U.dbl = {}; U.last = {}; U._v3AskKey = null;
  (it.modifierGroups || []).forEach((g) => { U.sel[g.id] = {}; U.dbl[g.id] = new Set(); for (const d of defaultsOf(g)) U.sel[g.id][d] = 1; });
  const { main, extra } = steps();
  U.step = main.find((i) => !Object.keys(U.sel[it.modifierGroups[i].id]).length) ?? (main[0] ?? (extra.length ? "x" : null));
  if (!(it.modifierGroups || []).length) { addToCart(it, []); return; }
  U.screen = "item"; render(); window.scrollTo(0, 0);
}
function tilesFor(gi) {
  const g = U.item.modifierGroups[gi];
  const sel = U.sel[g.id], dbl = U.dbl[g.id];
  const defs = defaultsOf(g);
  const opts = baseOptions(g);
  let h = "";
  for (let r = 0; r < opts.length; r += 3) {
    const row = opts.slice(r, r + 3);
    row.forEach((o) => {
      const on = Boolean(sel[o.name]);
      const q = sel[o.name] || 0;
      const d = dbl.has(o.name);
      h += `<button class="u1-tile u1-opt ${on ? "sel" : ""}" data-g="${gi}" data-o="${esc(o.name)}" id="u1-o-${gi}-${opts.indexOf(o)}">${d ? `<span class="u1-dtag">${t("DOBLE", "DOUBLE")} ✓</span>` : ""}${defs.includes(o.name) ? `<span class="u1-def">${t("Recomendado", "Default")}</span>` : ""}${img(optionPhoto(o.name), optLabel(o.name))}<div class="u1-lbl">${esc(optLabel(o.name))}</div>${o.priceDeltaCents ? `<span class="u1-chip">+${money(o.priceDeltaCents)}</span>` : ""}${g.allowQuantities && q > 1 ? `<span class="u1-qty">×${q}</span>` : ""}</button>`;
    });
    const last = U.last[g.id];
    const lastOpt = row.find((o) => o.name === last && sel[o.name]);
    const twin = lastOpt && twinOf(g, lastOpt);
    if (twin) {
      const col = row.indexOf(lastOpt);
      const on = dbl.has(lastOpt.name);
      h += `<button class="u1-dbl ${on ? "on" : ""}" style="--nx:${[14, 47, 80][col]}%" data-dbl="${gi}" data-o="${esc(lastOpt.name)}"><span class="ck">${on ? "✓" : ""}</span><span>${t("DOBLE", "DOUBLE")} ${esc(optLabel(lastOpt.name).toUpperCase())}</span><span class="pr">+${money(Number(twin.priceDeltaCents || 0) - Number(lastOpt.priceDeltaCents || 0))}</span></button>`;
    }
  }
  return h;
}
function stepHint(g) { const mx = maxOf(g); return mx > 1 ? (mx > 8 ? t("Elige los que quieras", "Choose any") : t(`Elige hasta ${mx}`, `Choose up to ${mx}`)) : ""; }
function itemHTML() {
  const it = U.item, gs = it.modifierGroups || [];
  const { main, extra } = steps();
  const onX = U.step === "x";
  const tabs = main.map((i, k) => {
    const g = gs[i]; const n = Object.keys(U.sel[g.id]).length; const need = minOf(g) > 0 && !n;
    return `<button class="u1-tab ${i === U.step ? "on" : ""} ${n ? "done" : ""}" data-step="${i}"><span class="n">${n ? "✓" : k + 1}</span>${esc(groupLabel(g))}${need ? '<i class="u1-req" title="required"></i>' : ""}</button>`;
  }).join("") + (extra.length ? `<button class="u1-tab dash ${onX ? "on" : ""}" data-step="x"><span class="n">${extra.reduce((a, i) => a + Object.keys(U.sel[gs[i].id]).length, 0) || "+"}</span>${t("Agregar extras", "Add extras")}</button>` : "");
  let body = "";
  if (onX) {
    body = `<div class="u1-q">${t("Agregar extras", "Add extras")}</div><div class="u1-reqtxt">${t("Opcional · Elvi nunca lo pregunta", "Optional · Elvi never asks")}</div>` + extra.map((i) => `<div class="u1-q sm">${esc(groupLabel(gs[i]))}<span class="hint">${stepHint(gs[i])}</span></div><div class="u1-grid opts">${tilesFor(i)}</div>`).join("");
  } else if (U.step !== null) {
    const g = gs[U.step];
    const pre = defaultsOf(g).length;
    const mn = minOf(g), mx = maxOf(g);
    body = `<div class="u1-q"><span>${esc(groupLabel(g))}</span><span class="hint">${stepHint(g)}</span></div><div class="u1-reqtxt">${pre ? t("Ya elegido por defecto · toca para cambiar", "Preselected · tap to change") : mn ? (mx > 2 ? t("Requerido · elige todo lo que quieras adentro, luego toca Listo", "Required · pick everything you want inside, then tap Done") : t(`Requerido · elige ${mx > 1 ? "hasta " + mx : "1"}`, `Required · pick ${mx > 1 ? "up to " + mx : "1"}`)) : t("Opcional", "Optional")}</div><div class="u1-grid opts">${tilesFor(U.step)}</div>`;
  }
  return `<div class="u1-hero">${img(itemPhoto(it), itemName(it))}<div><b>${esc(itemName(it))}</b><div class="u1-price">${money(itemTotal())}</div><div class="u1-mut">${onX ? t("Opcional", "Optional") : t("Paso", "Step") + " " + (main.indexOf(U.step) + 1) + "/" + main.length}</div></div></div><div class="u1-tabs">${tabs}</div>${body}`;
}
function pick(gi, name) {
  const g = U.item.modifierGroups[gi]; const sel = U.sel[g.id]; const mx = maxOf(g);
  const count = () => Object.values(sel).reduce((a, b) => a + b, 0);
  if (sel[name]) {
    if (g.allowQuantities && count() < mx) { sel[name] += 1; }
    else if (!(minOf(g) === 1 && mx === 1)) { delete sel[name]; U.dbl[g.id].delete(name); if (U.last[g.id] === name) U.last[g.id] = null; }
  } else {
    if (mx === 1) { for (const k of Object.keys(sel)) delete sel[k]; U.dbl[g.id].clear(); }
    if (count() < mx) { sel[name] = 1; U.last[g.id] = name; }
  }
  render();
  const { main } = steps();
  if (gi === U.step && mx === 1 && main.indexOf(gi) < main.length - 1) setTimeout(() => { U.step = main[main.indexOf(gi) + 1]; render(); }, 250);
}
function buildModifiers() {
  const out = [];
  for (const g of U.item.modifierGroups || []) {
    for (const [name, q] of Object.entries(U.sel[g.id] || {})) {
      let o = (g.options || []).find((x) => x.name === name);
      if (!o) continue;
      if (U.dbl[g.id]?.has(name)) o = twinOf(g, o) || o;
      out.push({ groupId: g.id, groupName: g.name, option: o.name, optionId: o.id, priceDeltaCents: Number(o.priceDeltaCents || 0), quantity: q, ...(defaultsOf(g).includes(name) ? { isDefault: true } : {}) });
    }
  }
  return out;
}
function missingStep() { const gs = U.item.modifierGroups || []; return steps().main.find((i) => minOf(gs[i]) > 0 && !Object.keys(U.sel[gs[i].id]).length); }
function addToCart(item, mods) {
  const b = B(); if (!b) return;
  if (V3) { // v3menu: same add step Elvi uses (validation + applyActions), and Elvi is told about it
    const r = b.addFromMenu ? b.addFromMenu(item, 1, mods) : null;
    if (r && !r.ok) { v3Say(t(`Falta: ${(r.missing || []).join(", ")}`, `Missing: ${(r.missing || []).join(", ")}`)); return; }
    if (!r) b.addCartItem(item, 1, mods);
    b.renderCart(); showToast(item, mods, r?.said || ""); U.screen = "home"; render(); return;
  }
  b.addCartItem(item, 1, mods);
  b.renderCart();
  const said = b.readback?.([{ item, quantity: 1, modifiers: mods }]) || "";
  showToast(item, mods, said);
  U.screen = U.cat !== null ? "cat" : "home"; render();
}
function renderBar() {
  const bar = $("#ui1-bar"); if (!bar) return;
  const b = B(); const cart = b?.state?.cart || [];
  const n = cart.reduce((a, l) => a + (Number(l.quantity) || 1), 0);
  const tot = cart.reduce((a, l) => a + (b?.lineTotal?.(l) || 0), 0);
  if (U.screen === "item" && !V3) {
    const gs = U.item.modifierGroups || [];
    const st = U.step !== "x" && U.step !== null ? gs[U.step] : null;
    const miss = missingStep();
    if (st && minOf(st) > 0 && maxOf(st) > 2) { const c = Object.keys(U.sel[st.id]).length; bar.innerHTML = `<button class="u1-btn s" data-go="back">←</button><button class="u1-btn g" ${c ? "" : "disabled"} data-next="1">${t("Listo", "Done")} ✓ (${c})</button>`; return; }
    if (miss !== undefined) { bar.innerHTML = `<button class="u1-btn s" data-go="back">←</button><button class="u1-btn p" data-step="${miss}">${t("Falta", "Still need")}: ${esc(groupLabel(gs[miss]))} →</button>`; return; }
    bar.innerHTML = `<button class="u1-btn s" data-go="back">←</button>${U.step !== "x" && steps().extra.length ? `<button class="u1-btn s" data-next="1">→</button>` : ""}<button class="u1-btn p" data-add="1">${t("Agregar", "Add")} · ${money(itemTotal())}</button>`;
    return;
  }
  if (U.screen === "receipt") { bar.innerHTML = `<button class="u1-btn s" data-go="home">${t("Menú", "Menu")}</button><button class="u1-btn s" data-read="1">🔊 ${t("Leer otra vez", "Read again")}</button>`; return; }
  if (V3) { const when = t("Ver orden", "View order");
    document.body.classList.toggle("v3-cart0", !n);
    bar.innerHTML = `<button class="u1-btn p v3-cartbar" data-go="receipt" ${n ? "" : "disabled"}>🛒 ${n} · ${esc(when)}<span>${money(tot)}</span></button><div class="v3-ebar"><span class="v3-dot"></span><div><small>Elvi</small><p id="v3-line"></p></div></div>`; return; }
  bar.innerHTML = `<button class="u1-btn p" data-go="receipt" ${n ? "" : "disabled"}>🛒 ${n} · ${money(tot)} — ${t("Ver orden", "View order")}</button>`;
}
function modsText(line) {
  return (line.modifiers || []).map((m) => {
    const dbl = isDouble({ name: m.option });
    const l = optLabel(String(m.option).replace(/^\W*double\s+/i, ""));
    return `${dbl ? t("doble ", "double ") : ""}${l}${Number(m.quantity) > 1 ? ` ×${m.quantity}` : ""}`;
  }).filter(Boolean).join(" · ");
}
function renderCartStrip() {
  const el = $("#ui1-cart"); if (!el) return;
  const cart = B()?.state?.cart || [];
  el.classList.toggle("is-empty", !cart.length);
  el.innerHTML = cart.map((l, i) => `<button class="u1-ci ${i === U.flyIndex ? "fly" : ""}" data-go="receipt" title="${esc(l.item.name)}">${img(itemPhoto(l.item), itemName(l.item))}<div>${Number(l.quantity) > 1 ? l.quantity + " × " : ""}${esc(itemName(l.item))}</div></button>`).join("");
  U.flyIndex = -1;
}
function receiptHTML() {
  const b = B(); const cart = b?.state?.cart || [];
  const tot = cart.reduce((a, l) => a + (b?.lineTotal?.(l) || 0), 0);
  return `<h2 class="u1-h2">${t("Así quedó tu orden", "Here's your order")}</h2>
  <div class="u1-rc">${cart.length ? cart.map((l, i) => `<div class="u1-rl" id="u1-rl-${i}">${img(itemPhoto(l.item), itemName(l.item))}<div class="d"><b>${Number(l.quantity) > 1 ? l.quantity + " × " : ""}${esc(itemName(l.item))}</b><br><span>${esc(modsText(l))}</span></div><div class="u1-price">${money(b.lineTotal(l))}</div><button class="u1-x" data-rm="${i}" aria-label="remove">✕</button></div>`).join("") : `<p class="u1-note">${t("Tu orden está vacía.", "Your order is empty.")}</p>`}
  <div class="u1-tot"><span>Subtotal</span><span>${money(tot)}</span></div><div class="u1-note">${t("Impuesto y total final los calcula Square.", "Tax & final total calculated by Square.")}</div></div>
  ${timingHTML()}`;
}
async function readBack() {
  const cart = B()?.state?.cart || [];
  for (let i = 0; i < cart.length; i++) {
    document.querySelectorAll(".u1-rl").forEach((e) => e.classList.remove("hl"));
    const e = $(`#u1-rl-${i}`); if (!e) return; e.classList.add("hl");
    await new Promise((r) => setTimeout(r, 1300));
  }
  document.querySelectorAll(".u1-rl").forEach((e) => e.classList.remove("hl"));
}
function showToast(item, mods, said) {
  const el = $("#ui1-toast"); if (!el) return;
  const thumbs = (mods || []).slice(0, 6).map((m) => `<div class="u1-tt">${img(optionPhoto(String(m.option).replace(/^\W*double\s+/i, "")), optLabel(m.option))}<small>${esc(optLabel(String(m.option).replace(/^\W*double\s+/i, "")))}</small></div>`).join("");
  el.innerHTML = `<div class="u1-toast-in">${img(itemPhoto(item), itemName(item), "big")}<div class="u1-toast-txt"><b>${t("Agregado", "Added")}: ${esc(itemName(item))}</b><p>${esc(said || "")}</p><div class="u1-thumbs">${thumbs}</div></div></div>`;
  el.classList.add("on");
  clearTimeout(U.toast); U.toast = setTimeout(() => el.classList.remove("on"), 4200);
}

// ---------- v3menu: one scrolling menu, sticky tabs + scroll-spy ----------
function v3Store(st) { if (!st) return null;
  const later = { es: "puedes ordenar ahora para más tarde", en: "you can order now for later" };
  if (st.state === "before_open") return { ...st, banner: { es: `${st.pill.es.replace(/^Abre /, "Abrimos ")} · ${later.es}`, en: `${st.pill.en.replace(/^Opens /, "We open ")} · ${later.en}` } };
  if (st.state === "closed") return { ...st, banner: { es: `Cerrado${st.nextOpen ? " · " + st.nextOpen.es.replace(/^abrimos/, "abrimos") : ""} · ${later.es}`, en: `Closed${st.nextOpen ? " · " + st.nextOpen.en : ""} · ${later.en}` } };
  return st; }
function v3Live() { return !U.store || U.store.state === "open" || U.store.state === "last_order"; }
function v3CanOrder() { return true; } // time1: never block adds; unavailable-at-time items are flagged at checkout
function v3Say(text) { const r = document.querySelector("#assistant-reply"); if (r) r.textContent = text; }
function v3Closed(item) { const s = U.store; if (item && U.sched) { v3Say(t(`${itemName(item)} no está disponible a esa hora.`, `${itemName(item)} is not available at that time.`)); return; } v3Say(s?.state === "before_open" ? t(s.banner.es, s.banner.en) : t(`Ahora estamos cerrados${s?.nextOpen ? " — " + s.nextOpen.es : ""}.`, `We're closed right now${s?.nextOpen ? " — " + s.nextOpen.en : ""}.`)); const el = document.querySelector("#elvi-halo"); if (el) { el.classList.add("v3-err"); setTimeout(() => el.classList.remove("v3-err"), 1500); } }
function v3Price(list) { const p = list.map((it) => it.priceCents || 0); const lo = Math.min(...p), hi = Math.max(...p); return money(lo) + (hi > lo ? "–" + money(hi) : ""); }
function v3Card(list, x, catOpen, popular) {
  const it = list[0];
  const off = !catOpen || list.every((i) => i._x?.available === false); // time-window badge only (not a block)
  const w = x?.window;
  const name = list.length > 1 ? String(x.product).replace(/\s+or\s+/i, t(" o ", " or ")) : itemName(it);
  const photo = itemPhoto(it);
  const desc = String(it.description || "").replace(/\s+/g, " ").trim();
  const badge = off && w ? `<span class="v3-badge t">${esc(t("Disponible ", "Available ") + t(w.es, w.en))}</span>` : popular ? `<span class="v3-badge p">★ Popular</span>` : "";
  const attr = list.length > 1 ? `data-prod="${esc(x.product)}"` : `data-item="${esc(it.id)}"`;
  return `<button class="v3-card ${off ? "is-later" : ""}" ${attr} id="u1-it-${esc(it.id)}">${photo ? `<span class="v3-thumb">${img(photo, name)}</span>` : ""}<span class="v3-body">${badge}<b>${esc(name)}</b>${desc ? `<small class="v3-desc">${esc(desc)}</small>` : ""}<span class="v3-price">${v3Price(list)}${list.length > 1 ? ` · ${list.length} ${t("opciones", "choices")}` : ""}</span></span><span class="v3-plus" aria-hidden="true">+</span></button>`;
}
function v3Groups(cat) {
  const groups = [];
  for (const x of cat.items) { const it = U.menu.find((m) => m.id === x.id); if (!it) continue; it._x = x; let g = groups.find((y) => y.product === x.product); if (!g) groups.push(g = { product: x.product, x, list: [] }); g.list.push(it); }
  return groups;
}
function v3Sections() {
  const out = [];
  const pop = (U.popular || []).map((p) => ({ product: p.product, x: p, list: [U.menu.find((m) => m.id === p.id)].filter(Boolean).map((it) => Object.assign(it, { _x: it._x || p })) })).filter((g) => g.list.length);
  if (pop.length) out.push({ id: "popular", es: "Popular", en: "Popular", open: true, groups: pop, popular: true });
  U.cats.forEach((c, i) => { if (c.popular) return; const m = catMeta(c); out.push({ id: `c${i}`, es: m.es, en: m.en, open: c.available !== false, window: c.window, timed: !!c.customTimes, groups: v3Groups(c) }); });
  return out.filter((s) => s.groups.length);
}
function v3HTML() {
  const s = U.store, secs = v3Sections(); U.v3secs = secs;
  const banner = s?.banner ? `<div class="v3-banner ${s.state} slim">${esc(t(s.banner.es, s.banner.en))}</div>` : "";
  const tabs = `<nav class="v3-tabs" id="v3-tabs" aria-label="${t("Categorías", "Categories")}">${secs.map((x) => `<button type="button" data-v3tab="${x.id}">${esc(t(x.es, x.en))}${x.timed && !x.open ? " ⏱" : ""}</button>`).join("")}</nav>`;
  const body = secs.map((x) => `<section class="v3-sec" id="s-${x.id}"><h2 class="u1-h2">${esc(t(x.es, x.en))}</h2>${x.timed && x.window ? `<p class="v3-sub">${esc((x.open ? "" : t("Cerrado ahora · ", "Closed now · ")) + t(x.window.es, x.window.en))}</p>` : ""}${x.groups.map((g) => v3Card(g.list, g.x, x.open, x.popular)).join("")}</section>`).join("");
  // carlos-ux: drop Menú|Elvi segmented tabs — menu stays primary; Hablar capsule is voice entry
  return `${banner}${tabs}<div class="v3-list">${body}</div>`;
}
function v3After(y) {
  const pill = document.querySelector("#v3-pill");
  if (pill && U.store) { pill.textContent = t(U.store.pill.es, U.store.pill.en); pill.className = `v3-pill ${U.store.state}`; }
  if (typeof y === "number") window.scrollTo(0, y);
  v3Spy();
}
function v3Offset() { const h = document.querySelector(".u1-head")?.getBoundingClientRect().height || 64; const tb = document.querySelector("#v3-tabs")?.getBoundingClientRect().height || 44; return h + tb; }
let v3Raf = 0;
function v3Spy() {
  if (!V3 || U.screen !== "home" || !U.v3secs) return;
  const lim = v3Offset() + 24; let act = U.v3secs[0]?.id;
  for (const x of U.v3secs) { const el = document.getElementById(`s-${x.id}`); if (el && el.getBoundingClientRect().top <= lim) act = x.id; }
  if (act === U.v3act && document.querySelector('[data-v3tab][aria-current="true"]')) return;
  U.v3act = act;
  document.querySelectorAll("[data-v3tab]").forEach((b) => { const on = b.dataset.v3tab === act; b.classList.toggle("on", on); on ? b.setAttribute("aria-current", "true") : b.removeAttribute("aria-current"); });
  const bar = document.querySelector("#v3-tabs"), b = document.querySelector(`[data-v3tab="${act}"]`);
  if (bar && b && bar.scrollTo) bar.scrollTo({ left: b.offsetLeft - (bar.clientWidth - b.offsetWidth) / 2, behavior: v3Motion() });
}
function v3Motion() { try { return matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"; } catch { return "auto"; } }
if (V3) {
  window.addEventListener("scroll", () => { if (v3Raf) return; v3Raf = requestAnimationFrame(() => { v3Raf = 0; v3Spy(); }); }, { passive: true });
  document.addEventListener("click", (e) => {
    // carlos-ux: Menú|Elvi toggle removed — ignore leftover data-v3view taps
    if (e.target.closest?.("[data-v3view]")) return;
    if (e.target.closest?.("[data-v3x]")) { U.v3x = !U.v3x; return; }
    const b = e.target.closest?.("[data-v3tab]"); if (!b) return;
    const el = document.getElementById(`s-${b.dataset.v3tab}`); if (!el) return;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - v3Offset() - 6, behavior: v3Motion() });
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && U.screen === "item") { U.screen = "home"; render(); } });
  setInterval(v3Line, 500);
  // store state re-evaluated every minute (server time)
  setInterval(() => { fetch(`/api/${TENANT}/ui/catalog?v3=1`).then((r) => r.json()).then((c) => { U.store = v3Store(c.storeState) || U.store; U.popular = c.popular || U.popular; if (U.screen === "home") render(); }).catch(() => {}); }, 60000);
}

function v3CartHTML() {
  const b = B(); const cart = b?.state?.cart || [];
  if (!cart.length) return `<p class="v3-empty">${t("Vacía — agrega algo del menú o dímelo.", "Empty — add something from the menu or tell me.")}</p>`;
  const tot = cart.reduce((a, l) => a + (b?.lineTotal?.(l) || 0), 0);
  const when = "";
  const signin = CUST.me?.loggedIn ? "" : `<p class="cust-prompt"><button type="button" class="cust-link" data-cust="open">${t("Inicia sesión", "Sign in")}</button> ${t("para llenar tus datos y ver tus favoritos.", "to fill in your details and see your favorites.")}</p>`;
  return `${signin}${when}${cart.map((l) => `<div class="v3-cl"><span>${Number(l.quantity) || 1} × ${esc(itemName(l.item))}</span><b>${money(b?.lineTotal?.(l) || 0)}</b></div>`).join("")}<div class="v3-cl tot"><span>Subtotal</span><b>${money(tot)}</b></div><button type="button" class="u1-btn p v3-full" data-go="receipt">${t("Ver orden", "View order")}</button>`;
}
function v3ElviHTML() { return `<section class="v3-elvi"><div class="v3-elvi-card"><span class="v3-dot big"></span><div><b>Elvi</b><small>${t("Pide hablando o tocando el menú", "Order by talking or tapping the menu")}</small></div></div><p class="v3-elvi-line" id="v3-elvi-line"></p><h3>🛒 ${t("Tu orden", "Your order")}</h3>${v3CartHTML()}</section>`; }
function v3Side() {
  let el = document.getElementById("v3-side");
  if (!el) { el = document.createElement("aside"); el.id = "v3-side"; el.className = "v3-side"; document.getElementById("ui1")?.appendChild?.(el); }
  el.innerHTML = `<div class="v3-elvi-card"><span class="v3-dot big"></span><div><b>Elvi</b><small>${t("Pide hablando o tocando el menú", "Order by talking or tapping the menu")}</small></div></div><div class="v3-side-cart"><h3>🛒 ${t("Tu orden", "Your order")}</h3>${v3CartHTML()}</div>`;
}
// Elvi's latest line, mirrored into the compact bar / Elvi view / side panel.
function v3Line() { const txt = document.querySelector("#assistant-reply")?.textContent || ""; for (const id of ["v3-line", "v3-elvi-line"]) { const e = document.getElementById(id); if (e && e.textContent !== txt) e.textContent = txt; } }
// ---------- v3 item sheet: all groups in Square order, Elvi asks only the first missing required group ----------
// warm1 (Carlos): Elvi leads each unfinished required step with a warm, direct invite (footer "Falta:" stays secondary).
function v3StepWord(g) {
  const n = cleanOpt(g.name || "");
  const l = groupLabel(g);
  if (/tortilla|estilo|shell/i.test(n) || /estilo|style|tortilla/i.test(l)) return t("tortilla", "tortilla");
  if (/relleno|filling/i.test(l) || (/carne|meat|relleno/i.test(n) && /relleno|filling/i.test(l))) return t("relleno", "filling");
  if (/carne|meat/i.test(n) || /carne|meat/i.test(l)) return t("relleno", "filling"); // site meats step spoken as relleno/filling
  if (/size|tama/i.test(n) || /tama|size/i.test(l)) return t("tamaño", "size");
  if (/salsa\s+pref|preferencia|preference/i.test(n)) return "salsa";
  if (/lado|side|acompa/i.test(n) || /acompa/i.test(l)) return t("acompañante", "side");
  if (/gordita\s+options/i.test(n)) return "gordita";
  if (/torta\s+options/i.test(n)) return "torta";
  const lab = String(l || "").trim();
  return lab ? lab.toLowerCase() : t("opción", "option");
}
function isQdItem(it) {
  const n = String(it?.name || "");
  return /quesadilla\s+dorada|\(QD\)/i.test(n) || String(it?.id || "").includes("qd-quesadilla-dorada");
}
function isQdVersionGroup(g) {
  const n = cleanOpt(g?.name || "");
  return /dorada.*options|quesadilla dorada options|versi[oó]n/i.test(n)
    || (isSkuOption(g) && (g.options || []).some((o) => /regular|deluxe/i.test(String(o.name || o))));
}
function v3Ask(g) {
  const n = cleanOpt(g.name || "");
  // QD (1) Versión — locked Carlos 10/24
  if (isQdVersionGroup(g)) {
    return t("¿Te gustaría Regular o Deluxe Preparada?", "Would you like Regular or Deluxe Preparada?");
  }
  // QD (2) meats — locked Carlos 10/24 (relleno o carne)
  if (isQdItem(U.item) && /carne|meat|relleno|filling/i.test(n + " " + groupLabel(g))) {
    return t("¿Qué relleno o carne te gustaría?", "What kind of relleno or carne would you like?");
  }
  if (/burrito\s+(combo\s+)?options|adentro/i.test(n) || /adentro|inside/i.test(groupLabel(g))) {
    return t("Yo te puedo ayudar — ¿qué le ponemos adentro?", "I can help — what would you like inside?");
  }
  const w = v3StepWord(g);
  return t(`Yo te puedo ayudar — ¿qué ${w} te gustaría?`, `I can help — what ${w} would you like?`);
}
/** Speak + mirror bubble for the current unfinished required step. Same step → no re-speak (ignore scroll). */
function v3LeadAsk(force) {
  if (!V3 || U.screen !== "item" || !U.item) return;
  const gs = U.item.modifierGroups || [];
  const miss = missingStep();
  const key = miss !== undefined ? `miss:${gs[miss].id}` : `done:${U.item.id}`;
  const picked = buildModifiers().map((m) => optLabel(m.option)).join(", ");
  const say = miss !== undefined
    ? v3Ask(gs[miss])
    : t(`Perfecto: ${itemName(U.item)}${picked ? " — " + picked : ""}.`, `Perfect: ${itemName(U.item)}${picked ? " — " + picked : ""}.`);
  const r = document.querySelector("#assistant-reply"); if (r) r.textContent = say;
  for (const id of ["v3-line", "v3-elvi-line"]) { const e = document.getElementById(id); if (e) e.textContent = say; }
  const askEl = document.querySelector("#v3-sheet-wrap .v3-ask b"); if (askEl) askEl.textContent = say;
  if (!force && U._v3AskKey === key) return;
  U._v3AskKey = key;
  const b = B();
  try { b?.speak?.(say); } catch (e) { console.warn("[warm1] speak", e); }
}
function v3SheetHTML() {
  const it = U.item, gs = it.modifierGroups || []; const { main, extra } = steps(); const miss = missingStep();
  const picked = buildModifiers().map((m) => optLabel(m.option)).join(", ");
  const say = miss !== undefined ? v3Ask(gs[miss]) : t(`Perfecto: ${itemName(it)}${picked ? " — " + picked : ""}.`, `Perfect: ${itemName(it)}${picked ? " — " + picked : ""}.`);
  const grp = (i) => { const g = gs[i]; const need = minOf(g) > 0 && !Object.keys(U.sel[g.id]).length; const mx = maxOf(g);
    return `<div class="v3-grp ${need ? "need" : ""}" id="v3-g-${i}"><div class="v3-gh"><b>${esc(groupLabel(g))}</b><span>${need ? t("Requerido", "Required") + (mx > 1 && mx < 99 ? ` · ${t("hasta", "up to")} ${mx}` : "") : Object.keys(U.sel[g.id]).length ? "✓" : ""}</span></div><div class="u1-grid opts">${tilesFor(i)}</div></div>`; };
  const extras = extra.length ? `<details class="v3-extras" ${U.v3x ? "open" : ""}><summary data-v3x="1">＋ ${t("Agregar extras", "Add extras")}</summary>${extra.map(grp).join("")}</details>` : "";
  // warm1: QD hero follows selected Regular/Deluxe thumb
  let heroPhoto = itemPhoto(it);
  const vgi = gs.findIndex((g) => isQdVersionGroup(g));
  if (vgi >= 0) { const vg = gs[vgi]; const picked = Object.keys(U.sel[vg.id] || {})[0]; if (picked) heroPhoto = optionPhoto(picked) || heroPhoto; }
  const foot = miss !== undefined ? `<button class="u1-btn p v3-full" disabled>${t("Falta", "Still need")}: ${esc(groupLabel(gs[miss]))}</button>` : `<button class="u1-btn p v3-full" data-add="1">${t("Agregar", "Add")} · ${money(itemTotal())}</button>`;
  return `<div class="v3-sheet-bg" data-go="back"></div><div class="v3-sheet" role="dialog" aria-modal="true" aria-label="${esc(itemName(it))}"><div class="v3-grab"></div><div class="v3-sheet-body"><div class="v3-hero">${img(heroPhoto, itemName(it))}<div><b>${esc(itemName(it))}</b><div class="v3-price">${money(itemTotal())}</div><small class="v3-desc2">${esc(String(it.description || "").slice(0, 140))}</small></div></div><div class="v3-ask"><span class="v3-dot big"></span><b>${esc(say)}</b></div>${main.map(grp).join("")}${extras}</div><div class="v3-foot"><button class="u1-btn s" data-go="back" aria-label="${t("Cerrar", "Close")}">✕</button>${foot}</div></div>`;
}
function v3RenderSheet() {
  let el = document.getElementById("v3-sheet-wrap");
  if (U.screen !== "item") {
    if (el) el.innerHTML = "";
    document.body.classList.remove("v3-sheet-on");
    if (U._v3AskKey) { U._v3AskKey = null; try { B()?.stopAudio?.(); } catch {} }
    return;
  }
  if (!el) { el = document.createElement("div"); el.id = "v3-sheet-wrap"; document.getElementById("ui1")?.appendChild?.(el); }
  const sc = el.querySelector?.(".v3-sheet-body")?.scrollTop || 0;
  el.innerHTML = v3SheetHTML(); document.body.classList.add("v3-sheet-on");
  const b = el.querySelector?.(".v3-sheet-body"); if (b) b.scrollTop = sc;
  if (!U.v3focused) { U.v3focused = true; setTimeout(() => el.querySelector?.(".v3-foot button")?.focus?.(), 0); }
  // warm1: HEAR the current unfinished required step (TTS); bubble already mirrors via v3LeadAsk
  v3LeadAsk();
}

// ---------- live updates from chat / voice (app.js applyActions + renderCart) ----------
let lastCartLen = 0;
window.addEventListener("elvi:cart", () => {
  const cart = B()?.state?.cart || [];
  if (cart.length > lastCartLen) U.flyIndex = cart.length - 1;
  lastCartLen = cart.length;
  renderCartStrip(); renderBar();
  if (U.screen === "receipt") render();
});
window.addEventListener("elvi:actions", (e) => {
  for (const a of e.detail?.actions || []) {
    if (a?.type !== "add_item") continue;
    const item = U.menu.find((m) => m.id === a.itemId) || B()?.state?.menu?.find((m) => m.id === a.itemId);
    if (!item) continue;
    const tile = document.getElementById(`u1-it-${a.itemId}`);
    if (tile) { tile.classList.add("pulse"); setTimeout(() => tile.classList.remove("pulse"), 1600); }
    const said = B()?.readback?.([{ item, quantity: a.quantity || 1, modifiers: a.modifiers || [] }]) || "";
    showToast(item, a.modifiers || [], said);
  }
});

// ---------- events ----------
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-cat],[data-prod],[data-item],[data-go],[data-g],[data-dbl],[data-step],[data-next],[data-add],[data-rm],[data-read]");
  if (!el || !el.closest("#ui1")) return;
  const d = el.dataset;
  if (d.cat !== undefined) { U.cat = Number(d.cat); U.prod = null; U.screen = "cat"; render(); window.scrollTo(0, 0); return; }
  if (d.prod !== undefined) { // add1: v3 cards have no category screen first — find the product's category (catHTML needs U.cat)
    if (U.cat === null || U.cat === undefined || !U.cats[U.cat]?.items?.some((x) => x.product === d.prod)) { const i = U.cats.findIndex((c) => !c.popular && c.items.some((x) => x.product === d.prod)); U.cat = i >= 0 ? i : U.cats.findIndex((c) => c.items.some((x) => x.product === d.prod)); }
    if (!U.cats[U.cat]) return; U.prod = d.prod; U.screen = "prod"; render(); window.scrollTo(0, 0); return; }
  if (d.item) { openItem(d.item); return; }
  if (d.dbl !== undefined) { const g = U.item.modifierGroups[Number(d.dbl)]; const s = U.dbl[g.id]; s.has(d.o) ? s.delete(d.o) : s.add(d.o); render(); return; }
  if (d.g !== undefined) { pick(Number(d.g), d.o); return; }
  if (d.step !== undefined) { U.step = d.step === "x" ? "x" : Number(d.step); render(); return; }
  if (d.next) { const { main } = steps(); const k = main.indexOf(U.step); U.step = k >= 0 && k < main.length - 1 ? main[k + 1] : "x"; render(); return; }
  if (d.add) { addToCart(U.item, buildModifiers()); return; }
  if (d.rm !== undefined) { const b = B(); const l = b.state.cart[Number(d.rm)]; if (l) { b.removeCartItem(l.item.id, l.quantity, Number(d.rm)); b.renderCart(); render(); } return; }
  if (d.read) { readBack(); return; }
  if (d.go === "back") { U.screen = U.cat !== null ? (U.prod ? "prod" : "cat") : "home"; render(); return; }
  if (d.go === "cat") { U.prod = null; }
  if (d.go) { U.screen = d.go; if (d.go === "home") U.cat = null; render(); window.scrollTo(0, 0); if (d.go === "receipt") setTimeout(readBack, 400); }
});
// The old cart button opens the visual receipt (no checkout in ui1).
document.addEventListener("click", (e) => {
  if (e.target.closest("#cart-toggle")) { e.stopImmediatePropagation(); e.preventDefault(); U.screen = "receipt"; render(); }
}, true);
document.addEventListener("click", (e) => { if (e.target.closest("[data-lang]")) setTimeout(render, 50); });

function mount() {
  const shell = document.createElement("div");
  shell.id = "ui1";
  shell.innerHTML = `<header class="u1-head"><img class="u1-logo" src="./img/logo-cocina-elvis.png" alt="Cocina Elvis"><h1>Cocina Elvis<small>${t("Pide con Elvi · Painesville", "Order with Elvi · Painesville")}</small></h1>${V3 ? '<span id="v3-pill" class="v3-pill"></span>' : ""}<button type="button" id="cust-btn" class="cust-btn" data-cust="open">${custLabel()}</button><div id="ui1-halo-slot"></div></header>
  <main id="ui1-main"></main><div id="ui1-toast" class="u1-toast"></div><div class="u1-bottom"><div id="ui1-cart" class="u1-cart is-empty"></div><div id="ui1-bar" class="u1-bar"></div></div>`;
  document.body.prepend(shell);
  document.body.classList.add("ui1"); if (V3) document.body.classList.add("v3");
}
mount();
load().then(render).catch((e) => { $("#ui1-main").innerHTML = `<p class="u1-note">Menu error: ${esc(e.message)}</p>`; });
setInterval(() => {
  if (B() && !U._bridged) { U._bridged = true; lastCartLen = B().state.cart.length; render(); }
  if (U.menu.length && U.lang && U.lang !== lang()) render(); // language picked / switched in app.js
}, 400);
export {};
/* ui2: keep content clear of Elvi's bubble and the bottom bar on phones */
(function () {
  const root = document.documentElement;
  function measure() {
    const b = document.querySelector(".speech-bubble");
    if (b) { const r = b.getBoundingClientRect(); if (r.height) root.style.setProperty("--u1-bubble-b", Math.ceil(r.bottom) + "px"); }
    const bt = document.querySelector(".u1-bottom");
    if (bt) root.style.setProperty("--u1-bottom-h", Math.ceil(bt.getBoundingClientRect().height) + "px");
  }
  const start = () => {
    measure();
    if (window.ResizeObserver) { const ro = new ResizeObserver(measure); document.querySelectorAll(".speech-bubble,.u1-bottom").forEach((n) => ro.observe(n)); }
    window.addEventListener("resize", measure); setInterval(measure, 1500);
  };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", start) : setTimeout(start, 300);

})();

  // cust1: phone login (code by SMS) — "Iniciar sesión" in the header + prompt at checkout. Session = httpOnly cookie.
  function custLabel() { const m = CUST.me; return m?.loggedIn ? (m.firstName ? `${t("Hola", "Hi")}, ${esc(m.firstName)}` : t("Mi cuenta", "My account")) : t("Iniciar sesión", "Sign in"); }
  function custRefreshLabel() { const b = document.getElementById("cust-btn"); if (b) b.innerHTML = custLabel(); }
  globalThis.__custRefresh = custRefreshLabel;
  async function custLoad() {
    try { const r = await fetch(`/api/cust/me?lang=${lang()}`, { credentials: "same-origin" }); CUST.me = await r.json(); } catch { CUST.me = { loggedIn: false }; }
    custRefreshLabel(); if (CUST.me?.loggedIn) custApply();
  }
  function custApply() {
    const m = CUST.me, b = B(); if (!m?.loggedIn) return; if (!b?.setCustomer) { if ((CUST.tries = (CUST.tries || 0) + 1) < 20) setTimeout(custApply, 500); return; }
    b.setCustomer?.({ name: m.firstName || "", phone: m.phone ? m.phone.replace(/^\+1/, "") : "", email: m.email || "" });
    if (m.favorites?.kind) b.showFavorites?.(m.favorites);
    else if (m.firstName && !CUST.greeted) { CUST.greeted = true; b.greet?.(t(`¡Hola, ${m.firstName}! ¿Qué se te antoja hoy?`, `Hi, ${m.firstName}! What are you craving today?`)); }
  }
  function custSheet() {
    const m = CUST.me, st = CUST.step || "phone";
    const body = m?.loggedIn
      ? `<h3>${custLabel()}</h3>${(m.pastOrders || []).length ? `<p class="cust-sub">${t("Pedidos anteriores", "Past orders")}</p>${m.pastOrders.map((o) => `<div class="cust-past"><small>${esc(new Date(o.at).toLocaleDateString(lang() === "es" ? "es-US" : "en-US", { timeZone: "America/New_York", month: "short", day: "numeric" }))}</small> ${esc(o.lines.join(", "))}</div>`).join("")}` : `<p class="cust-sub">${t("Aún no vemos pedidos anteriores con este número.", "No past orders with this number yet.")}</p>`}
         ${m.favorites?.offers?.length ? `<p class="cust-sub">${t("Lo de siempre", "Your usual")}</p>${m.favorites.offers.map((o, i) => `<button type="button" class="cust-fav" data-cust="fav" data-i="${i}">${esc(o.label)} · ${money(o.cents)}</button>`).join("")}` : ""}
         <button type="button" class="cust-out" data-cust="logout">${t("Cerrar sesión", "Sign out")}</button>`
      : st === "code"
        ? `<h3>${t("Escribe el código", "Enter the code")}</h3><p class="cust-sub">${t("Te mandamos un código de 6 dígitos por mensaje.", "We texted you a 6-digit code.")}</p><input id="cust-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456"><button type="button" class="cust-go" data-cust="verify">${t("Entrar", "Sign in")}</button><button type="button" class="cust-link" data-cust="back">${t("Cambiar número", "Change number")}</button>`
        : `<h3>${t("Iniciar sesión", "Sign in")}</h3><p class="cust-sub">${t("Con tu número de teléfono. Te mandamos un código por mensaje.", "With your phone number. We'll text you a code.")}</p><input id="cust-phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="(440) 555-0123" value="${esc(CUST.phone || "")}"><button type="button" class="cust-go" data-cust="send">${t("Enviar código", "Send code")}</button><p class="cust-fine">${t("Pueden aplicar tarifas de mensajes.", "Msg & data rates may apply.")}</p>`;
    let el = document.getElementById("cust-sheet");
    if (!el) { el = document.createElement("div"); el.id = "cust-sheet"; el.className = "v3-sheet-bg"; document.body.appendChild(el); }
    el.innerHTML = `<div class="v3-sheet cust-box" role="dialog" aria-modal="true"><button type="button" class="cust-x" data-cust="close" aria-label="close">×</button>${body}<p id="cust-err" class="cust-err">${esc(CUST.err || "")}</p></div>`;
    el.style.display = "";
  }
  async function custPost(path, body) { const r = await fetch(path, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, lang: lang() }) }); return { ok: r.ok, j: await r.json().catch(() => ({})) }; }
  document.addEventListener("click", async (e) => {
    const a = e.target.closest("[data-cust]"); if (!a) return; e.preventDefault(); const act = a.dataset.cust; CUST.err = "";
    if (act === "open") return custSheet();
    if (act === "close") { const el = document.getElementById("cust-sheet"); if (el) el.style.display = "none"; return; }
    if (act === "back") { CUST.step = "phone"; return custSheet(); }
    if (act === "send") { CUST.phone = document.getElementById("cust-phone")?.value || ""; const r = await custPost("/api/cust/start", { phone: CUST.phone }); if (r.ok) CUST.step = "code"; else CUST.err = r.j.error || "Error"; return custSheet(); }
    if (act === "verify") { const r = await custPost("/api/cust/verify", { phone: CUST.phone, code: document.getElementById("cust-code")?.value || "" }); if (!r.ok) { CUST.err = r.j.error || "Error"; return custSheet(); }
      CUST.step = "phone"; await custLoad(); const el = document.getElementById("cust-sheet"); if (el) el.style.display = "none"; render(); return; }
    if (act === "fav") { const o = CUST.me?.favorites?.offers?.[Number(a.dataset.i)]; const b = B(); if (o && b) { b.showFavorites?.({ ...CUST.me.favorites, offers: [o] }); document.querySelector("#fav-offers .fav-offer")?.click(); } const el = document.getElementById("cust-sheet"); if (el) el.style.display = "none"; return; }
    if (act === "logout") { await custPost("/api/cust/logout", {}); CUST.me = { loggedIn: false }; B()?.clearCustomer?.(); custRefreshLabel(); const el = document.getElementById("cust-sheet"); if (el) el.style.display = "none"; render(); }
  });
  custLoad(); // one /api/cust/me at load (cookie is httpOnly, so ask the server)


// ---------- time1: checkout timing step (ASAP / Programar · pickup / delivery) + pay ----------
const TM = { f: "PICKUP", mode: "asap", day: 0, at: "", opts: {}, check: null, err: "", busy: false };
function tmLoad(f) { if (TM.opts[f] || TM.opts[f + "_l"]) return; TM.opts[f + "_l"] = 1;
  fetch(`/api/${TENANT}/orders/timing?f=${f}`).then((r) => r.json()).then((j) => { TM.opts[f] = j; delete TM.opts[f + "_l"]; tmCheck(); if (U.screen === "receipt") render(); }).catch(() => { delete TM.opts[f + "_l"]; }); }
function tmReq() { return TM.mode === "scheduled" && TM.at ? { mode: "scheduled", at: TM.at } : { mode: "asap" }; }
function tmCheck() { const b = B(); const cart = b?.state?.cart || []; if (!cart.length) { TM.check = null; return; }
  fetch(`/api/${TENANT}/orders/timing`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fulfillment: TM.f, timing: tmReq(), cart: cart.map((l) => ({ id: l.item?.id, quantity: l.quantity })) }) })
    .then((r) => r.json()).then((j) => { TM.check = j; if (U.screen === "receipt") render(); }).catch(() => {}); }
function deliveryOn() { const rc = B()?.state?.runtimeConfig; return !!(rc?.deliveryEnabled && (rc.fulfillmentModes || []).includes("DELIVERY")); }
function timingHTML() {
  const o = TM.opts[TM.f]; tmLoad(TM.f); const cust = B()?.state?.customer || {};
  const seg = `<div class="tm-seg"><button type="button" data-tmf="PICKUP" class="${TM.f === "PICKUP" ? "on" : ""}">🛍️ ${t("Recoger", "Pickup")}</button>${deliveryOn() ? `<button type="button" data-tmf="DELIVERY" class="${TM.f === "DELIVERY" ? "on" : ""}">🚗 ${t("Entrega", "Delivery")}</button>` : ""}</div>`;
  if (!o?.asap) return `<div class="u1-rc tm">${seg}<p class="u1-mut">${t("Cargando horarios…", "Loading times…")}</p></div>`;
  const D = TM.f === "DELIVERY", L = (x) => t(x.es, x.en);
  const asapTxt = o.open
    ? (D ? t(`Lo antes posible · llega en ~${o.prep + o.drive} min (${L(o.asap.label)})`, `ASAP · arrives in ~${o.prep + o.drive} min (${L(o.asap.label)})`) : t(`Lo antes posible · listo en ~${o.prep} min (${L(o.asap.label)})`, `ASAP · ready in ~${o.prep} min (${L(o.asap.label)})`))
    : (D ? t(`Lo antes posible: llega ${L(o.asap.label)}`, `As soon as possible: arrives ${L(o.asap.label)}`) : t(`Lo antes posible: listo a las ${L(o.asap.label)}`, `As soon as possible: ready at ${L(o.asap.label)}`));
  const days = o.days || []; const dd = days[Math.min(TM.day, Math.max(0, days.length - 1))];
  const sched = TM.mode === "scheduled" && dd ? `<div class="tm-sched"><select data-tmday="1">${days.map((d, i) => `<option value="${i}" ${i === TM.day ? "selected" : ""}>${esc(L(d))}</option>`).join("")}</select><select data-tmat="1"><option value="">${t(D ? "Hora de entrega…" : "Hora para recoger…", D ? "Delivery time…" : "Pickup time…")}</option>${dd.slots.map((x) => `<option value="${esc(x.at)}" ${x.at === TM.at ? "selected" : ""}>${esc(L(x.label))}</option>`).join("")}</select></div>${D ? `<p class="u1-mut">${t(`Ventana de ±${o.pad} min: preparamos ${o.prep} min + ${o.drive} min de camino.`, `±${o.pad} min window: ${o.prep} min prep + ${o.drive} min drive.`)}</p>` : ""}` : "";
  const ck = TM.check; const flag = ck && ck.ok === false ? `<div class="tm-flag">⚠️ ${esc(L(ck.error))}${(ck.unavailable || []).length ? `<br><small>${t("Quítalo o escoge otra hora.", "Remove it or pick another time.")}</small>` : ""}</div>` : "";
  const fields = `<div class="tm-f"><input id="tm-name" placeholder="${t("Nombre", "Name")}" value="${esc(cust.name || "")}" autocomplete="name"><input id="tm-phone" type="tel" placeholder="${t("Teléfono", "Phone")}" value="${esc(cust.phone || "")}" autocomplete="tel"><input id="tm-email" type="email" placeholder="Email" value="${esc(cust.email || "")}" autocomplete="email">${D ? `<input id="tm-addr" placeholder="${t("Dirección de entrega", "Delivery address")}" value="${esc(cust.address || "")}" autocomplete="street-address">` : ""}</div>`;
  const can = (B()?.state?.cart || []).length && !(ck && ck.ok === false) && !(TM.mode === "scheduled" && !TM.at) && !TM.busy;
  return `<div class="u1-rc tm" id="tm-step">${seg}<p class="tm-h">${t("¿Para cuándo?", "When?")}</p>
  <label class="tm-o"><input type="radio" name="tm" data-tmm="asap" ${TM.mode === "asap" ? "checked" : ""}> ${esc(asapTxt)}</label>
  <label class="tm-o"><input type="radio" name="tm" data-tmm="scheduled" ${TM.mode === "scheduled" ? "checked" : ""}> 🗓 ${t("Programar", "Schedule")}</label>${sched}${flag}
  ${D ? "" : `<p class="u1-mut">${t("Recoger en", "Pickup at")} Cocina Elvis · 101 W Walnut Ave, Unit B, Painesville · <a href="tel:+14405519122">(440) 551-9122</a></p>`}
  ${fields}<p class="tm-err">${esc(TM.err)}</p><button type="button" class="u1-btn p v3-full" data-tmconfirm="1" ${can ? "" : "disabled"}>${TM.busy ? t("Abriendo pago…", "Opening checkout…") : t("Continuar", "Continue")} · ${money((B()?.state?.cart || []).reduce((a, l) => a + (B()?.lineTotal?.(l) || 0), 0))}</button></div>`;
}
document.addEventListener("click", (e) => {
  const f = e.target.closest?.("[data-tmf]"); if (f) { TM.f = f.dataset.tmf; TM.at = ""; TM.day = 0; TM.check = null; tmLoad(TM.f); tmCheck(); render(); return; }
  const m = e.target.closest?.("[data-tmm]"); if (m) { TM.mode = m.dataset.tmm; if (TM.mode === "asap") TM.at = ""; tmCheck(); render(); return; }
  if (e.target.closest?.("[data-tmconfirm]")) { openConfirm(); return; }
  if (e.target.closest?.("[data-tmpay]")) { void tmPay(); }
});
document.addEventListener("change", (e) => {
  if (e.target.matches?.("[data-tmday]")) { TM.day = Number(e.target.value) || 0; TM.at = ""; render(); return; }
  if (e.target.matches?.("[data-tmat]")) { TM.at = e.target.value; tmCheck(); render(); }
});
async function tmPay() {
  const b = B(); if (!b) return; const v = (id) => (document.getElementById(id)?.value || "").trim();
  const name = v("tm-name"), phone = v("tm-phone"), email = v("tm-email"), addr = v("tm-addr");
  if (!name) { TM.err = t("Escribe tu nombre.", "Please enter your name."); return render(); }
  if (TM.f === "DELIVERY" && !addr) { TM.err = t("Escribe la dirección de entrega.", "Please enter the delivery address."); return render(); }
  Object.assign(b.state.customer, { name, phone, email, ...(TM.f === "DELIVERY" ? { address: addr } : {}) });
  for (const [k, x] of [["customer-name", name], ["customer-phone", phone], ["customer-email", email], ["customer-address", addr]]) { const el = document.getElementById(k); if (el) el.value = x; }
  b.state.fulfillment = TM.f; const sel = document.getElementById("fulfillment"); if (sel) sel.value = TM.f;
  b.state.timing = tmReq(); TM.err = ""; TM.busy = true; render();
  const r = b.checkout ? await b.checkout() : { ok: false, error: "checkout unavailable" };
  TM.busy = false; if (!r.ok) { TM.err = r.error || t("No se pudo abrir el pago.", "Couldn't open checkout."); tmCheck(); render(); }
}
document.addEventListener("input", (e) => { const m = { "tm-name": "name", "tm-phone": "phone", "tm-email": "email", "tm-addr": "address" }[e.target?.id]; const b = B(); if (m && b) b.state.customer[m] = e.target.value; });

// ---------- ux1: Hablar capsule + barge-in + confirm beat (Para la cocina) + ES cash backup ----------
const UX1 = { pay: "card", micHold: null };
function kitchenOrig(s) {
  return String(s || "").split(" / ")[0].replace(/\s*\$[\d.,]+.*$/, "").replace(/^\W*double\s+/i, "DOUBLE ").trim().toUpperCase();
}
function kitchenLines() {
  const cart = B()?.state?.cart || [];
  return cart.map((l) => {
    const name = kitchenOrig(l.item?.name);
    const mods = (l.modifiers || []).map((m) => kitchenOrig(m.option)).filter(Boolean);
    const modStr = mods.length ? ("\n  + " + mods.join("\n  + ")) : "";
    return `${Math.max(1, Number(l.quantity) || 1)}x ${name}${modStr}`;
  }).join("\n");
}
function confSay() {
  const b = B(); const cart = b?.state?.cart || [];
  const parts = cart.map((l) => `${Math.max(1, Number(l.quantity) || 1)} ${itemName(l.item)}${modsText(l) ? " (" + modsText(l) + ")" : ""}`);
  const list = parts.slice(0, 3).join(", ") + (parts.length > 3 ? (lang() === "es" ? "…" : ", …") : "");
  const tot = cart.reduce((a, l) => a + (b?.lineTotal?.(l) || 0), 0);
  return t(`Así quedó: ${list}. Subtotal ${money(tot)}. ¿Cobramos?`, `Here's your order: ${list}. Subtotal ${money(tot)}. Ready to pay?`);
}
function allowCash() { return lang() === "es"; }
function setPay(m) {
  UX1.pay = m === "cash" && allowCash() ? "cash" : "card";
  const box = document.getElementById("paychoice"); if (!box) return;
  box.querySelectorAll(".payopt").forEach((btn) => btn.classList.toggle("on", btn.dataset.p === UX1.pay));
}
function payChoiceHTML() {
  UX1.pay = "card";
  if (allowCash()) {
    return `<div class="paychoice" id="paychoice"><div class="pl">Cómo pagas</div>
      <button type="button" class="payopt on" data-p="card" data-setpay="card"><span class="dot"></span><span>Tarjeta o en línea<span class="hint">Rápido y listo — lo más fácil</span></span></button>
      <button type="button" class="payopt payopt-soft" data-p="cash" data-setpay="cash"><span class="dot"></span><span>Efectivo al recoger<span class="hint">También está bien si prefieres pagar allá</span></span></button>
    </div>`;
  }
  return `<div class="paychoice" id="paychoice"><div class="pl">How you pay</div>
    <button type="button" class="payopt on" data-p="card" data-setpay="card"><span class="dot"></span><span>Card or online<span class="hint">Quick Square checkout</span></span></button>
  </div>`;
}
function closeConfirm() {
  const el = document.getElementById("ux1-confirm");
  if (el) el.remove();
  document.body.classList.remove("ux1-confirm-on");
}
function openConfirm() {
  const b = B(); const cart = b?.state?.cart || [];
  if (!cart.length) { U.screen = "receipt"; render(); return; }
  const v = (id) => (document.getElementById(id)?.value || "").trim();
  const name = v("tm-name"), phone = v("tm-phone"), email = v("tm-email"), addr = v("tm-addr");
  if (!name) { TM.err = t("Escribe tu nombre.", "Please enter your name."); return render(); }
  if (TM.f === "DELIVERY" && !addr) { TM.err = t("Escribe la dirección de entrega.", "Please enter the delivery address."); return render(); }
  if (TM.mode === "scheduled" && !TM.at) { TM.err = t("Escoge una hora.", "Pick a time."); return render(); }
  if (TM.check && TM.check.ok === false) { TM.err = t("Revisa los artículos o la hora.", "Check items or time."); return render(); }
  Object.assign(b.state.customer, { name, phone, email, ...(TM.f === "DELIVERY" ? { address: addr } : {}) });
  for (const [k, x] of [["customer-name", name], ["customer-phone", phone], ["customer-email", email], ["customer-address", addr]]) {
    const el = document.getElementById(k); if (el) el.value = x;
  }
  b.state.fulfillment = TM.f; const sel = document.getElementById("fulfillment"); if (sel) sel.value = TM.f;
  b.state.timing = tmReq(); TM.err = "";
  UX1.pay = "card";
  const say = confSay();
  const tot = cart.reduce((a, l) => a + (b?.lineTotal?.(l) || 0), 0);
  const lines = cart.map((l) => {
    const photo = itemPhoto(l.item);
    const thumb = photo ? img(photo, itemName(l.item)) : `<div class="u1-ph">${esc((itemName(l.item) || "").slice(0, 12))}</div>`;
    return `<div class="conf-line"><div class="th">${thumb}</div>
      <div class="bd"><div class="nm">${Math.max(1, Number(l.quantity) || 1)} × ${esc(itemName(l.item))}</div><div class="mods">${esc(modsText(l) || t("Sin extras", "No extras"))}</div></div>
      <div class="pr">${money(b.lineTotal(l))}</div></div>`;
  }).join("");
  closeConfirm();
  const el = document.createElement("div");
  el.id = "ux1-confirm";
  el.className = "v3-sheet-bg";
  el.innerHTML = `<div class="v3-sheet" role="dialog" aria-modal="true" aria-label="${esc(t("Confirmar orden", "Confirm order"))}">
    <div class="v3-grab"></div>
    <div class="ux1-conf-body">
      <h3>${t("¿Así quedó?", "Does this look right?")}</h3>
      <div class="ux1-conf-say"><span class="v3-dot" aria-hidden="true"></span><div id="ux1-conf-say">${esc(say)}</div></div>
      <div class="conf-lines">${lines}</div>
      <div style="display:flex;justify-content:space-between;font-weight:600;font-size:16.5px;letter-spacing:-.01em"><span>Subtotal</span><span>${money(tot)}</span></div>
      <div style="font-size:11px;color:var(--mut);margin-bottom:6px">${t("Impuesto y total final los calcula Square.", "Tax & final total by Square.")}</div>
      <div class="kitchen"><div class="kt"><span class="chk">✓</span> ${t("Para la cocina", "For the kitchen")}</div><pre>${esc(kitchenLines())}</pre></div>
      ${payChoiceHTML()}
    </div>
    <div class="ux1-conf-foot">
      <button type="button" class="u1-btn cor" data-ux1="correct">${t("Corregir", "Fix it")}</button>
      <button type="button" class="u1-btn p" data-ux1="pay">${t("Así está · Pagar", "Looks good · Pay")} · ${money(tot)}</button>
    </div>
  </div>`;
  document.body.appendChild(el);
  document.body.classList.add("ux1-confirm-on");
  try {
    b.greet?.(say);
    const r = document.getElementById("assistant-reply"); if (r) r.textContent = say;
  } catch {}
  el.addEventListener("click", (e) => {
    if (e.target === el) return;
    const sp = e.target.closest?.("[data-setpay]"); if (sp) { setPay(sp.dataset.setpay); return; }
    const act = e.target.closest?.("[data-ux1]"); if (!act) return;
    if (act.dataset.ux1 === "correct") {
      closeConfirm();
      U.screen = "receipt"; render();
      try { b.greet?.(t("Claro — ¿qué cambiamos?", "Sure — what should we change?")); } catch {}
      try { b.startVoice?.(); } catch {}
      return;
    }
    if (act.dataset.ux1 === "pay") { void payFromConfirm(); }
  });
}
async function payFromConfirm() {
  const mode = allowCash() && UX1.pay === "cash" ? "cash" : "card";
  const b = B(); if (!b) return;
  if (mode === "cash") {
    TM.busy = true; render();
    const r = b.checkout ? await b.checkout({ payMode: "cash" }) : { ok: false, error: "checkout unavailable" };
    TM.busy = false;
    closeConfirm();
    if (!r.ok) { TM.err = r.error || t("No se pudo registrar el pago en efectivo.", "Couldn't place cash order."); render(); return; }
    const msg = t("Listo — pagas en efectivo al recoger. Tu orden ya va a la cocina.", "All set — pay cash at pickup. Order sent to the kitchen.");
    try { b.greet?.(msg); } catch {}
    const main = document.getElementById("ui1-main");
    if (main) {
      U.screen = "receipt";
      render();
      const note = document.createElement("div");
      note.className = "ux1-cash-ok";
      note.innerHTML = `✓ ${esc(t("Efectivo al recoger", "Cash at pickup"))}<br><small>${esc(msg)}</small><br><small style="opacity:.75">${esc(t("(Aviso: aún no hay API de ticket en cocina — pedido no cobrado en Square.)", "(Note: kitchen ticket API not live yet — order not charged on Square.)"))}</small>`;
      const tm = document.getElementById("tm-step");
      if (tm) tm.prepend(note); else main.prepend(note);
    }
    console.warn("[ux1] cash pay-at-pickup stub done", { kitchen: kitchenLines() });
    return;
  }
  closeConfirm();
  await tmPay();
}

function syncLoucap(st) {
  const cap = document.getElementById("loucap"); if (!cap) return;
  const s = st || document.getElementById("elvi-halo")?.dataset?.state || "idle";
  cap.dataset.state = s;
  const e3 = cap.querySelector(".e3d"); if (e3) e3.dataset.state = s;
  const lt = cap.querySelector(".lt");
  if (lt) lt.textContent = t("Hablar con Elvi", "Talk to Elvi");
  cap.setAttribute("aria-label", lt?.textContent || "Hablar con Elvi");
  cap.classList.remove("hide"); // carlos-ux: Hablar stays visible (no Elvi-view hide)
}
// carlos-ux: Hablar language gate — only when session lang unknown
function langKnown() {
  const b = B();
  if (b?.hasSelectedLanguage?.()) return true;
  const L = b?.state?.language;
  return L === "es" || L === "en";
}
function closeLangGate() {
  document.getElementById("ux1-langgate")?.remove();
  document.body.classList.remove("ux1-langgate-on");
}
function openLangGate() {
  if (document.getElementById("ux1-langgate")) return;
  closeLangGate();
  const el = document.createElement("div");
  el.id = "ux1-langgate";
  el.className = "v3-sheet-bg";
  el.innerHTML = `<div class="v3-sheet ux1-langgate" role="dialog" aria-modal="true" aria-label="Selecciona tu idioma">
    <div class="v3-grab"></div>
    <div class="ux1-lang-body">
      <span class="e3d" data-state="idle" aria-hidden="true"><i class="ball"></i><i class="ring3"></i><i class="spec"></i></span>
      <h3>Selecciona tu idioma</h3>
      <p>Select your language</p>
      <div class="ux1-lang-btns">
        <button type="button" class="u1-btn p" data-langpick="es">Español</button>
        <button type="button" class="u1-btn p" data-langpick="en">English</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(el);
  document.body.classList.add("ux1-langgate-on");
  el.addEventListener("click", (e) => {
    if (e.target === el) { closeLangGate(); return; }
    const btn = e.target.closest?.("[data-langpick]"); if (!btn) return;
    const mode = btn.dataset.langpick === "en" ? "en" : "es";
    closeLangGate();
    try { B()?.setLanguage?.(mode); } catch {}
    // Alexa-style: language pick → listen immediately (no second Hablar tap)
    setTimeout(() => {
      try { B()?.startVoice?.().catch(() => B()?.toggleVoice?.()); }
      catch { try { B()?.toggleVoice?.(); } catch {} }
      syncLoucap("listening");
    }, 50);
  });
}
function talkOrBarge() {
  const b = B();
  const speaking = b?.isSpeaking?.() || document.getElementById("elvi-halo")?.dataset?.state === "speaking";
  if (speaking) { bargeIn("tap"); return; }
  if (!langKnown()) { openLangGate(); return; }
  try { b?.startVoice?.().catch(() => b?.toggleVoice?.()); }
  catch { try { b?.toggleVoice?.(); } catch {} }
}
function bargeIn(why) {
  const b = B();
  const speaking = b?.isSpeaking?.() || document.getElementById("elvi-halo")?.dataset?.state === "speaking";
  if (!speaking && why !== "demo") return false;
  try { b?.stopAudio?.(); } catch {}
  const mic = document.getElementById("listen-button");
  const cap = document.getElementById("loucap");
  if (mic) { mic.classList.add("barge-flash"); setTimeout(() => mic.classList.remove("barge-flash"), 500); }
  if (cap) { cap.classList.add("barge-flash"); setTimeout(() => cap.classList.remove("barge-flash"), 500); }
  const line = t("Te escucho — dime.", "I'm listening — go ahead.");
  try { b?.greet?.(line); } catch {}
  const r = document.getElementById("assistant-reply"); if (r) r.textContent = line;
  try { b?.startVoice?.(); } catch {}
  syncLoucap("listening");
  const v3 = document.getElementById("v3-line"); if (v3) v3.textContent = line;
  console.log("[ux1] bargeIn", why);
  return true;
}
function mountLoucap() {
  if (document.getElementById("loucap")) return;
  if (!V3) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "loucap";
  btn.id = "loucap";
  btn.dataset.state = "idle";
  btn.setAttribute("aria-label", t("Hablar con Elvi", "Talk to Elvi"));
  btn.innerHTML = `<span class="e3d" data-state="idle" aria-hidden="true"><i class="ball"></i><i class="ring3"></i><i class="spec"></i></span><span class="lt">${t("Hablar con Elvi", "Talk to Elvi")}</span>`;
  btn.addEventListener("click", (e) => { e.preventDefault(); talkOrBarge(); });
  document.body.appendChild(btn);
  const halo = document.getElementById("elvi-halo");
  if (halo && window.MutationObserver) {
    new MutationObserver(() => syncLoucap()).observe(halo, { attributes: true, attributeFilter: ["data-state"] });
  }
  window.addEventListener("elvi:barge", () => {
    const cap = document.getElementById("loucap");
    if (cap) { cap.classList.add("barge-flash"); setTimeout(() => cap.classList.remove("barge-flash"), 500); }
    syncLoucap("listening");
  });
  setInterval(() => syncLoucap(), 800);
  syncLoucap();
}
mountLoucap();

