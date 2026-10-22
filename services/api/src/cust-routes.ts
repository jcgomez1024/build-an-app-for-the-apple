// cust1: /api/cust/* — phone login (code), session, own favorites + past orders. Square is read-only; no profiles created.
import type { Express, Request } from "express";
import express from "express";
import { CodeSender, CustomerLookup, toE164, sendAllowed, checkAllowed, signSession, readSession, cookieHeader, clearCookie, emailSenderStub } from "./cust-auth.js";
import { favoritesFor, type History } from "./favorites.js";
import { phoneKey } from "./caller-memory.js";

export type CustDeps = { sender: () => CodeSender; lookup: CustomerLookup; history: () => History; menu: () => Promise<any[]>; secure?: boolean; profileFor?: (p: string) => { cid: string; fn: string | null } | null };
const ipOf = (req: Request) => String(req.headers["cf-connecting-ip"] || req.ip || "").slice(0, 64);
const lang = (req: Request) => (req.body?.lang === "en" || req.query.lang === "en" ? "en" : "es") as "es" | "en";
const SAME = { ok: true, sent: true }; // identical for every valid phone — never says whether a profile exists

export function registerCustRoutes(app: Express, d: CustDeps) {
  const json = express.json({ limit: "4kb" });
  app.post("/api/cust/start", json, async (req, res) => {
    const p = toE164(req.body?.phone); if (!p) return res.status(400).json({ error: lang(req) === "es" ? "Número no válido." : "Invalid number." });
    const lim = sendAllowed(p, ipOf(req));
    if (!lim.ok) { res.setHeader("Retry-After", String(lim.retryAfterSec || 600)); return res.status(429).json({ error: lang(req) === "es" ? "Demasiados intentos. Intente más tarde." : "Too many tries. Try again later." }); }
    const channel = req.body?.channel === "email" && process.env.CUST_EMAIL_FALLBACK === "1" ? "email" : "sms";
    const s = channel === "email" ? emailSenderStub : d.sender();
    const r = await s.send(p, { locale: lang(req), channel }).catch(() => ({ ok: false }));
    if (!r.ok) return res.status(503).json({ error: lang(req) === "es" ? "No pudimos enviar el código. Intente de nuevo." : "We couldn't send the code. Please try again." });
    res.json(SAME);
  });
  app.post("/api/cust/verify", json, async (req, res) => {
    const p = toE164(req.body?.phone), code = String(req.body?.code || "").replace(/\D/g, "");
    if (!p || code.length !== 6) return res.status(400).json({ error: lang(req) === "es" ? "Código no válido." : "Invalid code." });
    const lim = checkAllowed(p, ipOf(req));
    if (!lim.ok) { res.setHeader("Retry-After", String(lim.retryAfterSec || 600)); return res.status(429).json({ error: lang(req) === "es" ? "Demasiados intentos." : "Too many tries." }); }
    const ok = await d.sender().check(p, code).catch(() => false);
    if (!ok) return res.status(401).json({ error: lang(req) === "es" ? "Código incorrecto o vencido." : "Wrong or expired code." });
    const c = await d.lookup(p).catch(() => null); // READ-ONLY; no match → guest
    res.setHeader("Set-Cookie", cookieHeader(signSession({ p, cid: c?.id || null, fn: c?.givenName || null, em: c?.email || null }), d.secure !== false));
    res.json({ ok: true, firstName: c?.givenName || null, guest: !c });
  });
  app.post("/api/cust/logout", (_req, res) => { res.setHeader("Set-Cookie", clearCookie(d.secure !== false)); res.json({ ok: true }); });
  app.get("/api/cust/me", async (req, res) => {
    let s = readSession(req.headers.cookie); if (!s) return res.json({ loggedIn: false });
    if (!s.cid) { const h = d.profileFor?.(s.p); if (h) { const v = signSession({ p: s.p, cid: h.cid, fn: h.fn, em: s.em }); res.setHeader("Set-Cookie", cookieHeader(v, d.secure !== false)); s = readSession(`elvi_cust=${encodeURIComponent(v)}`)!; } } // prof1
    const L = lang(req), hist = d.history()[phoneKey(s.p)] || [];
    let fav: any = null; try { fav = favoritesFor(hist, await d.menu(), { name: s.fn, channel: "app", nudge: null }); } catch { fav = null; }
    res.json({
      loggedIn: true, firstName: s.fn, guest: !s.cid, phone: s.p, email: s.em,
      favorites: fav ? { kind: fav.kind, greeting: fav.greeting[L], offers: fav.offers.map((o: any[]) => ({ label: o.map((l) => l.label[L]).join(" + "), cents: o.reduce((a, l) => a + l.cents, 0), actions: o.map((l) => l.action) })) } : null,
      pastOrders: hist.slice(0, 5).map((o) => ({ at: o.at, fulfillment: o.fulfillment, lines: o.lines.map((l) => `${l.qty}× ${l.name.replace(/\s*\(online\)/i, "")}`) })),
    });
  });
}
