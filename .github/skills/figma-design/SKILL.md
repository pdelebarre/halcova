---
name: figma-design
description: "Design and sync Runout UI with Figma (via the Figma MCP): design-to-code (get_design_context → implement in React), code-to-design (generate_figma_design + use_figma to push the running app into Figma), reuse the existing design system/tokens (search_design_system, get_libraries), and map Figma components to code with Code Connect. Design tokens come from src/index.css. Triggers: 'Figma', 'design', 'mockup', 'prototype', 'redesign', 'design system', 'design to code', 'code connect', 'UI design', 'sync to figma'."
---
# Figma Design for Runout

How to design and sync Runout's UI with Figma using the Figma MCP.

## When to Use
- The user wants a mockup / prototype of a screen or flow.
- Implement a Figma design into the React app (design-to-code).
- Push the running app's UI into Figma to iterate on it (code-to-design).
- Keep Figma components mapped to code (Code Connect).

## Design System (use it, don't invent it)
The source of truth is `src/index.css` — see
[references/design-tokens.md](./references/design-tokens.md). Key tokens:
`--sleeve-black #16130F` (background), `--jacket-kraft #EFE6D8` (text),
`--label-red #B23A2E` (primary), `--runout-gold #C9A227` (focus), Fraunces
(display) + Inter (body) + IBM Plex Mono (labels), radii 6/10/16, and
safe-area insets.

## Workflows (with the Figma MCP)
1. **Design-to-code**: load the `/figma-design-to-code` skill, call
   `get_design_context` with the `nodeId` + `fileKey` (extract from the
   figma.com URL), adapt the reference to Runout's components and tokens, and
   implement following `copilot-instructions.md` conventions.
2. **Code-to-design**: load `/figma-generate-design`; call
   `search_design_system` first to find reusable components/tokens; run the
   app and use `generate_figma_design` (pixel screenshot) + `use_figma` to
   build the screen from design-system components; drop the screenshot
   reference when done.
3. **Component mapping**: load `/figma-code-connect`; use
   `add_code_connect_map` to link a Figma node to a React component (e.g.
   `AlbumCard`, `Toolbar`, `ScanResult`, `ScannerModal`).

## Conventions
- Match the real tokens — never silently redesign the theme; flag any token
  change explicitly.
- Ergonomics feeds design: run the `ergonomics-review` checklist before
  finalizing a screen.
- A design is a deliverable (Figma file/node or spec); implementation is
  delegated to the Front End Developer / Runout Engineer.

## Verification
- Confirm the Figma output uses Runout's tokens and the app's component
  structure.
- For design-to-code: run `npm run lint` and `npm test`, then view the result
  in the browser at a phone viewport.
