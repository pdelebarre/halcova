# Source ledger — foundations pack

The ledger for every claim in `pack.json`. Format (mandatory, one row per
claim):

```text
{ claim, source1, source2, lastVerified, verifiedBy }
```

Rules (see `lore-layer-plan.md` §3): **two independent sources** per claim;
`source1`/`source2` are stable references (institution/archive/label-publisher
preferred); `lastVerified` is the ISO date of the most recent verification
sweep; `verifiedBy` is the human/role who verified. The quarterly fact-sweep
updates `lastVerified` and retires anything that stopped being true.

## Ledger

| Claim | Source 1 | Source 2 | Last verified | Verified by |
| --- | --- | --- | --- | --- |
| S-0001 · Blues grew from work songs/spirituals/field hollers; Handy's "Memphis Blues" (1912) among first published (F-0001) | Britannica — "Blues" (entry) | Library of Congress — African American song / blues collections | 2026-08-17 | Marketing Manager |
| S-0002 · Handy carried blues to a national audience via sheet music (F-0001) | W.C. Handy official site / Smithsonian | Britannica — "W.C. Handy" (entry) | 2026-08-17 | Marketing Manager |
| S-0003 · "Rock and roll" appears in blues records from the 1920s (F-0002) | Rock & Roll Hall of Fame — "Origins of Rock and Roll" | Britannica — "Rock and roll" (entry) | 2026-08-17 | Marketing Manager |
| S-0004 · Alan Freed popularized the term for the new genre, early 1950s (F-0002) | Rock & Roll Hall of Fame — Alan Freed (inductee) | Britannica — "Alan Freed" (entry) | 2026-08-17 | Marketing Manager |
| S-0005 · "Rocket 88" (1951) most frequently named "first rock and roll record"; recorded at Sam Phillips' Memphis studio (F-0003, contested) | Rock & Roll Hall of Fame — "Rocket 88" (songs that shaped rock) | NPR — "The First Rock and Roll Record" (2004) | 2026-08-17 | Marketing Manager |
| S-0006 · Other candidates incl. earlier R&B tracks and Elvis' "That's All Right" (1954); historians disagree (F-0003) | Britannica — "Rock and roll" (origins section) | Rolling Stone — "The 500 Greatest Songs" notes / history of rock | 2026-08-17 | Marketing Manager |
| S-0007 · Jazz developed in New Orleans, early 20th c., blending blues/ragtime/brass/Creole (F-0004) | Britannica — "Jazz" (entry) | Smithsonian National Museum of American History — jazz origins | 2026-08-17 | Marketing Manager |
| S-0008 · First jazz recordings made 1917 by the Original Dixieland Jass Band (F-0004) | Library of Congress — National Recording Registry ("Livery Stable Blues") | Britannica — "Original Dixieland Jazz Band" (entry) | 2026-08-17 | Marketing Manager |
| S-0009 · Blue Note founded 1939 by Alfred Lion (with Max Margulis); Francis Wolff joined 1941 (F-0005) | Blue Note Records official — "Our Story" | AllMusic — Blue Note Records (overview) | 2026-08-17 | Marketing Manager |
| S-0010 · Lion & Wolff shaped Blue Note's hard-bop sound and iconic covers (F-0005) | Blue Note Records official — "Our Story" | The Guardian — Blue Note at 75 (feature) | 2026-08-17 | Marketing Manager |
| S-0011 · Motown founded 1959 by Berry Gordy in Detroit; name from "Motor Town" (F-0006) | Motown Museum — history | Britannica — "Motown" (entry) | 2026-08-17 | Marketing Manager |
| S-0012 · "Shop Around" (1960) among Motown's first million-sellers (F-0006) | Motown Museum — first hits | Rock & Roll Hall of Fame — The Miracles (inductee) | 2026-08-17 | Marketing Manager |
| S-0013 · Columbia introduced the 12" LP in 1948 (F-0007) | Library of Congress — "The LP" (recording technology) | Britannica — "LP" (entry) | 2026-08-17 | Marketing Manager |
| S-0014 · RCA Victor introduced the 45 rpm single in 1949 (F-0007) | Library of Congress — "The 45" (recording technology) | Britannica — "45" (entry) | 2026-08-17 | Marketing Manager |
| S-0015 · "Never Mind the Bollocks" released October 1977; the band's only studio album (F-0008) | Sex Pistols official discography | Rolling Stone — "The 500 Greatest Albums" (entry) | 2026-08-17 | Marketing Manager |
| S-0016 · The album is a cornerstone of UK punk (F-0008) | Rock & Roll Hall of Fame — Sex Pistols (inductee) | NME — punk anniversary features | 2026-08-17 | Marketing Manager |
| S-0017 · Poe's "The Murders in the Rue Morgue" (1841) widely credited as first modern detective story (F-0009) | Britannica — "detective story" (entry) | British Library — Poe collection notes | 2026-08-17 | Marketing Manager |
| S-0018 · Introduced the analytical detective + locked-room mystery (F-0009) | British Library — crime fiction history | Edgar Allan Poe Society of Baltimore | 2026-08-17 | Marketing Manager |
| S-0019 · "Frankenstein" (1818) frequently cited as an early work of science fiction (F-0010) | Britannica — "Frankenstein" (entry) | The Guardian — Frankenstein at 200 (2018) | 2026-08-17 | Marketing Manager |
| S-0020 · "Science fiction" label popularized by Hugo Gernsback in the 1920s (F-0010) | Britannica — "science fiction" (entry) | Smithsonian — sci-fi history | 2026-08-17 | Marketing Manager |
| S-0021 · Penguin founded 1935 by Allen Lane; first ten sixpenny paperbacks (F-0011) | Penguin Books official — company history | Britannica — "Penguin Books" (entry) | 2026-08-17 | Marketing Manager |
| S-0022 · Orange covers iconic; credited with the paperback revolution (F-0011) | Penguin Books official — history | BBC — Penguin at 80 (2015) | 2026-08-17 | Marketing Manager |
| S-0023 · Everyman's Library founded 1906 by J.M. Dent, London (F-0012) | Everyman's Library official — about | Britannica — "J.M. Dent" (entry) | 2026-08-17 | Marketing Manager |
| S-0024 · Aim: make classics affordable to "everyman" (F-0012) | Everyman's Library official — about | British Library — publisher histories | 2026-08-17 | Marketing Manager |
| S-0025 · Gutenberg introduced movable-type printing in Europe, mid-15th c. (F-0013) | British Library — Gutenberg Bible | Britannica — "Johannes Gutenberg" (entry) | 2026-08-17 | Marketing Manager |
| S-0026 · Gutenberg Bible c. 1455, earliest major printed book; ~180 copies (F-0013) | British Library — Gutenberg Bible (collection) | Morgan Library & Museum — Gutenberg Bible | 2026-08-17 | Marketing Manager |
| S-0027 · Astérix first appeared October 1959 in Pilote #1 (F-0014) | Astérix official site — history | Britannica — "Astérix" (entry) | 2026-08-17 | Marketing Manager |
| S-0028 · Among the best-selling comic series in the world (F-0014) | Astérix official site — sales | The Guardian — Astérix features | 2026-08-17 | Marketing Manager |
| S-0029 · Eisner's "A Contract with God" (1978) widely credited with popularizing "graphic novel" (F-0015, contested) | The Guardian — comics history | Britannica — "comic strip / graphic novel" (entry) | 2026-08-17 | Marketing Manager |
| S-0030 · The term predates the book; "first graphic novel" is contested (F-0015) | The Guardian — graphic novel history | Will Eisner official / documentary (Will Eisner: The Spirit) | 2026-08-17 | Marketing Manager |

## Source bibliography (stable references)

Institution/archive sources are preferred and re-checked each sweep. Full URLs
are recorded in the pack handoff (see `localization-notes.md` for the locales
where a source needs a local edition).

## Open ledger items

- **F-0003 (`[DISPUTED]`)** — S-0005/S-0006 carry the both-sides framing; the
  uncontested core ("several early-1950s candidates; 'Rocket 88' most named")
  is what ships. Re-check at the next sweep.
- **F-0015 (`[VALIDATE]`)** — "popularized vs predates" nuance pending a
  third source at the next sweep; only the uncontested core ships meanwhile.
