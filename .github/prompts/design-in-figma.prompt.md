---
description: "Design, iterate, or implement Runout UI with Figma (via the Figma MCP): create a mockup/prototype for a screen or flow, turn a Figma design into React code (design-to-code), sync the running app into Figma (code-to-design), or map Figma components to code (Code Connect). Uses the app's real design tokens. Triggers: 'design in figma', 'make a mockup', 'prototype', 'redesign the scan flow', 'figma design', 'design to code', 'sync to figma', 'figma component'."
name: "Design in Figma"
argument-hint: "What to design or sync (e.g. 'a new scan flow', 'the auth screen')?"
agent: "UI UX Expert"
---
Design or sync Runout UI using the `figma-design` skill (read `SKILL.md` and
`references/design-tokens.md`) and the Figma MCP.

## Scope
- If a Figma URL/file is given: extract `fileKey` + `nodeId` and follow
  design-to-code (`get_design_context` → implement) or review the design
  against Runout's tokens and components.
- If the user wants a new mockup: reuse the design system
  (`search_design_system` / `get_libraries`) first, then create or assemble in
  Figma (`create_new_file`, `use_figma`, and `generate_figma_design` from the
  running app).
- Optionally map Figma components to React components (Code Connect,
  `add_code_connect_map`).

## Deliverables
- The Figma file/node (or the implemented React change for design-to-code).
- A short note on how the result maps to the design tokens
  (`references/design-tokens.md`) and the existing components.
- For implemented changes: verify with `npm run lint` and `npm test`, and view
  the result in the browser at a phone viewport.
