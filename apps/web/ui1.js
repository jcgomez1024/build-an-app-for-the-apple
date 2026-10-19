// ui1 (2026-10-16): photo menu, step-by-step photo customization, DOBLE bar, photo cart and visual receipt.
// Real data only: /api/<tenant>/menu (items + modifier groups in website order) and /api/<tenant>/ui/catalog
// (website categories + hours). The cart is app.js's cart (window.elviBridge), so taps, chat and voice share it.
const TENANT = "cocina-elvis";
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const money = (c) => `$${(Number(c || 0) / 100).toFixed(2)}`;
const B = () => window.elviBridge || null;
// Spanish first (most callers); follows the EN/ES pills once a language is picked in app.js.
const lang = () => (B()?.state?.language ? (B().lang() === "en" ? "en" : "es") : "es");
const t = (es, en) => (lang() === "es" ? es : en);

// ---------- photos ----------
const PRODUCT_PHOTO = {"Gordita":"gordita.jpg","Quesadilla":"quesadilla.jpg","Medium Fiesta Platter":"medium-fiesta-platter.jpg","Large Fiesta Platter":"large-fiesta-platter.jpg","Extras":"extras.jpg","3 Pack MEAL":"3-pack-meal.jpg","4 Pack MEAL":"4-pack-meal.jpg","5 Pack MEAL":"5-pack-meal.jpg","6 Pack MEAL":"6-pack-meal.jpg","Aguas Frescas":"aguas-frescas.jpg","7 Pack MEAL":"7-pack-meal.jpg","Esquite Elvis":"esquite-elvis.jpg","Taco":"taco.jpg","Chilaquiles con Huevo":"chilaquiles-con-huevo.jpg","Birria de Chivo / Goat Birria":"birria-de-chivo-goat-birria.jpg","Mole Tradicional Platillo":"mole-tradicional-platillo.jpg","Rice / Beans Fiesta Pan":"rice-beans-fiesta-pan.jpg","Fiesta Fajitas":"fiesta-fajitas.jpg","Chiles Rellenos Platillo / Stuffed Poblano Pepper":"chiles-rellenos-platillo-stuffed-poblano-pepper.jpg","8 Pack MEAL":"8-pack-meal.jpg","Enchiladas":"enchiladas.jpg","Menudo":"menudo.jpg","Coca Cola / Pepsi":"coca-cola-pepsi.jpg","Jarrito":"jarrito.jpg","Dips":"dips.jpg","Sangria / Fanta / Squirt / Sprite":"sangria-fanta-squirt-sprite.jpg","Agua or Mineral":"agua-or-mineral.jpg","Ceviche":"ceviche.jpg","Pozole Rojo / Red Pozole":"pozole-rojo-red-pozole.jpg","Traditional Elvis Bowl":"traditional-elvis-bowl.jpg","Nachos Elvis":"nachos-elvis.jpg","Queso Birrias":"queso-birrias.jpg","Platillo de Guisado":"platillo-de-guisado.jpg","Tacos Dorados":"tacos-dorados.jpg","Tortillas":"tortillas.jpg","Torta":"torta.jpg","Tacos al Vapor / Steamed Tacos":"tacos-al-vapor-steamed-tacos.jpg","Huarache Elvis":"huarache-elvis.jpg","Fajitas Elvis":"fajitas-elvis.jpg","Burrito":"burrito.jpg","Sides":"sides.jpg","Platillo Filete de Pescado":"platillo-filete-de-pescado.jpg","Sopesaso Elvis":"sopesaso-elvis.jpg","(QD) Quesadilla Dorada":"qd-quesadilla-dorada.jpg","COMBO Quesadillas":"combo-quesadillas.jpg","COMBO Tacos":"combo-tacos.jpg","COMBO Tortas":"combo-tortas.jpg","COMBO Gorditas":"combo-gorditas.jpg","COMBO Mix":"combo-mix.jpg","COMBO Burrito":"combo-burrito.jpg","Coctel de Camarones / Shrimp Cocktail":"coctel-de-camarones-shrimp-cocktail.jpg","Filete de Pescado / Fish":"filete-de-pescado-fish.jpg","Elvis Dip":"elvis-dip.jpg","Chimichanga":"chimichanga.jpg","Small Fiesta Platter":"small-fiesta-platter.jpg","Pambazo Elvis":"pambazo-elvis.jpg"};
// Carlos's photos with crops (designer PHOTOS list).
const CROPS = { "carlos-frijoles.jpg": { focus: "50% 47%", zoom: 1.85 }, "carlos-arroz.jpg": { focus: "48% 46%", zoom: 1.85 }, "carlos-cabeza.jpg": { focus: "70% 54%", zoom: 1.9 } };
const CATEGORY_PHOTO = [[/most popular/i, null, "Más populares", "Most popular"], [/favorit/i, "taco.jpg", "Favoritos", "Top Favorites"], [/combos/i, "combo-tacos.jpg", "Elvis Combos", "Elvis Combos"], [/traditional/i, "mole-tradicional-platillo.jpg", "Platillos Tradicionales", "Traditional Meals"], [/elvis meals/i, "4-pack-meal.jpg", "Elvis Meals (Packs)", "Elvis Meals (Packs)"], [/especial del dia/i, "birria-de-chivo-goat-birria.jpg", "Especial del Día", "Day Special"], [/traditional/i, "mole-tradicional-platillo.jpg", "Platillos Tradicionales", "Traditional Meals"], [/enchiladas/i, "enchiladas.jpg", "Enchiladas / Tacos al Vapor", "Enchiladas / Steamed Tacos"], [/sabado/i, "menudo.jpg", "Sábado / Domingo", "Sat / Sun Special"], [/mariscos/i, "coctel-de-camarones-shrimp-cocktail.jpg", "Mariscos", "Seafood"], [/dips/i, "dips.jpg", "Dips / Acompañantes", "Dips / Sides"], [/bebidas/i, "aguas-frescas.jpg", "Bebidas", "Drinks"], [/fiesta/i, "medium-fiesta-platter.jpg", "Fiesta Platters", "Fiesta Platters"]];
// Option photos (designer mapping). First match wins; null = gray placeholder on purpose.
const OPTION_PHOTO = [
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
  const c = cleanOpt(name).replace(/^EXTRA\s+/i, "").replace(/^SIDE\s+/i, "");
  const parts = c.split(" / ");
  return lang() === "es" ? parts[0] : (parts[1] || parts[0]);
}
function groupLabel(g) {
  const n = cleanOpt(g.name).replace(/^(T|Q|G|TO|CB|GQT|B)\s+/i, "");
  if (/tortilla|shell/i.test(n)) return "Tortilla";
  if (/size|tama/i.test(n)) return t("Tamaño", "Size");
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
const isDouble = (o) => /^\W*double\s+/i.test(String(o.name || o));
const isIncludedSalsa = (g) => /\bsalsa\b.*\b(preferencia|preference|options)\b/i.test(g.name) && !/^\W*(\(\w+\)\s*)?(extra|add)\b|\b\d\s*oz\b/i.test(g.name);
const minOf = (g) => Math.max(Number(g.minSelections || 0), isFillings(g) ? 1 : 0);
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
  const [m, c] = await Promise.all([fetch(`/api/${TENANT}/menu`).then((r) => r.json()), fetch(`/api/${TENANT}/ui/catalog`).then((r) => r.json())]);
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
  document.documentElement.lang = lang();
  U.lang = lang();
  const sub = $("#ui1 .u1-head small"); if (sub) sub.textContent = t("Pide con Elvi · Painesville", "Order with Elvi · Painesville");
  if (U.screen === "home") root.innerHTML = homeHTML();
  else if (U.screen === "cat" || U.screen === "prod") root.innerHTML = catHTML();
  else if (U.screen === "item") root.innerHTML = itemHTML();
  else if (U.screen === "receipt") root.innerHTML = receiptHTML();
  renderBar();
  renderCartStrip();
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
  const c = U.cats[U.cat];
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
function steps() { const gs = U.item.modifierGroups || []; return { main: gs.map((g, i) => i).filter((i) => isMain(gs[i])), extra: gs.map((g, i) => i).filter((i) => !isMain(gs[i])) }; }
function itemTotal() {
  const it = U.item; let c = Number(it.priceCents || 0);
  for (const m of buildModifiers()) c += Number(m.priceDeltaCents || 0) * (Number(m.quantity) || 1);
  return c;
}
function openItem(id) {
  const it = U.menu.find((m) => m.id === id);
  if (!it) return;
  U.item = it; U.sel = {}; U.dbl = {}; U.last = {};
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
  if (U.screen === "item") {
    const gs = U.item.modifierGroups || [];
    const st = U.step !== "x" && U.step !== null ? gs[U.step] : null;
    const miss = missingStep();
    if (st && minOf(st) > 0 && maxOf(st) > 2) { const c = Object.keys(U.sel[st.id]).length; bar.innerHTML = `<button class="u1-btn s" data-go="back">←</button><button class="u1-btn g" ${c ? "" : "disabled"} data-next="1">${t("Listo", "Done")} ✓ (${c})</button>`; return; }
    if (miss !== undefined) { bar.innerHTML = `<button class="u1-btn s" data-go="back">←</button><button class="u1-btn p" data-step="${miss}">${t("Falta", "Still need")}: ${esc(groupLabel(gs[miss]))} →</button>`; return; }
    bar.innerHTML = `<button class="u1-btn s" data-go="back">←</button>${U.step !== "x" && steps().extra.length ? `<button class="u1-btn s" data-next="1">→</button>` : ""}<button class="u1-btn p" data-add="1">${t("Agregar", "Add")} · ${money(itemTotal())}</button>`;
    return;
  }
  if (U.screen === "receipt") { bar.innerHTML = `<button class="u1-btn s" data-go="home">${t("Menú", "Menu")}</button><button class="u1-btn s" data-read="1">🔊 ${t("Leer otra vez", "Read again")}</button>`; return; }
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
  <div class="u1-rc u1-pickup"><b>${t("Recoger en", "Pickup at")}</b><br>Cocina Elvis · 101 W Walnut Ave, Unit B, Painesville, OH 44077<br>
  <b>${t("Listo en aprox. 20 min", "Ready in about 20 min")}</b> <span class="u1-draft">${t("BORRADOR", "DRAFT")}</span><br>
  ${t("Tel", "Phone")}: <a href="tel:+14405519122">(440) 551-9122</a>
  <div class="u1-mut">${t("Prueba local: sin pago ni SMS.", "Local test: no payment, no SMS.")}</div></div>`;
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
  if (d.prod !== undefined) { if (el.classList.contains("is-closed")) return; U.prod = d.prod; U.screen = "prod"; render(); window.scrollTo(0, 0); return; }
  if (d.item) { if (el.classList.contains("is-closed")) return; openItem(d.item); return; }
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
  shell.innerHTML = `<header class="u1-head"><img class="u1-logo" src="./img/logo-cocina-elvis.png" alt="Cocina Elvis"><h1>Cocina Elvis<small>${t("Pide con Elvi · Painesville", "Order with Elvi · Painesville")}</small></h1><div id="ui1-halo-slot"></div></header>
  <main id="ui1-main"></main><div id="ui1-toast" class="u1-toast"></div><div class="u1-bottom"><div id="ui1-cart" class="u1-cart is-empty"></div><div id="ui1-bar" class="u1-bar"></div></div>`;
  document.body.prepend(shell);
  document.body.classList.add("ui1");
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
