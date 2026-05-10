# Cocina Elvis Voice Ordering

Bilingual voice-first ordering stack with a browser avatar experience, realtime orchestration backend, Square POS sync, and hosted Square checkout.

## What is included

- `apps/mobile`: Expo React Native app for iOS and Android store builds.
- `apps/web`: Browser single-page app for Elena avatar + realtime voice streaming.
- `services/api`: Node/Express API with realtime websocket orchestration + Square integration.
- English and Spanish conversation flow with Elvi AI actions.
- Pickup and delivery fulfillment support.
- Full Square Catalog menu sync from credentials, with local fallback menu for development.
- NVIDIA API integration for conversation understanding and optional Riva/Audio2Face hooks.
- Multi-tenant support so the same codebase can onboard multiple restaurants.

## Quick Start

```bash
npm install
cp services/api/.env.example services/api/.env
cp apps/mobile/.env.example apps/mobile/.env
npm run dev:api
npm run dev:mobile
```

Set `EXPO_PUBLIC_API_BASE_URL` in `apps/mobile/.env` to the API URL reachable by your phone. For a physical device, use your computer's LAN IP instead of `localhost`.

For the browser app, open `http://localhost:4000` after `npm run dev:api`.

## Square Setup

Create a Square application in the Square Developer Console, then add these values to `services/api/.env`:

- `SQUARE_ENV=sandbox` for testing or `production` for live orders.
- `SQUARE_ACCESS_TOKEN`
- `SQUARE_LOCATION_ID`
- `SQUARE_API_VERSION`
- `NVIDIA_API_KEY`
- `NVIDIA_MODEL` (default: `meta/llama-3.1-70b-instruct`)
- `NVIDIA_BASE_URL` (default: `https://integrate.api.nvidia.com/v1`)
- `NVIDIA_RIVA_ASR_URL` (optional)
- `NVIDIA_RIVA_TTS_URL` (optional)
- `NVIDIA_AUDIO2FACE_URL` (optional)
- `TENANTS_JSON` (optional multi-tenant array)

The API uses Square Catalog, Orders API, and Online Checkout payment links. When valid Square credentials are present, `/api/menu` is built from your Square catalog items and variations. Orders include line items and either `PICKUP` or `DELIVERY` fulfillment details so paid orders appear in Square order management.

The Elvi endpoint (`POST /api/elvi/chat` or `POST /api/:tenant/elvi/chat`) sends bilingual transcript text to NVIDIA models and returns:

- a natural language reply in English or Spanish
- structured actions (`add_item`, `set_fulfillment`, `set_address`, `set_customer`, `checkout`)
- model engine metadata (`nvidia` or local fallback)

Relevant Square docs:

- [Orders API](https://developer.squareup.com/docs/orders-api/what-it-does)
- [Catalog API](https://developer.squareup.com/reference/square/catalog-api)
- [Payments API](https://developer.squareup.com/docs/payments-refunds)
- [Mobile Payments SDK React Native plugin](https://developer.squareup.com/docs/mobile-payments-sdk/react-native)

## Voice Commands

Examples:

- "I want two pollo bowls for delivery."
- "Pickup, add one empanada."
- "Quiero tres tacos de carne para recoger."
- "Entrega a 123 Main Street."
- "Checkout" or "Pagar."

The mobile app sends each typed/voice transcript to Elvi. Elvi then updates cart, customer details, fulfillment, and can trigger checkout automatically.

## API Endpoints

- `GET /health`
- `GET /api/tenants`
- `GET /api/menu`
- `GET /api/:tenant/menu`
- `POST /api/elvi/chat`
- `POST /api/:tenant/elvi/chat`
- `POST /api/orders/checkout`
- `POST /api/:tenant/orders/checkout`
- `POST /api/realtime/session`
- `POST /api/:tenant/realtime/session`
- `WS /api/realtime?sessionId=...`
- `POST /api/square/webhooks`

## Realtime Pipeline

1. Browser records microphone chunks and streams them over websocket.
2. Backend sends chunks to Riva ASR when configured.
3. Transcript goes to Elvi (Nemotron-compatible chat endpoint).
4. Reply text optionally goes to Riva TTS.
5. Reply text + audio optionally go to Audio2Face for visemes.
6. Browser receives reply, audio, and visemes for synchronized playback.

When Riva or Audio2Face URLs are not configured, the backend automatically falls back to text handling, browser speech synthesis, and deterministic viseme generation.

## Multi-Tenant Model

- Each tenant has a `slug`, branding, Square credentials, and NVIDIA settings.
- The default tenant uses existing `.env` values so current Cocina Elvis behavior still works.
- To onboard additional restaurants, set `TENANTS_JSON` with multiple tenant objects.
- Tenant routes use `/api/:tenant/...`; default routes keep backwards compatibility.

## Run Locally

1. Install dependencies:

```bash
npm install
```

2. Configure environments:

```bash
cp services/api/.env.example services/api/.env
cp apps/mobile/.env.example apps/mobile/.env
```

3. Start backend API:

```bash
npm run dev:api
```

4. Start mobile app:

```bash
npm run dev:mobile
```

5. For real device testing, set `EXPO_PUBLIC_API_BASE_URL` to your Mac LAN IP, for example:

```bash
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.25:4000
```

## Deployment Path

1. Deploy `services/api` to Render, Railway, Fly.io, Vercel (Node runtime), or AWS.
2. Set production Square and NVIDIA secrets on that host.
3. Set `APP_PUBLIC_URL` to the deployed domain (same host serves `apps/web`).
4. Configure DNS/subdomains per tenant and map hostnames in `TENANTS_JSON`.
5. Update `apps/mobile/.env` with production API URL.
6. Build mobile binaries with EAS and submit.

## App Store Notes

The app uses microphone and speech recognition permissions. Before submission, update the iOS bundle id, Android package id, privacy copy, app icons, splash screen, and Square production credentials. For fully native in-app card entry later, integrate Square's Mobile Payments SDK React Native plugin and submit the required iOS and Android application signatures in Square's Developer Console.

Build commands after installing EAS CLI:

```bash
cd apps/mobile
eas build --platform ios --profile production
eas build --platform android --profile production
eas submit --platform ios --profile production
eas submit --platform android --profile production
```
