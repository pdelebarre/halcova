# Validation log — books-core pack

Sign-off log for every entry in `books-core/pack.json` (BC-0001…BC-0030).
Each entry gets a dated row: what was checked, by whom, the verdict, and which
flags were cleared or left open. The quarterly fact-sweep appends a fresh row
per live entry (`lastVerified` update).

Work item: `(FEAT-EPIC-5, #277)` — Halcova Library lore content packs.

## Format

```text
| Date | Scope | Checker | Verdict | Flags cleared / notes |
```

- **Verdict:** `PASS` (ships) · `PASS-CORE` (ships, uncontested core only) ·
  `HOLD` (does not ship yet) · `RETIRE` (removed from bank).
- **Checker:** the role who verified (Marketing Manager owns fact-checking;
  native testers sign off localized voice; Front End Dev clears `[VALIDATE]`
  data flags).

## Initial curation review — 2026-08-17

Scope: all 30 entries in `books-core/pack.json` (BC-0001…BC-0030).

| Date | Scope | Checker | Verdict | Flags cleared / notes |
| --- | --- | --- | --- | --- |
| 2026-08-17 | BC-0001 (T2 Nineteen Eighty-Four) | Marketing Manager | PASS | `[FACT]` · Jura + "Big Brother" in the language confirmed (Britannica + Orwell Foundation) |
| 2026-08-17 | BC-0002 (T2 Animal Farm) | Marketing Manager | PASS | `[FACT]` · allegory + Faber rejection (T.S. Eliot) confirmed (Orwell Foundation + British Library) |
| 2026-08-17 | BC-0003 (T1 Austen) | Marketing Manager | PASS | `[FACT]` · "By a Lady" + P&P 1813 after S&S 1811 confirmed (Jane Austen's House + British Library) |
| 2026-08-17 | BC-0004 (T2 Emma) | Marketing Manager | PASS | `[FACT]` · Prince Regent dedication at librarian's request confirmed |
| 2026-08-17 | BC-0005 (T2 Lord of the Rings) | Marketing Manager | PASS | `[FACT]` · from "The Hobbit," written for his children; Oxford professor confirmed |
| 2026-08-17 | BC-0006 (T6 Inklings) | Marketing Manager | PASS | `[FACT]` · Tolkien/Lewis Inklings membership + draft readings confirmed (Tolkien Society + Britannica) |
| 2026-08-17 | BC-0007 (T2 Harry Potter) | Marketing Manager | PASS | `[FACT]` · rejections + Bloomsbury 1997 + "Sorcerer's Stone" 1998 confirmed (Bloomsbury + Scholastic) |
| 2026-08-17 | BC-0008 (T2 Handmaid's Tale) | Marketing Manager | PASS | `[FACT]` · 1985 Governor General's Award + 2017 TV adaptation confirmed; living author — only sourced, non-defamatory facts |
| 2026-08-17 | BC-0009 (T2 Carrie) | Marketing Manager | PASS | `[FACT]` · first published novel 1974 + short-story origin confirmed; living author — sourced only |
| 2026-08-17 | BC-0010 (T2 The Shining) | Marketing Manager | PASS | `[FACT]` · Stanley Hotel inspiration confirmed (King official + hotel) |
| 2026-08-17 | BC-0011 (T7 Old Man and the Sea) | Marketing Manager | PASS | `[FACT]` · Pulitzer 1953 + Nobel 1954 confirmed (Pulitzer + Nobel official) |
| 2026-08-17 | BC-0012 (T1 Sun Also Rises) | Marketing Manager | PASS | `[FACT]` · 1926 first novel + Lost Generation circle confirmed (Hemingway Society + Britannica) |
| 2026-08-17 | BC-0013 (T2 Great Gatsby) | Marketing Manager | PASS | `[FACT]` · 1925 + modest lifetime sales + "one of the most-taught" framing confirmed |
| 2026-08-17 | BC-0014 (T1 This Side of Paradise) | Marketing Manager | PASS | `[FACT]` · 1920 debut + famous at 23 confirmed (Fitzgerald Society + Britannica) |
| 2026-08-17 | BC-0015 (T7 García Márquez Nobel) | Marketing Manager | PASS | `[FACT]` · Nobel 1982 confirmed (Nobel official + Instituto Cervantes) |
| 2026-08-17 | BC-0016 (T2 One Hundred Years) | Marketing Manager | PASS | `[FACT]` · 1967 Sudamericana first edition + "widely considered defining magical realism" framing |
| 2026-08-17 | BC-0017 (T2 Norwegian Wood) | Marketing Manager | PASS | `[FACT]` · 1987 bestseller in Japan + 1990s international fame confirmed; living author — sourced only |
| 2026-08-17 | BC-0018 (T7 Left Hand of Darkness) | Marketing Manager | PASS | `[FACT]` · Hugo + Nebula double confirmed (official award sites) |
| 2026-08-17 | BC-0019 (T1 Earthsea) | Marketing Manager | PASS | `[FACT]` · "A Wizard of Earthsea" 1968 + fantasy-territory framing confirmed |
| 2026-08-17 | BC-0020 (T7 Christie) | Marketing Manager | PASS-CORE | `[FACT]` · ships "widely cited best-selling fiction writer" (Guinness) + durable Mousetrap record |
| 2026-08-17 | BC-0021 (T2 Orient Express) | Marketing Manager | PASS | `[FACT]` · Pera Palace room connection confirmed (hotel official + Christie official) |
| 2026-08-17 | BC-0022 (T7 Beloved) | Marketing Manager | PASS | `[FACT]` · Pulitzer 1988 + first Black woman Nobel 1993 confirmed (Pulitzer + Nobel official) |
| 2026-08-17 | BC-0023 (T2 Mrs Dalloway) | Marketing Manager | PASS | `[FACT]` · single-day structure + stream-of-consciousness landmark confirmed (British Library + Britannica) |
| 2026-08-17 | BC-0024 (T2 Fahrenheit 451) | Marketing Manager | PASS | `[FACT]` · UCLA basement + rented typewriter + title origin confirmed (Bradbury official + Britannica) |
| 2026-08-17 | BC-0025 (T1 Slaughterhouse-Five) | Marketing Manager | PASS | `[FACT]` · Dresden POW basis confirmed (Vonnegut official + Britannica) |
| 2026-08-17 | BC-0026 (T2 To Kill a Mockingbird) | Marketing Manager | PASS | `[FACT]` · first novel + Pulitzer 1961 + most-taught framing confirmed (Pulitzer + Britannica) |
| 2026-08-17 | BC-0027 (T1 Asimov) | Marketing Manager | PASS | `[FACT]` · Foundation 1940s-to-early-1950s + Three Laws confirmed (Asimov official + Britannica) |
| 2026-08-17 | BC-0028 (T2 Dune) | Marketing Manager | PASS | `[FACT]` · Nebula + shared Hugo 1966 + film adaptations confirmed (official award sites + Britannica) |
| 2026-08-17 | BC-0029 (T2 Brave New World) | Marketing Manager | PASS | `[FACT]` · title from "The Tempest" confirmed (Britannica + Shakespeare Birthplace Trust) |
| 2026-08-17 | BC-0030 (T2 A Christmas Carol) | Marketing Manager | PASS | `[FACT]` · six weeks + Christmas revival framing confirmed (Dickens Museum + British Library) |

## Open flags (not cleared)

| Entry | Flag | Why it stays open | Who clears it |
| --- | --- | --- | --- |
| BC-0001…BC-0030 (voice) | `[VALIDATE]` | All voice lines need native-speaker validation per locale before they ship; brand voice (warm, witty, teases the collection never the person) must survive translation | Native testers |
| BC-0008 / BC-0009 / BC-0010 / BC-0017 | `[FACT]` living-author gate | Living authors — re-check at each sweep that every fact remains sourced, non-defamatory, and public-record | Marketing Manager (each sweep) |
| BC-0015 / BC-0016 | `[CULT]` handoff | García Márquez / One Hundred Years is an es local-hero topic — the es pack deepens it; the universal entry stays as-is for other locales | Marketing Manager + native testers (es) |

## Template for the quarterly fact-sweep (next: 2026-11-01)

```text
| 2026-11-01 | <entry id> | Marketing Manager | PASS / PASS-CORE / HOLD / RETIRE | re-verified vs <sources>; <notes> |
```
