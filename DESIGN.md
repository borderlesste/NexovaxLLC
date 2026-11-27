---
version: alpha
name: NexovaX Marketplace
description: A storefront and member workspace with blue actions, orange brand accents, and white cards.
colors:
  primary: "#0a6cf5"
  navy: "#0b2450"
  accent: "#f5901a"
  background: "#f6f8fc"
  ink: "#0f172a"
  muted: "#5f6b7d"
  line: "#e3e8f0"
typography:
  sans:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
rounded:
  card: "14px"
omitted:
  - section: spacing
    reason: "Existing responsive Tailwind layout utilities own spacing."
---

# NexovaX design context

[The storefront theme](frontend/src/app/globals.css) owns the runtime tokens. Primary maps to `brand-600`, navy to `brand-950`, and accent to `accent-500`. Account pages use the shared input, button, dialog, skeleton, and toast components. Use the active locale for controls and feedback.

## Welcome Badge

The member portrait is the focus. Use the [official mark](frontend/public/brand/nexovax-mark@2x.png) above the portrait alongside navy `NEXOVA` and an orange `X`. Use a blue diagonal to separate the white logo area from the navy artwork. The star and domain pill use the orange accent. Navy text keeps the domain readable at small sizes.

The welcome message, identity text, and invitation to create the badge use their specified English wording. Use the same composition for the live preview and the 1200 × 1600 export. Put the preview above the form on narrow screens. Provide keyboard-operable position and zoom controls alongside dragging.
