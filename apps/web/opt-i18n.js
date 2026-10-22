/* i18n1: bilingual option labels (Carlos, 2026-10-22). One copy, used by the web app (ui1.js, app.js)
 * and by the API (src/opt-i18n.ts loads this file). Names that already carry "Español / English"
 * split on " / "; everything else goes through MAP (key = lower-case base name with codes, counts,
 * EXTRA/DOUBLE/SOLO prefixes, sizes and prices stripped). Coverage check: npx tsx scripts/opt-i18n-sync.mts
 * EN display: "Cheese (Queso)"; ES display: "Queso". Read-backs use one language only. */
(function (root) {
  const MAP = {
    "gordita": ["Gordita", "Gordita"], "gorditas": ["Gorditas", "Gorditas"],
    "queso gordita": ["Queso Gordita", "Cheese Gordita"], "queso gorditas": ["Queso Gorditas", "Cheese Gorditas"],
    "torta": ["Torta", "Torta"], "tortas": ["Tortas", "Tortas"],
    "queso torta": ["Queso Torta", "Cheese Torta"], "queso tortas": ["Queso Tortas", "Cheese Tortas"],
    "deluxe preparada": ["Deluxe Preparada", "Deluxe Dressed"], "regular dorada": ["Regular Dorada", "Regular Crispy"],
    "horchata": ["Horchata", "Horchata"], "jamaica": ["Jamaica", "Hibiscus"],
    "cebolla y chiles asados": ["Cebolla y Chiles Asados", "Grilled Onions & Peppers"],
    "guacamole": ["Guacamole", "Guacamole"], "guacamole salsa": ["Salsa de Guacamole", "Guacamole Salsa"],
    "hot salsa roja": ["Salsa Roja Picante", "Hot Red Salsa"], "salsa roja": ["Salsa Roja", "Red Salsa"],
    "medium salsa verde": ["Salsa Verde Media", "Medium Green Salsa"], "salsa verde": ["Salsa Verde", "Green Salsa"],
    "mild salsa asada": ["Salsa Asada Suave", "Mild Roasted Salsa"],
    "mild salsa tomato": ["Salsa de Tomate Suave", "Mild Tomato Salsa"], "mild salsa tomate": ["Salsa de Tomate Suave", "Mild Tomato Salsa"],
    "extreme salsa macha": ["Salsa Macha Extra Picante", "Extreme Salsa Macha"], "extreme salasa macha": ["Salsa Macha Extra Picante", "Extreme Salsa Macha"],
    "queso dip": ["Dip de Queso", "Queso Dip"], "chips": ["Totopos", "Chips"],
    "guacamole dip": ["Dip de Guacamole", "Guacamole Dip"],
    "guacamole dip con chips": ["Dip de Guacamole con Totopos", "Guacamole Dip with Chips"], "guacamole dip with chips": ["Dip de Guacamole con Totopos", "Guacamole Dip with Chips"],
    "queso dip con chips": ["Dip de Queso con Totopos", "Queso Dip with Chips"], "queso dip with chips": ["Dip de Queso con Totopos", "Queso Dip with Chips"],
    "pico de gallo": ["Pico de Gallo", "Pico de Gallo"],
    "pico de gallo con chips": ["Pico de Gallo con Totopos", "Pico de Gallo with Chips"], "pico de gallo dip with chips": ["Pico de Gallo con Totopos", "Pico de Gallo with Chips"],
    "trio dip": ["Trío de Dips", "Trio Dip"],
    "bolillo": ["Bolillo", "Bolillo Roll"], "bolillos": ["Bolillos", "Bolillo Rolls"], "huevo": ["Huevo", "Egg"], "huevos": ["Huevos", "Eggs"],
    "comal tortillas": ["Tortillas de Comal", "Comal Tortillas"], "corn tortillas": ["Tortillas de Maíz", "Corn Tortillas"], "flour tortillas": ["Tortillas de Harina", "Flour Tortillas"],
    "comal tortilla": ["Tortilla de Comal", "Comal Tortilla"], "corn tortilla": ["Tortilla de Maíz", "Corn Tortilla"],
    "flour tortilla": ["Tortilla de Harina", "Flour Tortilla"], "harina tortilla": ["Tortilla de Harina", "Flour Tortilla"],
    "cilantro": ["Cilantro", "Cilantro"], "cilantro and cebolla": ["Cilantro y Cebolla", "Cilantro & Onion"],
    "con pata menudo 32oz y tortillas (4)": ["Menudo con Pata 32oz y 4 Tortillas", "Menudo with Pata 32oz & 4 Tortillas"],
    "menudo con tortillas (4)": ["Menudo con 4 Tortillas", "Menudo with 4 Tortillas"],
    "deluxe (lechuga/lettuce,pico,crema/sour cream)": ["Deluxe: lechuga, pico, crema", "Deluxe: lettuce, pico, sour cream"],
    "deluxe (lechuga/lettuce,pico,queso-fresco,crema/sour cream)": ["Deluxe: lechuga, pico, queso fresco, crema", "Deluxe: lettuce, pico, fresh cheese, sour cream"],
    "elvis '10": ["Elvis 10\"", "Elvis 10\""], "regular '10": ["Chico 10\"", "Small 10\""], "grande '12": ["Grande 12\"", "Large 12\""],
    "full beans pan": ["Charola de Frijoles", "Full Beans Pan"], "half beans pan": ["Media Charola de Frijoles", "Half Beans Pan"],
    "full rice pan": ["Charola de Arroz", "Full Rice Pan"], "half rice pan": ["Media Charola de Arroz", "Half Rice Pan"],
    "arroz - rice": ["Arroz", "Rice"], "frijoles refritos - refried beans": ["Frijoles Refritos", "Refried Beans"],
    "arroz - rice and frijole - beans": ["Arroz y Frijoles", "Rice & Beans"], "arroz-rice and frijoles-beans": ["Arroz y Frijoles", "Rice & Beans"],
    "arroz - rice and frijoles refritos - refried beans": ["Arroz y Frijoles Refritos", "Rice & Refried Beans"],
    "milanesa pollo": ["Milanesa de Pollo", "Breaded Chicken"], "mole tradicional": ["Mole Tradicional", "Traditional Mole"],
    "papas con rajas": ["Papas con Rajas", "Potatoes & Poblano Strips"], "queso fresco": ["Queso Fresco", "Fresh Cheese"]
  };
  const PRE = { extra: ["Extra", "Extra"], double: ["Doble", "Double"], doble: ["Doble", "Double"], solo: ["Solo", "Only"], grande: ["Grande", "Large"], side: ["", ""] };
  function parse(name) {
    let s = String(name || "").replace(/\s*\(\s*[+-]?\$[\d.]+\s*\)/g, "").replace(/\*+/g, " ").replace(/\s+/g, " ").replace(/^SOLO \/ ONLY\s+/i, "SOLO ").trim();
    let count = "";
    for (let i = 0; i < 3; i++) {
      const c = s.match(/^(\d+)\s*x\s+/i); if (c) { count = c[1]; s = s.slice(c[0].length); continue; }
      const k = s.match(/^\([A-Za-z]{1,6}\)\s+/); if (k) { s = s.slice(k[0].length); continue; }
      break;
    }
    const pre = [];
    for (let m; (m = s.match(/^(extra|double|doble|solo|grande|side)\s+(?=[A-Za-z])/i)) && s.length > m[0].length;) { pre.push(m[1].toLowerCase()); s = s.slice(m[0].length); }
    let size = "";
    const z = s.match(/\s+(\d+\s?oz)(\s+side)?$/i); if (z) { size = z[1].replace(/\s/g, ""); s = s.slice(0, z.index); }
    s = s.replace(/\s+side$/i, "").trim();
    return { count, pre, base: s, size };
  }
  /** {es, en, known} for any catalog option name. */
  function pair(name) {
    const p = parse(name);
    let es, en, known = true;
    if (p.base.includes(" / ")) { const [a, b] = p.base.split(" / "); es = a.trim(); en = (b || a).trim(); }
    else { const hit = MAP[p.base.toLowerCase()]; if (hit) [es, en] = hit; else { es = en = p.base; known = false; } }
    const wrap = (txt, i) => [p.count && `${p.count} ×`, ...p.pre.map((x) => PRE[x][i]).filter(Boolean), txt, p.size].filter(Boolean).join(" ");
    return { es: wrap(es, 0), en: wrap(en, 1), esBase: es, enBase: en, known };
  }
  /** Screen label: ES "Queso", EN "Cheese (Queso)" (Spanish kept so staff/customers match the menu board). */
  function label(name, lang) {
    const q = pair(name);
    if (lang === "es") return q.es;
    return q.enBase.toLowerCase() === q.esBase.toLowerCase() || /[(:]/.test(q.esBase) ? q.en : `${q.en} (${q.esBase})`;
  }
  /** One language only, for speech / read-backs. */
  function spoken(name, lang) { const q = pair(name); return lang === "es" ? q.es : q.en; }
  root.ElviI18n = { MAP, parse, pair, label, spoken };
})(typeof globalThis !== "undefined" ? globalThis : window);
