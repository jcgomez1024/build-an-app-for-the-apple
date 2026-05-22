import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface BuildStep {
  step: number;
  title: string;
  instruction: string;
  required: boolean;
  max_selections: number | null;
  options: Array<{ name: string; code?: string; price_note?: string }>;
}

export interface ComboGuide {
  display_name: string;
  price: number;
  description: string;
  steps: BuildStep[];
}

export interface GuidesData {
  version: string;
  guides: Record<string, ComboGuide>;
}

const EMPTY_GUIDES: GuidesData = { version: "0", guides: {} };

const GUIDES_PATH = path.resolve(__dirname, '../../data/combo-guides.json');
const MENU_CATALOG_PATH = path.resolve(__dirname, '../../data/menu-catalog.json');

let cachedGuides: GuidesData | null = null;
let cachedGuidesMtimeMs = 0;
let cachedMenuCatalog: Set<string> | null = null;
let cachedMenuCatalogMtimeMs = 0;

function readJsonIfChanged<T>(filePath: string, cachedMtime: number): { data: T | null; mtimeMs: number } {
  try {
    const stat = fs.statSync(filePath);
    if (cachedMtime === stat.mtimeMs) return { data: null, mtimeMs: cachedMtime };
    const raw = fs.readFileSync(filePath, 'utf-8');
    return { data: JSON.parse(raw) as T, mtimeMs: stat.mtimeMs };
  } catch (err) {
    console.warn(`[guides] failed to load ${filePath}:`, (err as Error).message);
    return { data: null, mtimeMs: cachedMtime };
  }
}

function loadGuides(): GuidesData {
  const { data, mtimeMs } = readJsonIfChanged<GuidesData>(GUIDES_PATH, cachedGuidesMtimeMs);
  if (data) {
    cachedGuides = data;
    cachedGuidesMtimeMs = mtimeMs;
  } else if (!cachedGuides) {
    cachedGuides = EMPTY_GUIDES;
  }
  return cachedGuides;
}

export function getComboGuide(itemName: string): ComboGuide | null {
  const data = loadGuides();
  if (!itemName) return null;

  const normalized = itemName.toLowerCase().trim();

  if (data.guides[itemName]) return data.guides[itemName];

  for (const [key, guide] of Object.entries(data.guides)) {
    if (key.toLowerCase() === normalized || guide.display_name.toLowerCase() === normalized) {
      return guide;
    }
  }

  for (const [key, guide] of Object.entries(data.guides)) {
    const keyLower = key.toLowerCase();
    const displayLower = guide.display_name.toLowerCase();
    if (normalized.includes(keyLower) || keyLower.includes(normalized) ||
        normalized.includes(displayLower) || displayLower.includes(normalized)) {
      return guide;
    }
  }

  return null;
}

export function isGuidedCombo(itemName: string): boolean {
  return getComboGuide(itemName) !== null;
}

export function getAllGuidedComboNames(): string[] {
  return Object.keys(loadGuides().guides);
}

function loadMenuCatalog(): Set<string> {
  const { data, mtimeMs } = readJsonIfChanged<{ allowed_items?: string[] }>(MENU_CATALOG_PATH, cachedMenuCatalogMtimeMs);
  if (data) {
    const items = Array.isArray(data.allowed_items) ? data.allowed_items : [];
    cachedMenuCatalog = new Set(items.map((item) => item.toLowerCase().trim()));
    cachedMenuCatalogMtimeMs = mtimeMs;
  } else if (!cachedMenuCatalog) {
    cachedMenuCatalog = new Set();
  }
  return cachedMenuCatalog;
}

export function isApprovedItem(itemName: string): boolean {
  if (!itemName) return false;
  const catalog = loadMenuCatalog();
  if (catalog.size === 0) return true;
  return catalog.has(itemName.toLowerCase().trim());
}

export function getApprovedMenuItems(): string[] {
  return Array.from(loadMenuCatalog());
}
