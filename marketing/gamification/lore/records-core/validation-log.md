# Validation log — records-core pack

Sign-off log for every entry in `records-core/pack.json` (RC-0001…RC-0050).
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

Scope: all 50 entries in `records-core/pack.json` (RC-0001…RC-0050).

| Date | Scope | Checker | Verdict | Flags cleared / notes |
| --- | --- | --- | --- | --- |
| 2026-08-17 | RC-0001 (T1 Beatles) | Marketing Manager | PASS | `[FACT]` · 1960 formation + 1962 lineup confirmed (Britannica + RRHOF) |
| 2026-08-17 | RC-0002 (T7 Sgt. Pepper) | Marketing Manager | PASS | `[FACT]` · first rock album to win AOTY (1968) confirmed (Grammy.com + Britannica) |
| 2026-08-17 | RC-0003 (T2 Dark Side) | Marketing Manager | PASS | `[FACT]` · Abbey Road + concept themes + Thorgerson cover confirmed |
| 2026-08-17 | RC-0004 (T7 900+ weeks) | Marketing Manager | PASS | `[FACT]` · durable "more than 900 weeks" framing; no live chart number hardcoded |
| 2026-08-17 | RC-0005 (T1 Led Zeppelin) | Marketing Manager | PASS | `[FACT]` · 1968 formation + name origin confirmed (Britannica + RRHOF) |
| 2026-08-17 | RC-0006 (T2 Led Zeppelin IV) | Marketing Manager | PASS | `[FACT]` · untitled fourth album + "Stairway to Heaven" never a single confirmed |
| 2026-08-17 | RC-0007 (T1 Stones) | Marketing Manager | PASS | `[FACT]` · 1962 formation + Muddy Waters name source confirmed |
| 2026-08-17 | RC-0008 (T2 Satisfaction) | Marketing Manager | PASS | `[FACT]` · first US #1 confirmed (RRHOF + Billboard) |
| 2026-08-17 | RC-0009 (T1 Queen) | Marketing Manager | PASS | `[FACT]` · 1970/1971 lineup confirmed (Queen official + RRHOF) |
| 2026-08-17 | RC-0010 (T2 Bohemian Rhapsody) | Marketing Manager | PASS | `[FACT]` · nine weeks at UK #1 "at the time" framing kept (Official Charts) |
| 2026-08-17 | RC-0011 (T2 Space Oddity) | Marketing Manager | PASS | `[FACT]` · July 1969 release + BBC Apollo coverage confirmed (Bowie official + BBC) |
| 2026-08-17 | RC-0012 (T1 Ziggy Stardust) | Marketing Manager | PASS | `[FACT]` · 1972 alter ego + glam landmark confirmed (Britannica + V&A) |
| 2026-08-17 | RC-0013 (T2 Kind of Blue) | Marketing Manager | PASS | `[FACT]` · modal jazz + two-session recording confirmed (LOC + Britannica) |
| 2026-08-17 | RC-0014 (T7 best-selling jazz) | Marketing Manager | PASS | `[FACT]` · "widely cited" framing + RIAA multi-platinum confirmed |
| 2026-08-17 | RC-0015 (T2 Nevermind) | Marketing Manager | PASS | `[FACT]` · Jan 1992 #1 + replacing "Dangerous" confirmed (Billboard archive) |
| 2026-08-17 | RC-0016 (T1 Nirvana) | Marketing Manager | PASS | `[FACT]` · 1987 formation + Grohl 1990 + Cobain 1994 confirmed; kind, sourced, no speculation |
| 2026-08-17 | RC-0017 (T1 Radiohead) | Marketing Manager | PASS | `[FACT]` · "On a Friday" 1985 confirmed (Radiohead official + Britannica) |
| 2026-08-17 | RC-0018 (T2 OK Computer) | Marketing Manager | PASS | `[FACT]` · St Catherine's Court + 1998 Grammy confirmed (Grammy.com + official) |
| 2026-08-17 | RC-0019 (T2 Rumours) | Marketing Manager | PASS | `[FACT]` · recorded amid breakups + AOTY 1978 confirmed (Rolling Stone + Grammy.com) |
| 2026-08-17 | RC-0020 (T7 Thriller) | Marketing Manager | PASS-CORE | `[FACT]` · ships "widely cited best-selling" core + durable 8-Grammy record; no fluctuating sales number |
| 2026-08-17 | RC-0021 (T2 Thriller film) | Marketing Manager | PASS | `[FACT]` · Landis short film ~14 min + MTV era confirmed (LOC registry) |
| 2026-08-17 | RC-0022 (T2 Purple Rain) | Marketing Manager | PASS | `[FACT]` · album+film 1984 + 1985 Oscar confirmed (Academy official) |
| 2026-08-17 | RC-0023 (T1 The Smiths) | Marketing Manager | PASS | `[FACT]` · Manchester 1982 + Morrissey/Marr confirmed (Britannica + RRHOF) |
| 2026-08-17 | RC-0024 (T1 Talking Heads) | Marketing Manager | PASS | `[FACT]` · RISD 1975 + lineup confirmed (RRHOF + Britannica) |
| 2026-08-17 | RC-0025 (T2 Stop Making Sense) | Marketing Manager | PASS | `[FACT]` · Demme film 1984 + National Film Registry confirmed; "widely regarded" framing |
| 2026-08-17 | RC-0026 (T2 What's Going On) | Marketing Manager | PASS | `[FACT]` · Vietnam brother inspiration confirmed (LOC registry + Britannica) |
| 2026-08-17 | RC-0027 (T7 three AOTYs) | Marketing Manager | PASS | `[FACT]` · three AOTY wins (1974/75/77) confirmed (Grammy.com records); "consecutive"/"first" deliberately avoided |
| 2026-08-17 | RC-0028 (T1 Little Stevie) | Marketing Manager | PASS | `[FACT]` · "Fingertips" 1963 at 13, "then a record" framing kept (Billboard + Britannica) |
| 2026-08-17 | RC-0029 (T7 Dylan Nobel) | Marketing Manager | PASS | `[FACT]` · Nobel 2016 confirmed (Nobel official); "widely reported" for the songwriter-first framing |
| 2026-08-17 | RC-0030 (T2 Like a Rolling Stone) | Marketing Manager | PASS | `[FACT]` · six-minute single + "widely credited" framing confirmed (RRHOF + LOC) |
| 2026-08-17 | RC-0031 (T2 Exodus) | Marketing Manager | PASS | `[FACT]` · London recording after 1976 attempt + Time 1999 confirmed (Britannica + Time) |
| 2026-08-17 | RC-0032 (T7 Respect) | Marketing Manager | PASS | `[FACT]` · #1 + first woman in RRHOF (1987) confirmed (LOC + RRHOF) |
| 2026-08-17 | RC-0033 (T2 Woodstock anthem) | Marketing Manager | PASS | `[FACT]` · instrumental anthem performance confirmed (LOC registry + Smithsonian) |
| 2026-08-17 | RC-0034 (T2 Tommy) | Marketing Manager | PASS | `[FACT]` · "widely regarded as one of the first rock operas" framing (RRHOF + Britannica) |
| 2026-08-17 | RC-0035 (T2 Pet Sounds) | Marketing Manager | PASS | `[FACT]` · Brian Wilson + McCartney-influence framing confirmed (LOC + Rolling Stone) |
| 2026-08-17 | RC-0036 (T7 Joshua Tree) | Marketing Manager | PASS | `[FACT]` · AOTY 1988 confirmed (Grammy.com + RRHOF) |
| 2026-08-17 | RC-0037 (T2 Born to Run) | Marketing Manager | PASS | `[FACT]` · Landau 1974 review paraphrased, short attributed line only (Rolling Stone + official) |
| 2026-08-17 | RC-0038 (T7 Born in the USA) | Marketing Manager | PASS | `[FACT]` · seven top-ten singles confirmed (Billboard archive + Britannica) |
| 2026-08-17 | RC-0039 (T2 London Calling) | Marketing Manager | PASS | `[FACT]` · double album + Rolling Stone 1989 poll confirmed (RS 1989 + RRHOF) |
| 2026-08-17 | RC-0040 (T1 Joy Division) | Marketing Manager | PASS | `[FACT]` · 1976 formation + pulsar cover + New Order continuation confirmed (RRHOF) |
| 2026-08-17 | RC-0041 (T2 That's All Right) | Marketing Manager | PASS | `[FACT]` · Sun Studios 1954 confirmed (RRHOF + Smithsonian) |
| 2026-08-17 | RC-0042 (T2 Dock of the Bay) | Marketing Manager | PASS-CORE | `[FACT]` · ships uncontested core: first US #1, released after death; "often cited" posthumous framing, no over-claim |
| 2026-08-17 | RC-0043 (T2 A Change Is Gonna Come) | Marketing Manager | PASS | `[FACT]` · motel incident documented (LOC registry + Smithsonian); civil-rights landmark framing |
| 2026-08-17 | RC-0044 (T2 Velvet Underground) | Marketing Manager | PASS | `[FACT]` · Warhol production + banana cover + later-influence framing confirmed |
| 2026-08-17 | RC-0045 (T7 Daft Punk) | Marketing Manager | PASS | `[FACT]` · AOTY 2014 confirmed (Grammy.com); "landmark for electronic/dance" phrasing kept |
| 2026-08-17 | RC-0046 (T7 Back to Black) | Marketing Manager | PASS | `[FACT]` · five Grammys 2008 incl. Record of the Year + tie framing confirmed (Grammy.com) |
| 2026-08-17 | RC-0047 (T7 21) | Marketing Manager | PASS | `[FACT]` · six Grammys 2012 incl. AOTY + tie framing confirmed (Grammy.com) |
| 2026-08-17 | RC-0048 (T5 Sub Pop) | Marketing Manager | PASS | `[FACT]` · 1988 founding + "Bleach" 1989 confirmed (Sub Pop official + RRHOF) |
| 2026-08-17 | RC-0049 (T5 Sun Records) | Marketing Manager | PASS | `[FACT]` · 1952 founding + roster confirmed (Museum + Britannica) |
| 2026-08-17 | RC-0050 (T5 Stax) | Marketing Manager | PASS | `[FACT]` · "Soulsville USA" + roster confirmed (Stax Museum + RRHOF) |

## Open flags (not cleared)

| Entry | Flag | Why it stays open | Who clears it |
| --- | --- | --- | --- |
| RC-0001…RC-0050 (voice) | `[VALIDATE]` | All voice lines need native-speaker validation per locale before they ship; brand voice (warm, witty, teases the collection never the person) must survive translation | Native testers |
| RC-0015 / RC-0020 / RC-0042 | hedged `[FACT]` | Dated chart/record claims ship only as history, never as live stats — re-check each sweep | Marketing Manager (next sweep) |
| RC-0011 / RC-0033 / RC-0037 | `[VALIDATE]` (voice) | BBC/US/NY-critic framings — localize the wrapper, keep the fact universal (see localization-notes.md) | Marketing Manager + native testers |

## Template for the quarterly fact-sweep (next: 2026-11-01)

```text
| 2026-11-01 | <entry id> | Marketing Manager | PASS / PASS-CORE / HOLD / RETIRE | re-verified vs <sources>; <notes> |
```
