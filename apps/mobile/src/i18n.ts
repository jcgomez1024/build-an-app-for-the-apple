import type { Language } from "./types";

export const copy = {
  en: {
    title: "Cocina Elvis",
    subtitle: "Voice ordering for pickup or delivery",
    listen: "Listen",
    stop: "Stop",
    checkout: "Checkout",
    runCommand: "Ask Elvi",
    pickup: "Pickup",
    delivery: "Delivery",
    order: "Order",
    empty: "Say what you want to eat.",
    total: "Total",
    namePlaceholder: "Name",
    phonePlaceholder: "Phone",
    emailPlaceholder: "Email",
    addressPlaceholder: "Delivery address",
    prompt:
      "Say: add two steak tacos, delivery, my address is 123 Main Street, checkout.",
    ready: "I'm ready. Tell me your order.",
    added: "Added",
    noMatch: "I did not catch a menu item. Please try again."
  },
  es: {
    title: "Cocina Elvis",
    subtitle: "Pedidos por voz para recoger o entrega",
    listen: "Escuchar",
    stop: "Parar",
    checkout: "Pagar",
    runCommand: "Preguntar a Elvi",
    pickup: "Recoger",
    delivery: "Entrega",
    order: "Pedido",
    empty: "Di lo que quieres comer.",
    total: "Total",
    namePlaceholder: "Nombre",
    phonePlaceholder: "Telefono",
    emailPlaceholder: "Email",
    addressPlaceholder: "Direccion de entrega",
    prompt:
      "Di: agrega dos tacos de carne, entrega, mi direccion es 123 Main Street, pagar.",
    ready: "Estoy lista. Dime tu pedido.",
    added: "Agregado",
    noMatch: "No encontre un plato del menu. Intentalo otra vez."
  }
} satisfies Record<Language, Record<string, string>>;
