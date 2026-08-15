# Phase 0 Survey — Execution Pack ("One home, two rooms")

**Owner:** Marketing Manager · **Status:** Ready to run · **Date:** 2026-08-15
**Refs:** `survey-theme-rooms.md` (all question strings + thresholds — single
source of truth), `mockups/theme-rooms/` (images, UI/UX Expert), `private-test-plan.md` (roster & channel).
**What this is:** the operational pack — form build, invite copy, roster,
scoring sheet, and the run plan. **All question text/options live in
`survey-theme-rooms.md` §3; this file only adds the glue.**

---

## 1. Goal (restated)

Decide whether Records and Books get distinct "rooms" (per-kind theme) inside
one app — and if yes, which book accent wins while staying cohesive. Answers
feed the gates in `analysis-theme-per-collection.md` §10 Phase 0.

---

## 2. Form build (Google Forms or Typeform — tool TBD `[VALIDATE]`)

Build one form per the structure below. Question strings = `survey-theme-rooms.md` §3 (7 languages). Media = the mockup PNGs. Keep it ~3 minutes.

| Form section | Question(s) | Type | Media |
| --- | --- | --- | --- |
| **Intro** | Intro text (§3 below) + note "~3 minutes, no wrong answers" | paragraph | — |
| **A — Rooms at all** | A1 (single choice 4 options) · A2 (Yes/No/Not sure) · A3 (Very/Somewhat/Doesn't matter) | multiple choice | — |
| **B — Which book accent** | B1 (pick one: A/B/C/D) · B2 (Definitely/Mostly/Not really) · B3 (word pick) | image + multiple choice | 4 mockups + REF |
| **C — Same app?** | C1 (Definitely/Mostly/Not really) · C2 (checkbox, all that apply) | multiple choice + checkbox | — |
| **D — Phasing & open** | D1 (At launch/Later/Never) · D2 (open text) | multiple choice + paragraph | — |
| **Thank you** | "Thanks — we'll use this to shape Halcova." | — | — |

**Media mapping (embed these PNGs):**

| Mockup file | Use for |
| --- | --- |
| `records-room-gold-reference.png` | shown as the reference ("Records today") in B1 intro |
| `books-room-A-amber.png` | B1 option A |
| `books-room-B-green.png` | B1 option B |
| `books-room-C-oxblood.png` | B1 option C |
| `books-room-D-gold.png` | B1 option D |

> Present A–D **in fixed order**, neutrally. Never say which one Marketing
> prefers. The letter labels on the images match the answer options.

---

## 3. Intro text (form intro — the only copy not already in the survey doc)

| Lang | Intro |
| --- | --- |
| **EN** | Thanks for helping shape Halcova! Two short sections about how your Records and Books tabs feel — about 3 minutes. Look at the screenshots and pick what feels right. There are no wrong answers. |
| **FR** | Merci d'aider à façonner Halcova ! Deux petites sections sur l'ambiance de vos onglets Disques et Livres — environ 3 minutes. Regardez les captures et choisissez ce qui vous parle. Il n'y a pas de bonne ou de mauvaise réponse. |
| **NL** | Bedankt om Halcova mee vorm te geven! Twee korte onderdelen over hoe je tabbladen Platen en Boeken aanvoelen — ongeveer 3 minuten. Bekijk de afbeeldingen en kies wat goed voelt. Er zijn geen foute antwoorden. |
| **PT-BR** | Obrigado por ajudar a dar forma ao Halcova! Duas seções curtas sobre como suas abas Discos e Livros parecem — cerca de 3 minutos. Olhe as imagens e escolha o que soa certo. Não há respostas erradas. |
| **DE** | Danke, dass du Halcova mitgestaltest! Zwei kurze Abschnitte dazu, wie sich deine Tabs Platten und Bücher anfühlen — etwa 3 Minuten. Schau dir die Bilder an und wähle, was sich richtig anfühlt. Es gibt keine falschen Antworten. |
| **ES** | ¡Gracias por ayudar a dar forma a Halcova! Dos secciones cortas sobre cómo se sienten tus pestañas Discos y Libros — unos 3 minutos. Mira las capturas y elige lo que te parezca bien. No hay respuestas incorrectas. |
| **IT** | Grazie per aiutare a dare forma a Halcova! Due brevi sezioni su come appaiono le schede Dischi e Libri — circa 3 minuti. Guarda le immagini e scegli ciò che ti sembra giusto. Non ci sono risposte sbagliate. |

---

## 4. Invite messages (short, per language — send after the main test, day 3+)

Placeholder `{link}` = the survey form URL. Testers already have their personal
codes from the main test — no new code needed.

| Lang | Invite |
| --- | --- |
| **EN** | Hi! You helped us test Halcova — thank you. We're deciding whether Records and Books should each get their own look (a "records room" and a "books room"). It's a 3-minute survey with 4 screenshots to compare: {link} — answers are anonymous and every choice is fine. Thanks! |
| **FR** | Salut ! Tu as testé Halcova — merci. On décide si Disques et Livres devraient chacun avoir leur propre ambiance (une « pièce disques » et une « pièce livres »). C'est un sondage de 3 minutes avec 4 captures à comparer : {link} — les réponses sont anonymes et tous les choix sont bons. Merci ! |
| **NL** | Hoi! Je hebt Halcova getest — dank je wel. We beslissen of Platen en Boeken elk een eigen uitstraling moeten krijgen (een 'platenkamer' en een 'boekenkamer'). Het is een enquête van 3 minuten met 4 afbeeldingen om te vergelijken: {link} — antwoorden zijn anoniem en elke keuze is prima. Bedankt! |
| **PT-BR** | Oi! Você testou o Halcova — obrigado. Estamos decidindo se Discos e Livros devem ter cada um sua própria aparência (um 'quarto de discos' e um 'quarto de livros'). É uma pesquisa de 3 minutos com 4 imagens para comparar: {link} — as respostas são anônimas e todas as escolhas valem. Obrigado! |
| **DE** | Hallo! Du hast Halcova getestet — danke. Wir entscheiden, ob Platten und Bücher jeweils einen eigenen Look bekommen sollen (einen ‚Plattenraum' und einen ‚Bücherraum'). Das ist eine 3-Minuten-Umfrage mit 4 Bildern zum Vergleichen: {link} — Antworten sind anonym, und jede Wahl ist in Ordnung. Danke! |
| **ES** | ¡Hola! Probaste Halcova — gracias. Estamos decidiendo si Discos y Libros deberían tener cada uno su propio aspecto (una 'habitación de discos' y una 'habitación de libros'). Es una encuesta de 3 minutos con 4 imágenes para comparar: {link} — las respuestas son anónimas y cualquier opción vale. ¡Gracias! |
| **IT** | Ciao! Hai provato Halcova — grazie. Stiamo decidendo se Dischi e Libri dovrebbero avere ciascuno il proprio aspetto (una 'stanza dei dischi' e una 'stanza dei libri'). È un sondaggio di 3 minuti con 4 immagini da confrontare: {link} — le risposte sono anonime e ogni scelta va bene. Grazie! |

---

## 5. Tester roster (copy from `private-test-plan.md` §4; tag each submission by language)

| Name | Country / lang | Main-test status | Survey status | Notes |
| --- | --- | --- | --- | --- |
| — | FR | ☐ done | ☐ sent ☐ replied | — |
| — | NL | ☐ done | ☐ sent ☐ replied | — |
| — | BR | ☐ done | ☐ sent ☐ replied | — |
| — | DE | ☐ done | ☐ sent ☐ replied | — |
| — | ES | ☐ done | ☐ sent ☐ replied | — |
| — | IT | ☐ done | ☐ sent ☐ replied | — |

> 1–2 testers per country. Ask each to answer in their own language.

---

## 6. Scoring sheet (one row per tester; tally by language)

| Tester | Lang | A1 | A2 | A3 | B1 | B2 | B3 | C1 | C2 (ticked) | D1 | D2 (note) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

**Aggregate to gates** (thresholds from `survey-theme-rooms.md` §4 — confirm
before launching `[VALIDATE]`):

| Gate | From | Pass if |
| --- | --- | --- |
| Desirability | A1 | "Love it" + "Nice idea" ≥ 70% (and "Prefer identical" < 30%) |
| Activation | A2 | "Yes" ≥ 50% |
| Cohesion priority | A3 | "Very" ≥ 50% |
| Accent winner | B1 | one of A/B/C wins by plurality **and** ≥ 50% |
| Cohesion of winner | B2 | "Definitely" + "Mostly" ≥ 80% for the winner |
| Same-app perception | C1 | "Definitely" + "Mostly" ≥ 80% |
| Phasing | D1 | no majority for "Never" |

**Fallbacks** (also in the survey doc):
- B1 tie → break by B2 cohesion (pick the more cohesive).
- Every accent fails B2 → stay with D (keep gold); revisit later. Legitimate outcome.
- A1 majority "Don't care" → theming is low-priority polish, not a launch feature.

**Tally tip:** compute per-language first (testers are native speakers), then
aggregate. Watch for one language vetoing an accent (color-meaning check, §7 of
the analysis).

---

## 7. Run plan

| Day | Step | Owner |
| --- | --- | --- |
| D0 | Build the form (Google Forms/Typeform) with §2 structure + §3 intro; embed the 5 mockups; confirm thresholds | Marketing + site owner |
| D1 | Send invites (§4) with the form link; mark roster | Marketing / site owner |
| D4 | Gentle reminder to non-responders | Marketing |
| D7 | Close form; tally per §6 | Marketing |
| D8 | Update `analysis-theme-per-collection.md` with Phase 0 results + recommendation | Marketing |
| D8+ | If GO: hand token restructure to Front End Architect (branch `feat/theme-per-collection`) | Front End Architect |

---

## 8. Open items `[VALIDATE]`

1. **Form tool** — Google Forms vs Typeform (image embedding + per-language
   copies both work; owner to pick).
2. **Native polish pass** for all non-EN intro/invite lines (they're drafts).
3. **Threshold confirmation** (§6) before the form goes live.
4. **Who sends invites** — site owner (already in touch with the circle) or
   Marketing; one sender to avoid double-pinging.
5. **Anonymity note** — the form must not ask for names; roster tracks
   completion separately.

---

## 9. Done criteria

The pack is "go" when: form built and linked · 5 mockups embedded · intro + all
questions present in 7 languages · thresholds confirmed · invites drafted ·
roster ready. That's the state of the work now — next action is the form build.
