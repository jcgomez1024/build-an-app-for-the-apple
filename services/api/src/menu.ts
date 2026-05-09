export type ModifierGroup = {
  id: string;
  name: string;
  options: string[];
  minSelections?: number;
  maxSelections?: number;
  allowQuantities?: boolean;
};

export type MenuItem = {
  id: string;
  name: string;
  nameEs: string;
  aliases: string[];
  priceCents: number;
  imageUrl?: string;
  squareCatalogObjectId?: string;
  squareVariationId?: string;
  modifierGroups?: ModifierGroup[];
};

export const fallbackMenu: MenuItem[] = [
  {
    id: "pollo-bowl",
    name: "Chicken Bowl",
    nameEs: "Bowl de Pollo",
    aliases: ["chicken bowl", "pollo bowl", "bowl de pollo", "pollo"],
    priceCents: 1299,
    imageUrl: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=480&q=80"
  },
  {
    id: "carne-tacos",
    name: "Steak Tacos",
    nameEs: "Tacos de Carne",
    aliases: ["steak tacos", "carne tacos", "tacos de carne", "taco de carne"],
    priceCents: 1199,
    imageUrl: "https://images.unsplash.com/photo-1611250188496-e966043a0629?auto=format&fit=crop&w=480&q=80"
  },
  {
    id: "pernil-plate",
    name: "Pernil Plate",
    nameEs: "Plato de Pernil",
    aliases: ["pernil plate", "plato de pernil", "pernil"],
    priceCents: 1499,
    imageUrl: "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=480&q=80"
  },
  {
    id: "empanada",
    name: "Empanada",
    nameEs: "Empanada",
    aliases: ["empanada", "empanadas"],
    priceCents: 399,
    imageUrl: "https://images.unsplash.com/photo-1625944528232-7d6f5f2f5b5c?auto=format&fit=crop&w=480&q=80"
  },
  {
    id: "maduros",
    name: "Sweet Plantains",
    nameEs: "Maduros",
    aliases: ["sweet plantains", "maduros", "plantains", "platanos maduros"],
    priceCents: 499,
    imageUrl: "https://images.unsplash.com/photo-1603046891744-1f76eb10aec1?auto=format&fit=crop&w=480&q=80"
  }
];

export function findMenuItem(id: string): MenuItem | undefined {
  return fallbackMenu.find((item) => item.id === id);
}
