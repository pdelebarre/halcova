# Validation log — foundations pack

Sign-off log for every entry in `pack.json`. Each entry gets a dated row:
what was checked, by whom, the verdict, and which flags were cleared or left
open. The quarterly fact-sweep appends a fresh row per live entry
(`lastVerified` update).

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

Scope: all 15 entries in `foundations/pack.json` (F-0001…F-0015).

| Date | Scope | Checker | Verdict | Flags cleared / notes |
| --- | --- | --- | --- | --- |
| 2026-08-17 | F-0001 (T4 blues) | Marketing Manager | PASS | `[FACT]` · both sources checked (Britannica + LOC) |
| 2026-08-17 | F-0002 (T4 rock term) | Marketing Manager | PASS | `[FACT]` · phrasing "appears as early as 1920s" is the uncontested framing |
| 2026-08-17 | F-0003 (T4 first rock record) | Marketing Manager | PASS-CORE | `[FACT]` + `[DISPUTED]` · ships uncontested core, both sides presented; re-check next sweep |
| 2026-08-17 | F-0004 (T4 jazz) | Marketing Manager | PASS | `[FACT]` · 1917 ODJB recordings confirmed |
| 2026-08-17 | F-0005 (T5 Blue Note) | Marketing Manager | PASS | `[FACT]` · 1939 founding + 1941 Wolff confirmed |
| 2026-08-17 | F-0006 (T5 Motown) | Marketing Manager | PASS | `[FACT]` · "among first million-sellers" phrasing kept (not "first #1") |
| 2026-08-17 | F-0007 (T3 LP/45) | Marketing Manager | PASS | `[FACT]` · format-era snapshot; `year` range [1948, 1949] |
| 2026-08-17 | F-0008 (T3 1977 punk) | Marketing Manager | PASS | `[FACT]` + `[CULT]` · UK-localized reference; local-hero note for non-UK |
| 2026-08-17 | F-0009 (T4 detective) | Marketing Manager | PASS | `[FACT]` · Poe 1841 confirmed |
| 2026-08-17 | F-0010 (T4 sci-fi) | Marketing Manager | PASS | `[FACT]` · "frequently cited" framing per contested-origin policy |
| 2026-08-17 | F-0011 (T5 Penguin) | Marketing Manager | PASS | `[FACT]` · 1935 founding + sixpenny paperbacks confirmed |
| 2026-08-17 | F-0012 (T5 Everyman's) | Marketing Manager | PASS | `[FACT]` · 1906 / J.M. Dent confirmed |
| 2026-08-17 | F-0013 (T3 Gutenberg) | Marketing Manager | PASS | `[FACT]` · c. 1455 + ~180 copies confirmed (British Library + Morgan) |
| 2026-08-17 | F-0014 (T4 Astérix, fr local hero) | Marketing Manager | PASS | `[FACT]` + `[CULT]` · 1959 Pilote #1 confirmed; pointer to fr local-hero pack |
| 2026-08-17 | F-0015 (T4 graphic novel) | Marketing Manager | PASS-CORE | `[VALIDATE]` + `[DISPUTED]` · uncontested core ships; "popularized vs predates" pending 3rd source |

## Open flags (not cleared)

| Entry | Flag | Why it stays open | Who clears it |
| --- | --- | --- | --- |
| F-0003 | `[DISPUTED]` | First-rock-record contest is permanent by nature — stays flagged; only the uncontested core ships | Marketing Manager (re-check each sweep) |
| F-0015 | `[VALIDATE]` | "Popularized vs predates" nuance needs a third source | Marketing Manager (next sweep) |
| F-0015 | `[DISPUTED]` | "First graphic novel" is contested — core-only | Marketing Manager |
| F-0008 / F-0014 | `[CULT]` | Local-hero / voice handoff to fr + en-GB packs and native testers | Marketing Manager + native testers |

## Template for the quarterly fact-sweep (next: 2026-11-01)

```text
| 2026-11-01 | <entry id> | Marketing Manager | PASS / PASS-CORE / HOLD / RETIRE | re-verified vs <sources>; <notes> |
```
