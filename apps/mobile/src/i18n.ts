import type { Language } from "./types";

export const copy = {
  en: {
    title: "Cocina Elvis",
    subtitle: "Voice ordering for pickup",
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
      "Say: add two steak tacos for pickup, my name is Carlos, checkout.",
    ready: "I'm ready. Tell me your order.",
    added: "Added",
    noMatch: "I did not catch a menu item. Please try again.",
    deliveryDisabled:
      "Delivery by voice ordering is coming soon. Please use the regular online ordering site for delivery."
  },
  es: {
    title: "Cocina Elvis",
    subtitle: "Pedidos por voz para recoger",
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
      "Di: agrega dos tacos de carne para recoger, mi nombre es Carlos, pagar.",
    ready: "Estoy lista. Dime tu pedido.",
    added: "Agregado",
    noMatch: "No encontre un plato del menu. Intentalo otra vez.",
    deliveryDisabled:
      "Delivery by voice ordering is coming soon. Please use the regular online ordering site for delivery."
  }
} satisfies Record<Language, Record<string, string>>;
