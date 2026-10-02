# Madmuaziel Niks

`artifacts/nyx-dnd-site` is the single maintained frontend. It contains the public site, calendar, catalog, master cabinet, and Telegram Mini App. The old unconnected `nyx-dnd-site` copy has been consolidated into this production source.

Build and deployment details are in [cloudflare/PAGES_SETUP.md](cloudflare/PAGES_SETUP.md). Pages requires the runtime `API_ORIGIN` variable; Plausible analytics is enabled by the optional build variable `VITE_PLAUSIBLE_DOMAIN`.

The local image conversion helper is `node scripts/optimize-site-assets.mjs`. It writes optimized WebP variants from source artwork kept outside the deployed `public` directory.
