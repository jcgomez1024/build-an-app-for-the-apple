# order.cocinaelvis.app — Full browsable menu + Elvi (v3 spec)
Mobile-first. Mockup: `index.html` (data: `menu.js`, built by `tools/build_menu.py` from the Square Online catalog `v1/tools/prods.json` + `cats.json`). Brand: `/workspace/elvi-brand/BRAND.md`, `halo-tokens.css`, v1/v2 mockup styles — **Elvi avatar/halo and voice (mic) buttons unchanged**.

## 1. Layout
**Mobile (<960px)**
1. Header (sticky, 60px, blue gradient): logo 44px · "Cocina Elvis" + "101 W Walnut Ave · Painesville" · status pill (`Abierto · cierra 8:00pm` / `Último pedido 7:40pm` / `Abre 11:00am` / `Cerrado · programar`) · ES/EN.
2. Store-state banner (only when not plainly open, §6).
3. Segmented toggle **Menú | Elvi** (glass, active = blue gradient). Default Menú.
4. **Menú view**: sticky **search bar** (§2b) + sticky tab bar (§2) + category sections (§3).
5. **Elvi view**: Elvi card (42px halo + mic 46px), chat log, shared cart summary. Idle invite: ES *“Dime qué te gustaría, yo te puedo ayudar”* / EN *“Just tell me what you’d like — I can help you”*. **Language auto-detect** (§2c): Elvi sniffs ES/EN from the customer’s first fluid sentence(s); header ES/EN toggle stays as a manual override.
6. Bottom stack (fixed, safe-area aware), top → bottom:
   - **Floating “Hablar con Elvi” capsule** (Lou-inspired, mobile only): dark glass pill, brand blue/green **glowing top edge**, mini 26px halo + label (`Hablar con Elvi` / `Talk to Elvi`). Centered above the cart/Elvi bars; z above menu cards, below sheets. Tap → same `voiceDemo()` as the mic. Glow intensifies with halo state (listening green pulse, thinking purple, speaking amber, error red). **Hidden in Elvi view** (voice already primary there); pinned compact Elvi bar stays — capsule is an extra entry so the menu stays browsable while voice is on (unlike Papa John’s Lou locked overlay).
   - Cart bar (only when cart > 0).
   - **Compact Elvi bar** (42px halo · last Elvi line · mic 46px). Stays pinned while browsing; hidden in Elvi view.

**Desktop (≥960px)**: 2-column grid, max 1280px. Left 360px sticky glass column = Elvi panel (halo, mic, chat, cart, "Ver orden"). Main = tab bar + sections, cards in 2 columns. No toggle, no bottom stack. Item/cart sheets become centered 560px modals.

## 2. Category tab bar
- Order: **Popular** (top 6 by Square `popularity_score`), then Square categories in catalog order: Elvis Combos, Elvis Meals (Packs), Especial del Día, Sábado/Domingo, Enchiladas/Tacos al Vapor, Fiesta Platters, Bebidas, Dips/Acompañantes, Mariscos, Favoritos, Platillos Tradicionales. **Skip all `(MESA)` duplicates.** ES/EN labels per category.
- Sticky under the search bar (`top: header + search height`), glass background + blur, horizontal scroll, scrollbar hidden.
- Tap → smooth-scroll to section with offset = header + search + tab bar height (+6px). Sections also get `scroll-margin-top` for deep links (`#s-<catId>`).
- Scroll-spy: active section = last section whose top ≤ header+tabs+24px; active tab = white bg, blue text, green #2fd47a border + glow; auto-scroll the tab bar so the active tab is centered (`scrollTo({left, behavior:'smooth'})`). Throttle with rAF.
- Time-limited categories get a small ⏱ on the tab when not available now.

## 2b. Menu search (Carlos 10/24)
- Prominent sticky field under the header (above category tabs) in Menú view — large tap target, green-tinted border, 🔍. Placeholder ES `Buscar en el menú…` / EN `Search the menu…`.
- Live filter by item **name + short description** (case-insensitive substring). Type a fragment (e.g. “burrito”, “queso”) → non-matches hide, empty categories collapse, matching tabs remain, and the view **auto-scrolls to the first match** so customers don’t hunt manually.
- ✕ clears the query. Empty results: *“No encontramos eso — prueba otro nombre o habla con Elvi.”*
- Capsule + Elvi bar stay visible while searching (menu stays browsable; voice still one tap away).

## 2c. Language auto-detect (Carlos 10/24)
- Soft opener stays bilingual by current UI lang; Elvi does **not** force a toggle hunt.
- After the customer speaks/types a **fluid sentence** (roughly 4+ content words, **or** a clear subject+verb order intent like *“Quiero un burrito de asada”* / *“I want a burrito”*), Elvi detects ES vs EN and calls `setLang`. Short fragments — one-word answers, menu taps, *“burrito”*, *“sí”*, *“ok”* — **never** flip language.
- Heuristic (mock): Spanish cues (quiero, carne, también, por favor, con/para/el/la/un + accents) vs English (*I want*, *please*, *with*, *the*, *a*). Food nouns alone are neutral. First decisive fluid utterance sets the session lang; later clear sentences in the other language can switch; header **ES/EN** always overrides.
- On switch: UI chrome + Elvi’s next line flip via `setLang` **silently** — no language chip, toast, or announcement (Carlos: invisible problem-solving). Header ES/EN remains the only explicit control.
- Mock controls: demo buttons `🎤 “Quiero…”` / `🎤 “I want…”` call `voiceDemo('es'|'en')`; mic/Hablar capsule use the current UI lang’s demo sentence and still run detect.

## 3. Item cards
- Row card: 92px rounded photo thumb (real photo from `img/`, `object-fit:cover`), name (700), 1-line description (ellipsis, from Square `short_description`), price (`$X.XX` or `$low–$high`), round **+** button (blue gradient, 34px, bottom-right).
- No-photo variant: hide thumb, same text block (never AI images; gray "PHOTO: <item>" placeholder only inside option tiles if missing).
- Badges (above name): `★ Popular` (top 4), `Agotado / Sold out` (Square `badges.out_of_stock` or `all_variations_sold_out`), `Disponible <día> <hora>` for time windows.
- **Unavailable** (sold out or outside window): 55% opacity + grayscale, no + button, not tappable; time-window cards show the **next start time** (e.g. `Disponible mié 11:00am`). Section subtitle shows the window (`Disponible mié 11:00am · 11:00am–8:30pm`).
- Category windows come from Square `cats[].availability.pickup.hours` (§7).

## 4. Tapping an item (tap and voice share ONE cart)
- **Simple item** (no required modifier group): add 1 to cart immediately; toast `✓ <item>`; Elvi bar: "Agregué <item>. ¿Algo más?" (halo → speaking).
- **Item with required choices**: open the step sheet (bottom sheet mobile / modal desktop):
  - Hero (photo, name, live price) + Elvi line with halo.
  - Groups in Square order. Defaults preselected silently with `Recomendado` chip (Comal, Grande, Salsa Asada…). Required groups without a default are highlighted (amber) and listed first in Elvi's question.
  - Optional groups (Deluxe, Extras, Con, Agua Fresca…) collapsed under **"＋ Agregar extras"** — Elvi never asks.
  - **Burrito / COMBO Burrito fillings ("Adentro") are required with no default** (Carlos 10/16) — override Square's `min=-1` (`REQ_OVERRIDE`).
  - Elvi asks **only** the first missing required group: "¿De qué carne?", then "¿Qué le ponemos adentro?". When complete: "Perfecto: Burrito — bistec…".
  - Footer: ✕ + primary button `Falta: Carne` (disabled) → `Agregar · $11.00`.
  - Option tiles: photo tiles when we have a real photo, otherwise text tiles; picked = green border + ✓; price chip `+$0.50`. DOBLE bar from v1 applies to fillings.
- **Voice**: fluid sentence e.g. "Quiero un burrito" / "I want a burrito" → detect lang (§2c) → halo listening → thinking → opens the same sheet with Grande preselected and Elvi asks "¿De qué carne?" / "What meat?". A spoken meat (e.g. "de asada") pre-fills the meat. Same cart, same sheet, same rules. Short replies after that do not re-flip language.

## 5. Cart bar
- Shows `🛒 <qty> · Ver orden` + subtotal; blue gradient; above Elvi bar. Tap → cart sheet (lines with details, subtotal, "Impuesto y total final los calcula Square", Pagar → Square checkout).
- Empty cart: hidden on mobile; desktop panel shows "Vacía — agrega algo del menú o dímelo."

## 6. Store states (America/New_York, 20-min prep)
Hours (confirmed by Carlos 10/21): **Mon closed · Tue 11–5 · Wed–Thu 11–8 · Fri 11–9 · Sat–Sun 10–8.** Last order = close − 20 min (Sat/Sun last order 7:40pm). Next opening after Sun rolls past Monday to **Tue 11:00am**.
| State | When | UI |
|---|---|---|
| Open | open ≤ now < close−40m | green pill `Abierto · cierra 8:00pm`, no banner |
| Last order | close−40m ≤ now < close−20m | amber pill `Último pedido 7:40pm` + banner explaining 20-min prep |
| Before open | same day, before open | blue banner `Abrimos hoy a las 11:00am` + checkbox **`Programar para recoger hoy 11:00am` (on by default)**; + adds to cart as a scheduled pickup; cart bar `Recoger hoy 11:00am` |
| Closed | Monday, or now ≥ close−20m | red pill `Cerrado · programar` + banner **`Cerrado ahora · Programar para mar 11:00am`** with schedule checkbox **on by default** + full hours. Pickup = next opening. Cart bar `🛒 N · Recoger mar 11:00am`; cart sheet shows `🗓 Recoger mar 11:00am · programado`. On first add Elvi: *“Estamos cerrados, ¿lo programo para mañana a las 11?”* (`mañana` if next opening is tomorrow, else day name). Unchecking → browse-only (+ disabled, Elvi states opening time). |
| Empty | open, cart 0 | no cart bar; Elvi idle: "Dime qué te gustaría, yo te puedo ayudar" / "Just tell me what you’d like — I can help you" |
Use server time; re-evaluate every minute; also block checkout server-side.

## 7. Data rules
- Source of truth: Square catalog (items, prices, modifier groups, defaults, sold-out, category windows). Strip `(ONLINE)` and code prefixes like `(A)`, `(TCO)`, `***` from display names.
- Item availability = store open AND (no category window OR inside one of its windows). Next start = max(window open, store open that day).
- Availability while scheduling is evaluated **at the pickup time**, not now: items not available at the next opening (e.g. Enchiladas/Tacos al Vapor Wed–Fri, Sábado/Domingo) stay greyed with their next start. Windows: Especial del Día Tue 11–5, Wed–Sun (clamped to store open); **Sábado/Domingo Sat–Sun 10am–8pm (Cash App confirmed)**; Enchiladas/Tacos al Vapor Wed–Fri 11am–8:30pm. Tech: update the Square Online category hours to match.

## 8. Accessibility / perf
Tabs are buttons with `aria-current` on active; sheet traps focus, Esc closes; `prefers-reduced-motion` disables halo + smooth scroll; lazy-load thumbs (480px JPEG ~30 KB); tap targets ≥ 34px.

## 9. Typography (v3c — Carlos 10/24 “more elegant”)
- **Body / UI:** Plus Jakarta Sans 400/500/600/700 (replaced Space Grotesk — softer terminals, warm, Spanish-friendly).
- **Display / section titles:** Syne 500/600/700 only (dropped 800). Used for Cocina Elvis header, category `h2`, sheet titles, Elvi name — not for every button.
- Antialiased; light body tracking (`.005em`); display titles slightly tight (`-.01em`–`-.015em`).
- Small UI labels (status, ES/EN, badges, Elvi “Escuchando…”) use **600 + +letter-spacing** (~`.04–.06em`) instead of heavy black caps.
- Item names/prices **600** (was 700/800); descriptions **400**; Hablar capsule **600 Plus Jakarta** with `.03em` tracking (Lou glow kept).
- Hierarchy: titles Syne 600 → card names Jakarta 600 → meta/muted 400–500. Avoid ultra-black everywhere.

## Open questions
1. ~~Sábado/Domingo hours~~ — resolved: Sat & Sun 10am–8pm (Cash App correct).
2. Especial del Día window in Square starts 9am Wed–Sat but the store opens 11am — mockup clamps to store open; confirm.
3. The example "Disponible 11:20am–4:59pm" isn't in the Square data — is that a per-item window to add in Square?
4. Popular = Square popularity (Quesadilla, QD Quesadilla Dorada, Taco, Burrito, Dips, Extras). Cash App's Popular differs (Dips, Extras, COMBO Quesadillas, 3/4 Pack). Hand-pick instead?
5. Aguas Frescas has no flavor modifier in Square (Horchata/Jamaica) — add one so it opens the sheet.
6. "Platillo Filete de Pescado" and "Filete de Pescado / Fish" have no category in Square, so they don't show.
7. ~~Before-open/closed ordering~~ — resolved: scheduled pickup at next opening, on by default.

## Display names — title case (Carlos 10/24)
- UI shows title-cased item + option names (`titleCase()` in index.html, applied once after MENU loads). Square data unchanged; originals kept as `it.on` / `o.on` — send originals/IDs to Square, never display strings.
- Short codes kept as-is: QD, CB, ET, GQT, QA, TD, XL, BBQ. Units stay lowercase (2oz, 32oz); Spanish/English small words stay lowercase mid-name (de, del, y, on, x). Stray `***` stripped.
- Category tabs already use the curated CN map. Search matches original + display name + description.


## Language select → mic on instantly (Alexa-style)
- Tapping ES/EN in the header (`pickLang`) applies the language and immediately goes to **listening** (halo + capsule green, mic live). Soft opener shows in the chosen language, then Elvi listens. No second tap on Hablar/mic.
- No mock "allow microphone?" gate anywhere in the design.
- Tech Developer: request real browser mic permission **once, early** (first Hablar tap / first visit gesture) and keep the stream/grant so a language switch never waits on a prompt. If denied, fall back silently to tap/search ordering.
- Silent fluid-sentence lang detect still uses `setLang` only (no mic restart).

## Wake phrases (Alexa-style) — v3h
- Saying **Hola Elvi / Hello Elvi / Sí Elvi** (or similar) starts listening instantly: green halo + capsule, soft opener, no language pick, no mic tap, no permission dialog.
- Recognized (case/accents flexible, "elvi/elvy/elvie"): ES → hola, sí/si, oye, ola, buenas, ey + Elvi. EN → hello, hi, hey, yo + Elvi. "ok/okay Elvi" and bare "Elvi" (only when said alone) keep current language.
- Language from the wake when clear (hola/sí/oye → ES; hello/hi/hey → EN), switched silently. Then the next **fluid sentence** (the order) refines language as before; short words never switch.
- Opener: ES "Dime qué te gustaría, yo te puedo ayudar" / EN "Just tell me what you’d like — I can help you".
- **Mic permission once early** (first visit/onboarding) so wake and language never wait on a prompt.
- Product intent: always-on wake listening even when the Hablar capsule is idle. Tech note: browsers can't listen in a background tab or with the screen off, and need one granted permission + a user gesture first; on web/PWA, keep a foreground local wake-word listener (e.g. Porcupine/Web Speech on-device) only while the page is visible; true always-on needs a native app or kiosk.
- Mock: demo buttons 🎤 “Hola Elvi”, 🎤 “Hello Elvi”, 🎤 “Sí Elvi” + orden (wake → listening → burrito order). JS: `detectWake(text)`, `onWake(text, follow)`.

- Talk button (#mic + Elvi panel): soft glowing ring, no 🎤. Idle soft blue breathe; listening green gentle pulse; speaking amber; thinking violet. While live, a faint red outer ring means tap to stop. State follows setHalo().


## Elegant icons + Elvi follows every step (v3j — Carlos 10/24)
- **No emoji chrome.** Menu toggle, search, cart bar, Popular badge, time-window tab mark, store banners, cart schedule chip, and demo clock use small SVG/CSS icons in brand blue/green. Soft ring talk button stays (no 🎤). Hablar capsule = text + tiny 3D Elvi. Close (✕) and DOBLE ✓ stay as simple marks.
- **Tiny 3D glowing Elvi** (`.e3d`): CSS sphere with specular highlight + soft glow + state colors. Sizes: 42px (Elvi bar / panel), 36px (sheet), 26px (Hablar capsule), 22px (Menú|Elvi toggle). Tappable → `voiceDemo()` same as wake/mic. States follow `setHalo` (idle blue, listening green pulse, thinking violet, speaking amber, error red). Abstract orb — not a food photo.
- **Elvi accompanies every step** (tap and voice share `#esay` / sheet line):
  - Browse idle → soft opener
  - Category tab tap → “Mira [categoría] — ¿qué se te antoja?”
  - Search → “Encontré N opciones para “q”” / no-match help
  - Simple add → “Agregué X. ¿Algo más?”
  - Sheet open → ask first missing required group
  - Option tap → “X, perfecto” then next ask (or complete)
  - DOBLE bar (burrito fillings; Square DOUBLE* siblings hidden as tiles) → one soft “¿Lo quieres doble?”; tile keeps DOBLE ✓ tag
  - Cart open / sheet close with items → “Tu orden va así — ¿pagamos o agregamos algo?”
  - Scheduled/closed copy unchanged
- Silent lang detect, wake words, pickLang→mic-on, title case, name+description search preserved.

## Barge-in / soft ring / Hablar capsule (v3k — Elvi vs Dessa)

Full-duplex yield so Elvi never traps the customer like Lou’s blank overlay.

### States (production-shaped)
Soft ring (`#mic`), Hablar capsule (`#loucap`), and tiny `.e3d` Elvi all share `setHalo` / `HSTATE`:
| State | Color | Behavior |
|---|---|---|
| idle | `#4aa3ff` | soft breathe |
| listening | `#2fd47a` | pulse; faint red outer ring on mic = tap to stop |
| thinking | `#b38cff` | hold |
| speaking | `#ffb238` | speak animation; **barge-in armed** |
| error | `#ff5a5a` | solid |

Tap targets ≥44px (mic 46px; Hablar capsule min-height 44; e3d bar/panel ≥44). Hablar **hidden in Elvi view**. Menu stays browsable under voice — never a blank Lou lockout.

### Barge-in behavior
While Elvi is **speaking** (`HSTATE==='speaking'` / `SPEAKING`):
- Customer can interrupt by: tap soft ring, tap Hablar capsule, tap any tappable `.e3d`, **long-press (~480ms) soft ring**, wake phrase, or mock **Barge-in** demo.
- Instant yield: cut speak timers/animation → **listening** (green), mic `live`, line *“Te escucho — dime.”* / *“I'm listening — go ahead.”* No second mic permission prompt.
- Wake during speaking also yields (same as barge-in then listen).
- Tech: cancel TTS / duplex outbound audio on barge; keep inbound stream; no re-prompt for mic (permission once early).

### Mock demos
- Button **Barge-in** → `bargeDemo()`: force speaking line ~800ms → `bargeIn('demo')`.
- Long-press soft ring while speaking → `bargeIn('hold')`.
- JS: `talkOrBarge()`, `bargeIn(why)`, `bargeDemo()`, `micPress`/`micRelease`.

## Confirm beat before Square + Para la cocina ✓ (v3k)

Before any Square charge, cart **Continuar** opens a **confirm sheet** (not direct checkout):

1. Visual receipt: photo thumbs + display title-case name + mods + line prices + subtotal.
2. Elvi speaks short confirm: ES *“Así quedó: … ¿Cobramos?”* / EN *“Here's your order: … Ready to pay?”* (speaking state; barge-in / “cambia el…” armed).
3. **Para la cocina ✓** block: dark kitchen strip, monospace preview of ticket language — `Qx ORIGINAL_NAME` + `+` mod originals (`it.on` / `o.on`), not display title-case.
4. Primary **Así está · Pagar** / **Looks good · Pay** → `paySquare()` (mock → Square Checkout or cash-at-pickup flag).
5. Secondary **Corregir** / **Fix it** → back to cart sheet, Elvi listening *“Claro — ¿qué cambiamos?”* — no shame, easy repair.
6. Voice note for Tech: during confirm, barge-in or phrases like *“cambia el …”* / *“change the …”* → yield to listening and open cart/sheet for edit; do not charge until primary confirm.

### Pay choice — card first; cash = ES backup only (Carlos refine, locked)
- **Encourage card for BOTH languages.** Card is always the default/highlighted hero.
- **`lang=ES`**: primary **`Tarjeta o en línea`** (selected by default; hint *Rápido y listo — lo más fácil*). Secondary softer **`Efectivo al recoger`** (backup only; hint *También está bien si prefieres pagar allá* — no shame).
- **`lang=EN`**: **card/online only** — no cash option.
- Soft Spanish-first: cash available for ES without making it the hero; never offer cash on EN.
- Phone ordering: Tech mirrors the same rule (nudge card; cash backup on Spanish calls only).
- `paySquare()` passes `mode: 'cash'|'card'`; cash = ticket to kitchen + pay-at-pickup; card = Square Checkout.

Mock: demo button **Confirm** → `demoConfirm()` seeds a burrito (+ drink) and opens the confirm sheet.

## 2e. Soft Hablar lang gate + soft-bounce invite (Carlos 10/24 — m27; supersedes §2d sheet visuals)
- Hablar capsule idle: label + soft invite line **“Yo te puedo ayudar” / “I can help you”**; gentle **soft-bounce** (≈4px, 2.6s loop, `.loucap.invite`) as the speak invite. Bounce stops while gating/listening.
- Gate only when `LANG_KNOWN=false` after Hablar tap (skip if wake/fluid sentence/header/prior pick). **No sheet, no scrim**, menu stays visible.
- Gate = quiet floating segmented **ES | EN** pills right above the capsule (dark glass, 1px #4aa3ff ring, soft pulse halo; small “¿Español o English?” caption). No chunky “ES · Español / EN · English” blocks, no gradient mic orb.
- During gate the Elvi bar / chat dock / “Type your order…” are hidden (`.bottom.gating`) so nothing covers the menu.
- **Selected pill** fills brand gradient #4aa3ff→#1471d6 white text + glow (`.sl-pill.on`), ~450ms, then gate closes → mic on.
- Selected language applies to **everything**: Elvi voice + bubbles, menu chrome, Hablar capsule, item sheet, cart (`setLang`, all `[data-t]`).
- Header **ES/EN stays available anytime** to switch; switching flips all chrome + Elvi immediately (no re-gate).
- Shot: `shots/m27-hablar-soft-lang.png` (EN just selected).

## 2f. Rotating blue hue on Hablar capsule + Hablar over item sheet (Carlos 10/25 — m28)
- Capsule gets a thin **rotating blue hue orbit** (`.loucap .orbit`): conic-gradient ring #1471d6 → #4aa3ff → soft white glint, masked to a 1.5px ring + blurred 45% glow; **continuous 5.5s linear orbit** (`@property --capang`, `@keyframes capOrbit`). Soft/premium — no rainbow, no fast spin.
- Idle = full orbit; listening/thinking/speaking dim it (opacity .25, 9s) so state color leads. `prefers-reduced-motion` → static ring.
- Keeps `.loucap.invite` soft-bounce + “Yo te puedo ayudar / I can help you” line.
- **Hablar stays visible/tappable over item sheet & cart** (`body:has(.sheet.show) .bottom` / `.sheet-open` / `v3-sheet-on` z-index 62) so mic can be granted mid-flow without going back to start.
- Shot: `shots/m28-hablar-rotate-hue.png` (still; rotation is animated live).

## 2g. Sheet-context Elvi + condensed Siri-style halo while listening (Carlos 10/25 — m29)
**Sheet-context rule (hard):** If Hablar is activated while an item sheet is open, Elvi is *building that item*. Her context = open item name + every option on the sheet (`ELVI_CTX {item, options, step}`) + current selections. She must **never** say an option is missing/not on the menu if it is visible on the open sheet (e.g. Quesadilla Dorada **Deluxe Preparada**). Unknown/ambiguous phrase → map against sheet options first, then menu, then ask a clarifying question — never a denial.
- Opener = current item + next unfinished required step: ES “Estamos armando tu Quesadilla Dorada. ¿Te gustaría Regular o Deluxe Preparada?” / EN “We're building your Quesadilla Dorada. Would you like Regular or Deluxe Preparada?”
- **Activated Hablar capsule:** idle = full label + invite + orbit. listening/thinking → collapse to **52px** orb+orbit only (orbit opacity .9, 3.2s); ~280ms transition. Barge-in while speaking → “Te escucho — dime.”; after settle with sheet open → item opener.
- Shot: `shots/m29-sheet-context-condensed-halo.png`

## 2h. Complete-item handoff — Elvi finishes the sheet, adds, returns to menu home (Carlos 10/25 — m30)
**Problem:** voice order on an open sheet added correctly but left the customer on the customize sheet.
**Flow (hard):** (1) Elvi drives sheet picks in required order with `.elvi-pick` highlight (~650ms). (2) Speak “Ok, agregando tu {item} al carrito.” / “Ok, adding this to your cart.” (3) Add → close sheet → scroll menu home → cart bump. (4) “Listo, agregué tu {item}. Ya tienes {n} en tu orden — ¿qué más se te antoja?” Never leave customer on customize sheet after voice complete.
- Shot: `shots/m30-post-add-menu-home.png`
