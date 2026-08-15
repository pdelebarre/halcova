# Phase 0 Survey — "One home, two rooms" (per-kind theming)

**Owner:** Marketing Manager · **Status:** Draft for review · **Date:** 2026-08-15
**Ref:** `analysis-theme-per-collection.md` (Phase 0 gate), `private-test-plan.md` (§6 feedback form), `localization-dictionary.md`
**Purpose:** Decide whether Records and Books should get distinct "rooms" (look) inside one app — and if so, which book accent wins while staying cohesive.
**Who answers:** the existing private-test circle — native speakers of FR · NL · PT-BR · DE · ES · IT (+ EN).
**Length:** ~3 minutes. No code, no branch — survey only.

---

## 1. What this survey must answer (mapped to the analysis gates)

| # | Question | Business decision it feeds |
| --- | --- | --- |
| A | Do users *want* distinct rooms per kind? | Go / no-go on the whole idea |
| B | Which book-room accent reads best? | Palette choice for the UI/UX Expert |
| C | Does the chosen look still feel like the *same app*? | The "one home" cohesion constraint |
| D | When should it ship? | Phasing (launch vs later) |

---

## 2. How to run it

1. **When:** after testers have already used **both** tabs in the main test
   (day 3+), so the questions are grounded in real usage — not abstract.
2. **Where:** as a second short section appended to the existing feedback form
   (`private-test-plan.md` §6), or a standalone form; one link per tester, one
   code per tester, results tagged by language.
3. **Assets needed first:** 4 mockups (see §5) from the UI/UX Expert — the
   survey is **not** launchable until the mockups exist.
4. **Length:** ~3 minutes; keep Section A minimal (2 questions) if testers are
   tired of forms.
5. **Consent/neutrality:** never say which accent "Marketing prefers"; present
   options neutrally as A / B / C / D.

---

## 3. Survey content — EN master + 7-language drafts

### Section A — Do you want rooms at all? (no visuals needed)

**A1. Would you like the Records and Books tabs to each have their own distinct look — a "records room" and a "books room"?**

| EN | FR | NL | PT-BR | DE | ES | IT |
| --- | --- | --- | --- | --- | --- | --- |
| Aimeriez-vous que les onglets Disques et Livres aient chacun leur propre allure — une « pièce disques » et une « pièce livres » ? | Zou je willen dat het tabblad Platen en het tabblad Boeken er elk anders uitzien — een 'platenkamer' en een 'boekenkamer'? | Você gostaria que as abas Discos e Livros tivessem cada uma sua própria aparência — um 'quarto de discos' e um 'quarto de livros'? | Möchtest du, dass die Tabs Platten und Bücher jeweils einen eigenen Look bekommen — einen ‚Plattenraum' und einen ‚Bücherraum'? | ¿Te gustaría que las pestañas Discos y Libros tuvieran cada una su propio aspecto — una 'habitación de discos' y una 'habitación de libros'? | Ti piacerebbe che le schede Dischi e Libri avessero ciascuna il proprio aspetto — una 'stanza dei dischi' e una 'stanza dei libri'? |

Options (scale — pick one): **Love it · Nice idea · Don't care · Prefer identical**

| EN | FR | NL | PT-BR | DE | ES | IT |
| --- | --- | --- | --- | --- | --- | --- |
| Love it | J'adore | Geweldig | Adorei | Super | Me encanta | Mi piace molto |
| Nice idea | Bonne idée | Goed idee | Boa ideia | Gute Idee | Buena idea | Buona idea |
| Don't care | Peu importe | Maakt niet uit | Tanto faz | Egal | Me da igual | Non mi interessa |
| Prefer identical | Je préfère identiques | Liever identiek | Prefiro iguais | Lieber identisch | Prefiero iguales | Preferisco identici |

**A2 (activation hypothesis). If the two tabs looked different, would you be more likely to explore the one you use less?**

| EN | FR | NL | PT-BR | DE | ES | IT |
| --- | --- | --- | --- | --- | --- | --- |
| If the two tabs looked different, would you be more likely to explore the one you use less? | Si les deux onglets étaient visuellement différents, seriez-vous plus tenté d'explorer celui que vous utilisez le moins ? | Als de twee tabbladen er anders uitzagen, zou je dan eerder het tabblad verkennen dat je minder gebruikt? | Se as duas abas tivessem aparências diferentes, você exploraria mais a que menos usa? | Wenn die beiden Tabs unterschiedlich aussehen, würdest du dann eher den Tab erkunden, den du seltener nutzt? | Si las dos pestañas se vieran diferentes, ¿explorarías más la que menos usas? | Se le due schede avessero un aspetto diverso, esploreresti di più quella che usi meno? |

Options: **Yes · No · Not sure** → Oui/Non/Pas sûr · Ja/Nee/Weet niet · Sim/Não/Não sei · Ja/Nein/Weiß nicht · Sí/No/No sé · Sì/No/Non so.

**A3 (cohesion priority). How important is it that both tabs still clearly feel like the same app?**

| EN | FR | NL | PT-BR | DE | ES | IT |
| --- | --- | --- | --- | --- | --- | --- |
| How important is it that both tabs still clearly feel like the same app? | À quel point est-il important que les deux onglets restent clairement le même produit ? | Hoe belangrijk is het dat beide tabbladen nog duidelijk hetzelfde product voelen? | Qual a importância de as duas abas ainda parecerem claramente o mesmo aplicativo? | Wie wichtig ist es, dass sich beide Tabs weiterhin klar wie dasselbe Produkt anfühlen? | ¿Qué importancia tiene que ambas pestañas sigan sintiéndose claramente como la misma app? | Quanto è importante che entrambe le schede continuino a sembrare chiaramente la stessa app? |

Options: **Very · Somewhat · Doesn't matter** → Très/Pas mal/Peu importe · Heel belangrijk/Redelijk/Niet belangrijk · Muito/Um pouco/Não importa · Sehr/Ziemlich/Egal · Mucho/Un poco/No importa · Molto/Abbastanza/Non importa.

### Section B — Which book-room accent? (requires the 4 mockups, §5)

Show the four mockups in a fixed order (A→D). Ask:

**B1. Which book-room look do you like most? (pick one)**

| Label | Direction (internal) |
| --- | --- |
| **A — Warm amber** | closest to gold → most cohesive, least different |
| **B — Reading-room green** | distinct hue → clearest "second room" |
| **C — Oxblood / wine red** | bookish/classic, but may clash with the "already own" red |
| **D — Keep gold (no change)** | status quo |

**B2. Does the look you chose still feel like the same app as the records room?**

| EN | FR | NL | PT-BR | DE | ES | IT |
| --- | --- | --- | --- | --- | --- | --- |
| Does the look you chose still feel like the same app as the records room? | L'apparence que vous avez choisie ressemble-t-elle toujours au même produit que la pièce disques ? | Voelt de look die je koos nog steeds als hetzelfde product als de platenkamer? | A aparência escolhida ainda parece o mesmo app da sala de discos? | Fühlt sich der gewählte Look noch wie dasselbe Produkt wie der Plattenraum an? | ¿El aspecto elegido sigue sintiéndose como la misma app que la sala de discos? | L'aspetto scelto sembra ancora la stessa app della stanza dei dischi? |

Options: **Definitely · Mostly · Not really** → Tout à fait/À peu près/Pas vraiment · Zeker/Grotendeels/Niet echt · Com certeza/Mais ou menos/Não muito · Ja definitiv/Größtenteils/Nicht wirklich · Definitivamente/Más o menos/No mucho · Sì di sicuro/Più o meno/Non proprio.

**B3. Pick the word that best describes the book look you chose.**

| EN | FR | NL | PT-BR | DE | ES | IT |
| --- | --- | --- | --- | --- | --- | --- |
| Cosy | Cosy | Gezellig | Aconchegante | Gemütlich | Acogedor | Accogliente |
| Calm | Calme | Rustig | Calmo | Ruhig | Tranquilo | Calmo |
| Classic | Classique | Klassiek | Clássico | Klassisch | Clásico | Classico |
| Library | Bibliothèque | Bibliotheek | Biblioteca | Bibliothek | Biblioteca | Biblioteca |
| Modern | Moderne | Modern | Moderno | Modern | Moderno | Moderno |
| Other | Autre | Anders | Outro | Anderes | Otro | Altro |

### Section C — Same-app perception (cohesion test)

**C1. Imagine switching from Records to Books and the look changing. Would you still feel you're in the same app?**

| EN | FR | NL | PT-BR | DE | ES | IT |
| --- | --- | --- | --- | --- | --- | --- |
| Imagine switching from Records to Books and the look changes. Would you still feel you're in the same app? | Imaginez passer de Disques à Livres et voir le style changer. Auriez-vous toujours l'impression d'être dans le même produit ? | Stel je voor dat je overschakelt van Platen naar Boeken en de look verandert. Zou je nog steeds het gevoel hebben dat je in dezelfde app zit? | Imagine passar de Discos para Livros e a aparência mudar. Você ainda sentiria que está no mesmo app? | Stell dir vor, du wechselst von Platten zu Büchern und der Look ändert sich. Hättest du noch das Gefühl, in derselben App zu sein? | Imagina pasar de Discos a Libros y que el aspecto cambie. ¿Seguirías sintiendo que estás en la misma app? | Immagina di passare da Dischi a Libri e vedere cambiare l'aspetto. Sentiresti ancora di essere nella stessa app? |

Options: **Definitely · Mostly · Not really** (same scale as B2).

**C2. What would make it feel like the same app? (tick all that apply)**

| EN | FR | NL | PT-BR | DE | ES | IT |
| --- | --- | --- | --- | --- | --- | --- |
| Same logo & name | Même logo et nom | Zelfde logo en naam | Mesmo logo e nome | Gleiches Logo und Name | Mismo logo y nombre | Stesso logo e nome |
| Same dark background | Même fond sombre | Zelfde donkere achtergrond | Mesmo fundo escuro | Gleicher dunkler Hintergrund | Mismo fondo oscuro | Stesso sfondo scuro |
| Same buttons & layout | Mêmes boutons et mise en page | Zelfde knoppen en indeling | Mesmos botões e layout | Gleiche Buttons und Layout | Mismos botones y diseño | Stessi pulsanti e layout |
| Gold stays somewhere | L'or reste présent | Goud blijft ergens | O dourado continua em algum lugar | Gold bleibt irgendwo sichtbar | El dorado sigue presente | L'oro resta presente |
| Same scan flow | Même geste de scan | Zelfde scan-flow | Mesmo fluxo de escaneamento | Gleicher Scan-Ablauf | Mismo flujo de escaneo | Stesso flusso di scansione |
| Other | Autre | Anders | Outro | Anderes | Otro | Altro |

### Section D — Phasing & open feedback

**D1. Would you want the two looks at launch, or later?**

Options: **At launch · Later is fine · Never** → Dès le lancement/Plus tard c'est bien/Jamais · Bij de lancering/Later is prima/Nooit · No lançamento/Depois está bem/Nunca · Zum Start/Später ist okay/Nie · En el lanzamiento/Más tarde está bien/Nunca · Al lancio/Più tardi va bene/Mai.

**D2. Anything else about having two looks in one app? (free text)**

| EN | FR | NL | PT-BR | DE | ES | IT |
| --- | --- | --- | --- | --- | --- | --- |
| Anything else about having two looks in one app? | Autre chose à propos de deux styles dans un même produit ? | Nog iets over twee looks in één app? | Mais alguma coisa sobre dois estilos no mesmo app? | Noch etwas zu zwei Looks in einer App? | ¿Algo más sobre tener dos estilos en una misma app? | Qualcos'altro su due stili nella stessa app? |

---

## 4. Scoring & go / no-go (thresholds are proposals `[VALIDATE]`)

Run per language, then aggregate. **Go** for the books room when:

| Gate | Question | Pass if |
| --- | --- | --- |
| Desirability | A1 | "Love it" + "Nice idea" ≥ 70% (and "Prefer identical" < 30%) |
| Activation (directional) | A2 | "Yes" ≥ 50% |
| Cohesion priority | A3 | "Very" ≥ 50% (confirms the constraint matters) |
| Accent winner | B1 | a single option (A/B/C) wins by plurality **and** ≥ 50% overall |
| Cohesion of winner | B2 | "Definitely" + "Mostly" ≥ 80% for the winner |
| Same-app perception | C1 | "Definitely" + "Mostly" ≥ 80% |
| Phasing | D1 | no majority for "Never" |

**Fallback rules:**
- If B1 winners tie, break by B2 cohesion (pick the more cohesive).
- If every accent fails B2 (cohesion), **stay with Option D (keep gold / status quo)** and revisit later — this is a legitimate outcome, not a failure.
- If A1 shows most people "don't care," treat theming as low-priority polish, not a launch feature.

---

## 5. Mockup spec for the UI/UX Expert (needed before the survey ships)

**Delivered — see `marketing/mockups/theme-rooms/` (SVG + PNG; regenerate with `node marketing/mockups/theme-rooms/generate.mjs`).** Same screen, same layout; only the accent/ambience differs across A–D, plus one records reference in gold:

- **Screen:** the Books tab in a realistic state — the **book grid** (2-col × 2-row at true app scale, showing the active-room feel) + one row of **category chips** (Fiction active) + header/toolbar/tagline/red Scan FAB.
- **The four variants + reference:**
  - **A — Warm amber** (`#D9A441`)
  - **B — Reading-room green** (`#7FA98C`)
  - **C — Oxblood / wine red** (`#B05750` + text `#CB7C70` — two-tone, see contrast note)
  - **D — Keep gold** (current `#C9A227` — the control)
  - **REF — Records tab in current gold** (the reference for B2)
- **Contrast gate (verified):** gold 7.65:1, amber 8.23:1, green 7.02:1, oxblood UI 3.81:1 (≥3:1 only) + oxblood text 5.87:1 (≥4.5:1). Full table in the mockups README.
- **Neutrality:** images carry no survey copy; the A/B/C/D/REF letters are small identifiers (bottom-left), not UI.
- **File format:** PNG at 2× (750×1840, from a 375×920 tall phone capture — realistic scroll view; the grid continues below the fold in the app). SVG also shipped for editing. Crop/ratio adjustments for the survey tool are fine.

---

## 6. Open items `[VALIDATE]`

1. Thresholds in §4 are proposals — Marketing + product owner to confirm before launch.
2. All FR/NL/PT-BR/DE/ES/IT drafts need a **native-speaker polish pass** (same as `localization-dictionary.md`).
3. Mockups must exist before the survey ships (UI/UX Expert dependency).
4. Confirm the survey tool/channel (append to existing form vs standalone) with the site owner.
5. B3 "Oxblood" vocabulary per language (e.g. NL "wijnrood", DE "weinrot") — check tone with natives.

---

## 7. Next steps

1. Approve this draft (and thresholds).
2. Hand §5 to the **UI/UX Expert** → mockups.
3. Marketing prepares the form + per-language copies; reuses the private-test roster.
4. Run it, score per §4, then update `analysis-theme-per-collection.md` with Phase 0 results before any implementation branch.
