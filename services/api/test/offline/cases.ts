// Sanitized candidate cases. Not Page's original acceptance names.
// No customer names, phones, addresses, call ids, or recordings.
import type { Confirmed, UnresolvedField } from "../../src/offline-evidence.ts";

export type Turn = { speaker: "caller" | "staff"; text: string };
export type LineExpect = {
  label: string;
  match: RegExp[];
  qty: Confirmed<number>;
  lineCount?: Confirmed<number>;
  modifiers?: Confirmed<RegExp>[];
};
export type OfflineCase = {
  id: string;
  title: string;
  role: "candidate" | "control";
  /** This suite does not stand in for Page's named gate. */
  pageNamedGate: false;
  turns: Turn[];
  lines: LineExpect[];
  absent: Array<{ label: string; match: RegExp; also?: RegExp; provenance: Confirmed<boolean>["provenance"] }>;
  fulfillment?: Confirmed<"DELIVERY" | "PICKUP">;
  forbidNoOrder?: Confirmed<true>;
  requireNoOrder?: Confirmed<true>;
  forbidExistingOrder?: Confirmed<true>;
  nameMustNot?: Confirmed<RegExp>;
  unresolved: UnresolvedField[];
};

const T = "transcript" as const;
const S = "staff-readback" as const;
const SYN = "synthetic" as const;

export const CASES: OfflineCase[] = [
  {
    id: "C01",
    title: "Explicit quesadilla and coke delivery must not become an empty existing-order call",
    role: "candidate",
    pageNamedGate: false,
    turns: [
      { speaker: "caller", text: "Sí, buenas noches, abro la cocina." },
      { speaker: "caller", text: "¿Me puede dar tres quesadillas de bistec?" },
      { speaker: "staff", text: "¿Del comal?" },
      { speaker: "caller", text: "Sí, hecha a mano." },
      { speaker: "caller", text: "¿Será hasta domicilio? Y una coca." },
      { speaker: "caller", text: "Sí, será de botella." },
      { speaker: "staff", text: "Serían en total veintitrés." },
      { speaker: "staff", text: "En unos quince minutos llega tu orden." },
    ],
    lines: [
      { label: "quesadilla comal bistec", match: [/quesadilla/i, /bistec|steak/i, /comal|qco/i], qty: { value: 3, provenance: T }, lineCount: { value: 1, provenance: T } },
      { label: "coca bottle", match: [/coca|coke/i], qty: { value: 1, provenance: T }, modifiers: [{ value: /botella|bottle/i, provenance: T }] },
    ],
    absent: [],
    fulfillment: { value: "DELIVERY", provenance: T },
    forbidNoOrder: { value: true, provenance: T },
    forbidExistingOrder: { value: true, provenance: T },
    unresolved: [{ field: "coke-size", provenance: "inferred", note: "Bottle was accepted. Ounces were not spoken." }],
  },
  {
    id: "C02",
    title: "Birria platter stays an order; size is unknown",
    role: "candidate",
    pageNamedGate: false,
    turns: [
      { speaker: "caller", text: "¿Tiene birria?" },
      { speaker: "staff", text: "Sí, claro que sí." },
      { speaker: "caller", text: "¿Me puede preparar un platillo?" },
      { speaker: "staff", text: "Claro, un platillo de birria, muy bien, ¿algo más?" },
    ],
    lines: [
      { label: "birria", match: [/birria/i], qty: { value: 1, provenance: S }, lineCount: { value: 1, provenance: S } },
    ],
    absent: [],
    forbidNoOrder: { value: true, provenance: S },
    unresolved: [{ field: "birria-size", provenance: "inferred", note: "Catalog has 1 lb variants and consomé. Do not treat a size as spoken." }],
  },
  {
    id: "C03",
    title: "Retake must not duplicate doradas or tacos; cabeza was substituted",
    role: "candidate",
    pageNamedGate: false,
    turns: [
      { speaker: "caller", text: "Me prepara dos quesadillas doradas." },
      { speaker: "staff", text: "¿Preparadas?" },
      { speaker: "caller", text: "Me pone aparte todo lo que sea líquido." },
      { speaker: "staff", text: "¿Te lo pongo todo aparte?" },
      { speaker: "caller", text: "Sí, mejor." },
      { speaker: "caller", text: "Una de deshebrada de res y otra de costilla." },
      { speaker: "staff", text: "Preparada también, ¿verdad?" },
      { speaker: "caller", text: "Sí, también." },
      { speaker: "caller", text: "Dos tacos de tortilla de maíz." },
      { speaker: "staff", text: "Taqueros, ¿verdad?" },
      { speaker: "caller", text: "Sí, el normal. Uno de cabeza y uno de lengua." },
      { speaker: "staff", text: "Cabeza ya no tengo. ¿Los quieres los dos de lengua?" },
      { speaker: "caller", text: "Deme los dos de lengua." },
      { speaker: "staff", text: "Dígame otra vez su orden." },
      { speaker: "caller", text: "Dos quesadillas doradas. Una de deshebrada y otra de costilla." },
      { speaker: "staff", text: "Y todo aparte, ¿verdad?" },
      { speaker: "caller", text: "Sí, toda aparte." },
      { speaker: "staff", text: "Dos tacos taqueros." },
      { speaker: "caller", text: "No, dos tacos de tortilla de maíz." },
      { speaker: "staff", text: "Del comal." },
      { speaker: "caller", text: "Ándale, de comal. Que sean los dos de lengua." },
    ],
    lines: [
      { label: "dorada deshebrada", match: [/deluxe/i, /deshebrada/i], qty: { value: 1, provenance: S }, lineCount: { value: 1, provenance: S } },
      { label: "dorada costilla", match: [/deluxe/i, /costilla/i], qty: { value: 1, provenance: S }, lineCount: { value: 1, provenance: S } },
      { label: "tacos lengua", match: [/taco/i, /lengua/i], qty: { value: 2, provenance: S }, lineCount: { value: 1, provenance: S } },
    ],
    absent: [{ label: "cabeza", match: /cabeza/i, provenance: S }],
    unresolved: [{ field: "taco-tortilla", provenance: "inferred", note: "First answer was taquero, later comal. Latest speech says comal, still ambiguous across the retake." }],
  },
  {
    id: "C04",
    title: "Grouped quesadilla counts stay apart; horchata size unknown",
    role: "candidate",
    pageNamedGate: false,
    turns: [
      { speaker: "caller", text: "Me pones dos órdenes." },
      { speaker: "staff", text: "De quesadillas doradas, ¿verdad?" },
      { speaker: "caller", text: "Va a ser una de dos quesadillas doradas de bistec preparadas." },
      { speaker: "staff", text: "¿Y en la segunda orden?" },
      { speaker: "caller", text: "Unas tres quesadillas de comal de picadillo." },
      { speaker: "caller", text: "¿Tiene sabor de horchata?" },
      { speaker: "staff", text: "Sí." },
      { speaker: "caller", text: "Me pones también una, por favor." },
      { speaker: "staff", text: "Una horchata, claro." },
    ],
    lines: [
      { label: "dorada bistec", match: [/deluxe/i, /bistec|steak/i], qty: { value: 2, provenance: T }, lineCount: { value: 1, provenance: T } },
      { label: "comal picadillo", match: [/quesadilla/i, /picadillo/i, /comal|qco/i], qty: { value: 3, provenance: T }, lineCount: { value: 1, provenance: T } },
      { label: "horchata", match: [/horchata/i], qty: { value: 1, provenance: S }, lineCount: { value: 1, provenance: S } },
    ],
    absent: [],
    unresolved: [{ field: "horchata-size", provenance: "inferred", note: "Count is one. Cup size was not spoken." }],
  },
  {
    id: "C05",
    title: "Declined soup and a repeated dorada count stay three deluxe bistec",
    role: "candidate",
    pageNamedGate: false,
    turns: [
      { speaker: "caller", text: "Tres quesadillas de aceite de bistec las tres." },
      { speaker: "staff", text: "¿Preparadas?" },
      { speaker: "caller", text: "Sí, preparadas." },
      { speaker: "caller", text: "¿Tienes pozole?" },
      { speaker: "caller", text: "No, okay." },
      { speaker: "staff", text: "Rojo." },
      { speaker: "caller", text: "¿No tienes ningún otro caldo?" },
      { speaker: "staff", text: "Menudo." },
      { speaker: "caller", text: "¿Qué tamaño es ese menudo? No, está bien, déjalo." },
      { speaker: "caller", text: "Dame las tres, tres quesadillas nada más. Solo." },
    ],
    lines: [
      { label: "dorada bistec", match: [/deluxe/i, /bistec|steak/i], qty: { value: 3, provenance: S }, lineCount: { value: 1, provenance: S } },
    ],
    absent: [
      { label: "pozole", match: /pozole/i, provenance: T },
      { label: "menudo", match: /menudo/i, provenance: T },
    ],
    unresolved: [],
  },
  {
    id: "C06",
    title: "Declined caldo stays off; third quesadilla meat is unknown",
    role: "candidate",
    pageNamedGate: false,
    turns: [
      { speaker: "caller", text: "¿Tienes caldo de pollo?" },
      { speaker: "staff", text: "No, tenemos pozole." },
      { speaker: "caller", text: "¿Del rojo o del verde?" },
      { speaker: "staff", text: "Del rojo." },
      { speaker: "caller", text: "No, no, no, entonces." },
      { speaker: "caller", text: "¿Me pones una quesadilla y una torta?" },
      { speaker: "caller", text: "La quesadilla de tripa y la torta de costilla." },
      { speaker: "staff", text: "La torta de costilla y la quesadilla de tripa." },
      { speaker: "caller", text: "¿Y otra quesadilla aparte de, viste?" },
    ],
    lines: [
      { label: "quesadilla tripa", match: [/quesadilla/i, /tripa/i], qty: { value: 1, provenance: S }, lineCount: { value: 1, provenance: S } },
      { label: "torta costilla", match: [/torta/i, /costilla/i], qty: { value: 1, provenance: S }, lineCount: { value: 1, provenance: S } },
    ],
    absent: [
      { label: "caldo or mole from the question", match: /caldo|mole/i, provenance: T },
      { label: "costilla copied onto a quesadilla", match: /quesadilla/i, also: /costilla/i, provenance: S },
    ],
    unresolved: [
      { field: "third-quesadilla-meat", provenance: "inferred", note: "The extra quesadilla meat is not in the caller transcript. Do not assert bistec." },
      { field: "quesadilla-tortilla", provenance: "inferred", note: "Comal was not confirmed for this order." },
    ],
  },
  {
    id: "C07",
    title: "Acknowledged frijoles modifier stays on the prensado quesadilla",
    role: "candidate",
    pageNamedGate: false,
    turns: [
      { speaker: "caller", text: "Quesadillas del comal, una de chicharrón prensado con frijoles y otra de bistec. Y tres tacos de asada de bistec." },
      { speaker: "staff", text: "Del comal." },
      { speaker: "caller", text: "Sí." },
      { speaker: "staff", text: "Tres tacos de el comal de asada, una quesadilla de comal de bistec y una quesadilla de comal de prensado con frijoles." },
      { speaker: "caller", text: "Sí." },
    ],
    lines: [
      { label: "comal prensado frijoles", match: [/quesadilla/i, /prensado/i], qty: { value: 1, provenance: S }, modifiers: [{ value: /frijol/i, provenance: S }] },
      { label: "comal bistec", match: [/quesadilla/i, /bistec|steak/i], qty: { value: 1, provenance: S } },
      { label: "tacos bistec", match: [/taco/i, /bistec|asada|steak/i], qty: { value: 3, provenance: S } },
    ],
    absent: [],
    unresolved: [],
  },
  {
    id: "C08",
    title: "Spoken fajita chicken must not disappear when a short prompt omitted it",
    role: "candidate",
    pageNamedGate: false,
    turns: [
      { speaker: "caller", text: "Quiero unas fajitas." },
      { speaker: "staff", text: "¿De qué las quieres?" },
      { speaker: "caller", text: "De pollo." },
      { speaker: "staff", text: "¿De pollo? ¿Arroz y frijoles está bien?" },
      { speaker: "caller", text: "Sí, por favor." },
      { speaker: "caller", text: "Dos quesadillas doradas de bistec con cabeza, preparadas." },
      { speaker: "staff", text: "Preparadas, bistec y cabeza." },
      { speaker: "caller", text: "Y un agua de Jamaica. Sí, que sea delivery." },
    ],
    lines: [
      { label: "fajitas pollo", match: [/fajita/i, /pollo|chicken/i], qty: { value: 1, provenance: S }, modifiers: [{ value: /arroz/i, provenance: S }, { value: /frijol/i, provenance: S }] },
      { label: "dorada bistec", match: [/deluxe/i, /bistec|steak/i], qty: { value: 1, provenance: S } },
      { label: "dorada cabeza", match: [/deluxe/i, /cabeza/i], qty: { value: 1, provenance: S } },
      { label: "jamaica", match: [/jamaica/i], qty: { value: 1, provenance: T } },
    ],
    absent: [],
    fulfillment: { value: "DELIVERY", provenance: T },
    unresolved: [
      { field: "fajita-tortilla", provenance: "inferred", note: "Tortilla was not chosen by the caller." },
      { field: "jamaica-size", provenance: "inferred", note: "Drink size was not spoken." },
    ],
  },
  {
    id: "C09",
    title: "Staff-named Elvis dip wins; flavor and catalog size stay unresolved",
    role: "candidate",
    pageNamedGate: false,
    turns: [
      { speaker: "caller", text: "One of your big shrimp cocktails, like the big cup." },
      { speaker: "staff", text: "The shrimp cocktail." },
      { speaker: "caller", text: "Yeah, the shrimp, yes." },
      { speaker: "caller", text: "A large bowl of queso with chorizo." },
      { speaker: "staff", text: "Okay, queso dip, the Elvis dip." },
      { speaker: "staff", text: "Elvis dip with chorizo, right?" },
      { speaker: "caller", text: "Sounds good." },
      { speaker: "caller", text: "Two of those large red drinks." },
      { speaker: "staff", text: "The, or." },
      { speaker: "caller", text: "Strawberry or." },
      { speaker: "staff", text: "The horchata?" },
      { speaker: "caller", text: "The one next to the horchata, punch. Yeah." },
    ],
    lines: [
      { label: "shrimp cocktail", match: [/shrimp|camar[oó]n|coctel|cóctel/i], qty: { value: 1, provenance: S } },
      { label: "elvis dip chorizo", match: [/elvis|queso/i, /chorizo/i], qty: { value: 1, provenance: S } },
      { label: "red drinks", match: [/agua|punch|horchata|jamaica|fresa|strawberry/i], qty: { value: 2, provenance: T } },
    ],
    absent: [{ label: "strawberry committed mid-sentence", match: /fresa|strawberry/i, provenance: T }],
    unresolved: [
      { field: "drink-flavor", provenance: "inferred", note: "Relative punch next to horchata. Flavor was not named. Do not assert Jamaica." },
      { field: "drink-32oz", provenance: "catalog-default", note: "Large 32oz is a catalog default, not spoken." },
      { field: "dip-chips", provenance: "catalog-required", note: "Chips are catalog-required, not spoken." },
    ],
  },
  {
    id: "C10",
    title: "Menudo count stays two; soda brand conflicts; pickup time is not a name",
    role: "candidate",
    pageNamedGate: false,
    turns: [
      { speaker: "caller", text: "Quiero hacer una orden para como las once diez." },
      { speaker: "caller", text: "Para recogerla. Quiero dos menudos con pata." },
      { speaker: "caller", text: "Son dos menudos con pata y quiero un agua de Jamaica y una, no sé." },
      { speaker: "staff", text: "Una agua." },
      { speaker: "caller", text: "No sé si tengas Coca o Pepsi de botella. ¿O tienes de los dos?" },
      { speaker: "staff", text: "Sí." },
      { speaker: "caller", text: "Tráeme una Pepsi de bote grande." },
      { speaker: "staff", text: "Tengo de tapa rosa." },
      { speaker: "caller", text: "Esa mera." },
      { speaker: "caller", text: "¿Para recogerlo como a las once diez?" },
      { speaker: "staff", text: "Te le pongo aquí una nota." },
      { speaker: "staff", text: "Dos menudos con patas, el agua de Jamaica y la coca." },
      { speaker: "caller", text: "Exactamente." },
    ],
    lines: [
      { label: "menudo pata", match: [/menudo/i, /pata/i], qty: { value: 2, provenance: S }, lineCount: { value: 1, provenance: S } },
      { label: "jamaica", match: [/jamaica/i], qty: { value: 1, provenance: S }, lineCount: { value: 1, provenance: T } },
    ],
    absent: [{ label: "water from the word botella", match: /\bwater\b|agua embotellada|botella de agua/i, provenance: T }],
    fulfillment: { value: "PICKUP", provenance: S },
    nameMustNot: { value: /recogerlo como/i, provenance: T },
    unresolved: [
      { field: "soda-brand", provenance: "inferred", note: "Caller asked Pepsi. Staff readback said coca and the caller agreed. Brand stays conflicting." },
      { field: "jamaica-size", provenance: "inferred", note: "Size was not spoken." },
      { field: "menudo-tortilla", provenance: "inferred", note: "Tortilla choice was not spoken." },
      { field: "pickup-note-11-10", provenance: "inferred", note: "The time was spoken and staff said they would note it. This replay does not assert a stored ticket note." },
    ],
  },
  {
    id: "C11",
    title: "Preparadas stay deluxe; menudo is not duplicated by a later recap",
    role: "candidate",
    pageNamedGate: false,
    turns: [
      { speaker: "caller", text: "Van a ser tres, tres menudos." },
      { speaker: "staff", text: "¿Regular o con pata?" },
      { speaker: "caller", text: "Con pata, por favor, los tres." },
      { speaker: "caller", text: "Dos quesadillas de chicharrón prensado doradas, con todo." },
      { speaker: "staff", text: "Muy bien, preparadas." },
      { speaker: "caller", text: "Sí, por favor." },
      { speaker: "caller", text: "Una quesadilla de comal de tripas." },
      { speaker: "caller", text: "Nada más." },
    ],
    lines: [
      { label: "menudo pata", match: [/menudo/i, /pata/i], qty: { value: 3, provenance: S }, lineCount: { value: 1, provenance: S } },
      { label: "dorada prensado", match: [/deluxe/i, /prensado/i], qty: { value: 2, provenance: S }, lineCount: { value: 1, provenance: S } },
      { label: "comal tripa", match: [/quesadilla/i, /tripa/i, /comal|qco/i], qty: { value: 1, provenance: T } },
    ],
    absent: [],
    unresolved: [{ field: "menudo-tortilla", provenance: "inferred", note: "Tortilla was not spoken." }],
  },
  {
    id: "C12",
    title: "Three pozoles survive greeting filler; red is a house default, not ground truth",
    role: "control",
    pageNamedGate: false,
    turns: [
      { speaker: "caller", text: "Señorita, sí, escucha. Me puede poner tres pozoles." },
      { speaker: "caller", text: "Es todo, señorita." },
    ],
    lines: [
      { label: "pozole", match: [/pozole/i], qty: { value: 3, provenance: T }, lineCount: { value: 1, provenance: T } },
    ],
    absent: [{ label: "fajitas or vapor from filler", match: /fajita|vapor|steamed/i, provenance: T }],
    unresolved: [{ field: "pozole-color", provenance: "inferred", note: "Nobody said red or a meat. A red default is not ground truth. Coverage here is not a live or merged claim." }],
  },
  {
    id: "S01",
    title: "Synthetic cancel removes the soup",
    role: "control",
    pageNamedGate: false,
    turns: [
      { speaker: "caller", text: "Me puede poner tres pozoles." },
      { speaker: "caller", text: "Quítame el pozole." },
    ],
    lines: [],
    absent: [{ label: "pozole", match: /pozole/i, provenance: SYN }],
    unresolved: [],
  },
  {
    id: "S02",
    title: "Synthetic decrease keeps two pozoles",
    role: "control",
    pageNamedGate: false,
    turns: [
      { speaker: "caller", text: "Me puede poner tres pozoles." },
      { speaker: "caller", text: "Mejor dos pozoles." },
    ],
    lines: [
      { label: "pozole", match: [/pozole/i], qty: { value: 2, provenance: SYN }, lineCount: { value: 1, provenance: SYN } },
    ],
    absent: [],
    unresolved: [{ field: "pozole-color", provenance: "inferred", note: "Synthetic count only. Color was not spoken." }],
  },
  {
    id: "S03",
    title: "Synthetic non-order: person in charge, no dish",
    role: "control",
    pageNamedGate: false,
    turns: [
      { speaker: "caller", text: "Buenas, quiero hablar con la persona a cargo." },
    ],
    lines: [],
    absent: [{ label: "any food", match: /pozole|taco|quesadilla|menudo|birria/i, provenance: SYN }],
    requireNoOrder: { value: true, provenance: SYN },
    unresolved: [],
  },
  {
    id: "S04",
    title: "Synthetic declined availability ask must not leave a soup",
    role: "candidate",
    pageNamedGate: false,
    turns: [
      { speaker: "caller", text: "¿Tienes pozole?" },
      { speaker: "caller", text: "No, okay." },
    ],
    lines: [],
    absent: [{ label: "pozole", match: /pozole/i, provenance: SYN }],
    unresolved: [],
  },
];
