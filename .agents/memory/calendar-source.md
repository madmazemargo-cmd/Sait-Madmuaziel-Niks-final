---
name: Live calendar source
description: The public calendar and application flow are backed by the master-managed Cloudflare calendar.
---

The master-managed Cloudflare calendar is the source of truth for published game occurrences and applications. The public site should proxy it through the API server with no-store freshness and must not fall back to hardcoded dates.

**Why:** Monthly edits, recurring occurrences, exclusions, seats, prices, and application revisions need to appear publicly without manual copying or stale static data.

**How to apply:** Keep the calendar proxy and application proxy contract-first; render only current, non-administrative occurrences and preserve the selected event date/revision through the application flow.