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

Work item: `(FEAT-EPIC-5, #277)` — Halcova Library lore content packs.

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
| S-0031 · "Rhythm and blues" coined late 1940s by Jerry Wexler at Billboard, replacing "race music" (F-0016) | Britannica — "rhythm and blues" (entry) | Rock & Roll Hall of Fame — Jerry Wexler (inductee) | 2026-08-17 | Marketing Manager |
| S-0032 · Soul grew from R&B + gospel in the 1950s–60s, rooted in the Black church (F-0016) | Smithsonian National Museum of African American History and Culture — soul music | Britannica — "soul music" (entry) | 2026-08-17 | Marketing Manager |
| S-0033 · Bristol Sessions 1927; Ralph Peer recorded the Carter Family + Jimmie Rodgers (F-0017) | Country Music Hall of Fame and Museum — Bristol Sessions | Library of Congress — Bristol Sessions (National Recording Registry) | 2026-08-17 | Marketing Manager |
| S-0034 · Sessions often called the "big bang" of country music (F-0017) | Country Music Hall of Fame and Museum — Bristol Sessions exhibit | Britannica — "country music" (entry) | 2026-08-17 | Marketing Manager |
| S-0035 · Hip hop emerged in the Bronx, early 1970s; Kool Herc's 1973 party at 1520 Sedgwick Avenue widely cited as foundational (F-0018) | Smithsonian National Museum of American History — hip hop | Britannica — "hip-hop" (entry) | 2026-08-17 | Marketing Manager |
| S-0036 · Culture grew across the decade via DJing, MCing, breaking, graffiti (F-0018) | Rock & Roll Hall of Fame — hip hop / break-beat history | Smithsonian — hip hop collection notes | 2026-08-17 | Marketing Manager |
| S-0037 · Reggae developed in Jamaica, late 1960s, from ska/rocksteady; "one drop" rhythm (F-0019) | Britannica — "reggae" (entry) | Smithsonian Folkways — reggae history | 2026-08-17 | Marketing Manager |
| S-0038 · Bob Marley and the Wailers carried reggae to a global audience in the 1970s (F-0019) | Bob Marley official site — biography | Britannica — "Bob Marley" (entry) | 2026-08-17 | Marketing Manager |
| S-0039 · Heavy metal emerged late 1960s–early 1970s, largely Birmingham; Black Sabbath/Led Zeppelin/Deep Purple (F-0020, contested) | Britannica — "heavy metal" (entry) | Rock & Roll Hall of Fame — Black Sabbath (inductee) | 2026-08-17 | Marketing Manager |
| S-0040 · "First metal band" genuinely contested; uncontested core ships (F-0020) | Britannica — "heavy metal" (origins section) | Rolling Stone — heavy metal history features | 2026-08-17 | Marketing Manager |
| S-0041 · Atlantic Records founded 1947 by Ahmet Ertegun + Herb Abramson, New York (F-0021) | Atlantic Records / Rhino — label history | Rock & Roll Hall of Fame — Ahmet Ertegun (inductee) | 2026-08-17 | Marketing Manager |
| S-0042 · R&B/soul roster (Charles, Franklin, Redding) + later rock (Led Zeppelin) (F-0021) | Atlantic Records — artist history | Britannica — "Ahmet Ertegun" (entry) | 2026-08-17 | Marketing Manager |
| S-0043 · Chess Records founded 1950 by brothers Phil + Leonard Chess, Chicago (F-0022) | Britannica — "Chess Records" (entry) | Blues Foundation / Blues Hall of Fame — Chess | 2026-08-17 | Marketing Manager |
| S-0044 · Electric Chicago blues (Waters, Howlin' Wolf) + early rock (Berry, Bo Diddley) (F-0022) | Chess Records / Universal — label history | Rock & Roll Hall of Fame — Chuck Berry / Bo Diddley (inductee) | 2026-08-17 | Marketing Manager |
| S-0045 · Disco rose through the 1970s from clubs rooted in Black, Latino, and gay culture (F-0023) | Smithsonian National Museum of American History — disco | Britannica — "disco" (entry) | 2026-08-17 | Marketing Manager |
| S-0046 · "Saturday Night Fever" (1977) + Bee Gees soundtrack made disco a global phenomenon (F-0023) | Library of Congress — National Recording Registry ("Saturday Night Fever") | Britannica — "Saturday Night Fever" (entry) | 2026-08-17 | Marketing Manager |
| S-0047 · Beatles' February 1964 "Ed Sullivan Show" appearance opened the British Invasion (F-0024) | Rock & Roll Hall of Fame — The Beatles (inductee) | Library of Congress — The Ed Sullivan Show archive | 2026-08-17 | Marketing Manager |
| S-0048 · UK acts dominated US charts mid-1960s (Stones, Kinks, Who) (F-0024) | Britannica — "British Invasion" (entry) | Billboard — chart history | 2026-08-17 | Marketing Manager |
| S-0049 · Walpole's "The Castle of Otranto" (1764) widely credited as the first Gothic novel (F-0025) | British Library — Gothic literature | Britannica — "Gothic novel" (entry) | 2026-08-17 | Marketing Manager |
| S-0050 · Second-edition subtitle "A Gothic Story"; castles/supernatural/melodrama define the genre (F-0025) | British Library — Gothic fiction collection | University of Oxford — Gothic studies reference | 2026-08-17 | Marketing Manager |
| S-0051 · Tolkien's "The Hobbit" (1937) + "The Lord of the Rings" (1954–55) widely credited with establishing modern fantasy (F-0026) | Bodleian Libraries — Tolkien exhibition | Britannica — "fantasy literature" (entry) | 2026-08-17 | Marketing Manager |
| S-0052 · Shaped the genre's secondary worlds, invented languages, epic quests (F-0026) | The Tolkien Society (official) | Britannica — "The Lord of the Rings" (entry) | 2026-08-17 | Marketing Manager |
| S-0053 · Latin American Boom 1960s–70s; novelists incl. García Márquez, Vargas Llosa, Cortázar, Fuentes (F-0027) | Britannica — "Latin American literature" (entry) | Instituto Cervantes — el Boom | 2026-08-17 | Marketing Manager |
| S-0054 · Associated with magical realism and experimental narrative (F-0027) | Britannica — "magical realism" (entry) | Nobel Prize — García Márquez profile | 2026-08-17 | Marketing Manager |
| S-0055 · Faber and Faber founded 1929 by Geoffrey Faber, growing out of Faber & Gwyer (F-0028) | Faber and Faber official — history | Britannica — "T.S. Eliot" (entry) | 2026-08-17 | Marketing Manager |
| S-0056 · T.S. Eliot joined as editor in 1925, became a director; published his own poetry there (F-0028) | Faber and Faber official — T.S. Eliot | T.S. Eliot Society — biography | 2026-08-17 | Marketing Manager |
| S-0057 · Anchor Books launched 1953 by Jason Epstein at Doubleday (F-0029) | Britannica — "paperback" (entry) | Anchor / Penguin Random House — history | 2026-08-17 | Marketing Manager |
| S-0058 · Widely credited with pioneering the American trade paperback (F-0029) | The New York Times — Jason Epstein (obituary, 2017) | Anchor Books official — history | 2026-08-17 | Marketing Manager |
| S-0059 · Beat Generation, 1950s American movement (NYC + San Francisco); spontaneous experimental writing (F-0030) | Britannica — "Beat movement" (entry) | Smithsonian — Beat culture holdings | 2026-08-17 | Marketing Manager |
| S-0060 · "Howl" (1956) + "On the Road" (1957) most famous works (F-0030) | Allen Ginsberg Project / official archives | Jack Kerouac / Ann Arbor archives | 2026-08-17 | Marketing Manager |
| S-0061 · Many 19th-century novels first appeared in serial form; "The Pickwick Papers" (1836–37) popularized it (F-0031) | British Library — Victorian serials | Britannica — "Charles Dickens" (entry) | 2026-08-17 | Marketing Manager |
| S-0062 · Dickens' later novels eagerly awaited installment by installment (F-0031) | Charles Dickens Museum (official) | British Library — Dickens | 2026-08-17 | Marketing Manager |

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
- **F-0018 (`[DISPUTED]`)** — the 1973 Sedgwick Avenue party is "widely cited"
  as a foundational moment, not asserted as the single origin; the culture grew
  across the decade. Re-check framing at the next sweep.
- **F-0020 (`[DISPUTED]`)** — the "first heavy-metal band" question is
  permanent by nature; only the uncontested core (Birmingham bands defined the
  sound) ships. Re-check each sweep.
- **F-0027 (`[CULT]`)** — Latin American Boom is an `es` (and broader
  Spanish-reading) local-hero topic; the universal entry stays as-is for other
  locales, with a deeper es local-hero entry to follow.
