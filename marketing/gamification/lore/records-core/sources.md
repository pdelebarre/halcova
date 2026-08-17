# Source ledger — records-core pack

The ledger for every claim in `records-core/pack.json` (RC-0001…RC-0050).
Format (mandatory, one row per claim):

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
| S-0001 · The Beatles formed Liverpool 1960; classic four settled 1962; "Love Me Do" first UK single (RC-0001) | Britannica — "The Beatles" (entry) | Rock & Roll Hall of Fame — The Beatles (inductee) | 2026-08-17 | Marketing Manager |
| S-0002 · Lineup settled with Ringo Starr in 1962 (RC-0001) | The Beatles official site — history | Britannica — "Ringo Starr" (entry) | 2026-08-17 | Marketing Manager |
| S-0003 · "Sgt. Pepper" (1967) first rock album to win Album of the Year Grammy (1968) (RC-0002) | Grammy.com — official winners | Britannica — "Sgt. Pepper's Lonely Hearts Club Band" (entry) | 2026-08-17 | Marketing Manager |
| S-0004 · Album released 1967; landmark of the album era (RC-0002) | Library of Congress — National Recording Registry ("Sgt. Pepper") | Rock & Roll Hall of Fame — The Beatles (inductee) | 2026-08-17 | Marketing Manager |
| S-0005 · "Dark Side of the Moon" recorded at Abbey Road; concept album on time/money/mental strain (RC-0003) | Britannica — "The Dark Side of the Moon" (entry) | Pink Floyd official site — discography | 2026-08-17 | Marketing Manager |
| S-0006 · Prism cover designed by Storm Thorgerson (RC-0003) | Rolling Stone — album history / 500 Greatest Albums | Pink Floyd official — album credits | 2026-08-17 | Marketing Manager |
| S-0007 · "Dark Side of the Moon" 900+ weeks on Billboard 200 (RC-0004) | Billboard — chart report (longest-charting albums) | Guinness World Records — music records | 2026-08-17 | Marketing Manager |
| S-0008 · Among the longest chart runs of any album (RC-0004) | Britannica — "The Dark Side of the Moon" (entry) | Rock & Roll Hall of Fame — Pink Floyd (inductee) | 2026-08-17 | Marketing Manager |
| S-0009 · Led Zeppelin formed 1968 from The Yardbirds (RC-0005) | Britannica — "Led Zeppelin" (entry) | Rock & Roll Hall of Fame — Led Zeppelin (inductee) | 2026-08-17 | Marketing Manager |
| S-0010 · Name from Keith Moon/John Entwistle "lead zeppelin" joke; spelling changed (RC-0005) | Led Zeppelin official site — biography | Rock & Roll Hall of Fame — Led Zeppelin (inductee) | 2026-08-17 | Marketing Manager |
| S-0011 · Led Zeppelin IV (1971) untitled; among best-selling albums of all time (RC-0006) | Rolling Stone — 500 Greatest Albums ("Led Zeppelin IV") | Britannica — "Led Zeppelin IV" (entry) | 2026-08-17 | Marketing Manager |
| S-0012 · "Stairway to Heaven" never released as a single (RC-0006) | Led Zeppelin official site — discography | Rock & Roll Hall of Fame — "Stairway to Heaven" (songs that shaped rock) | 2026-08-17 | Marketing Manager |
| S-0013 · The Rolling Stones formed London 1962 (RC-0007) | Britannica — "The Rolling Stones" (entry) | Rock & Roll Hall of Fame — The Rolling Stones (inductee) | 2026-08-17 | Marketing Manager |
| S-0014 · Brian Jones named the band after Muddy Waters' "Rollin' Stone" (RC-0007) | The Rolling Stones official site — history | Britannica — "The Rolling Stones" (entry) | 2026-08-17 | Marketing Manager |
| S-0015 · "(I Can't Get No) Satisfaction" written by Jagger/Richards; Stones' first US #1 (RC-0008) | Rock & Roll Hall of Fame — "Satisfaction" (songs that shaped rock) | Billboard — Hot 100 chart record | 2026-08-17 | Marketing Manager |
| S-0016 · Released 1965; signature riff (RC-0008) | Britannica — "(I Can't Get No) Satisfaction" (entry) | The Rolling Stones official site — discography | 2026-08-17 | Marketing Manager |
| S-0017 · Queen formed London 1970; Mercury joined May/Taylor (RC-0009) | Britannica — "Queen" (entry) | Queen official site — biography | 2026-08-17 | Marketing Manager |
| S-0018 · John Deacon completed lineup 1971; stayed two decades (RC-0009) | Queen official site — biography | Rock & Roll Hall of Fame — Queen (inductee) | 2026-08-17 | Marketing Manager |
| S-0019 · "Bohemian Rhapsody" (1975) six-minute single, operatic section (RC-0010) | Official Charts Company (UK) — chart archive | Rolling Stone — 500 Greatest Songs | 2026-08-17 | Marketing Manager |
| S-0020 · Nine weeks at UK #1 — at the time the longest run (RC-0010) | Official Charts Company (UK) — chart archive | Queen official site — discography | 2026-08-17 | Marketing Manager |
| S-0021 · "Space Oddity" (1969) released days before Apollo 11; BBC used it in coverage (RC-0011) | David Bowie official site — "Space Oddity" | BBC — Apollo 11 coverage retrospectives | 2026-08-17 | Marketing Manager |
| S-0022 · Released July 1969 (RC-0011) | Britannica — "David Bowie" (entry) | The Guardian — Bowie 1969 retrospectives | 2026-08-17 | Marketing Manager |
| S-0023 · "Ziggy Stardust" (1972) introduced the alter ego; glam rock landmark (RC-0012) | Britannica — "David Bowie" (entry) | Victoria and Albert Museum — "David Bowie Is" exhibition | 2026-08-17 | Marketing Manager |
| S-0024 · Album title and release year (RC-0012) | David Bowie official site — discography | Rolling Stone — 500 Greatest Albums | 2026-08-17 | Marketing Manager |
| S-0025 · "Kind of Blue" (1959) modal jazz; recorded in two sessions, minimal rehearsal (RC-0013) | Library of Congress — National Recording Registry ("Kind of Blue") | Britannica — "modal jazz" (entry) | 2026-08-17 | Marketing Manager |
| S-0026 · Landmark status; improv on scales rather than chord changes (RC-0013) | Columbia/Legacy official liner notes | Rolling Stone — 500 Greatest Albums | 2026-08-17 | Marketing Manager |
| S-0027 · "Kind of Blue" widely cited as best-selling jazz album; multi-platinum US (RC-0014) | RIAA — certification database | Britannica — "Miles Davis" (entry) | 2026-08-17 | Marketing Manager |
| S-0028 · Album released 1959 (RC-0014) | Library of Congress — National Recording Registry | Smithsonian National Museum of American History — jazz holdings | 2026-08-17 | Marketing Manager |
| S-0029 · "Nevermind" (1991) produced by Butch Vig; #1 Billboard 200 January 1992 (RC-0015) | Billboard — chart archive (Jan 1992) | Rock & Roll Hall of Fame — Nirvana (inductee) | 2026-08-17 | Marketing Manager |
| S-0030 · Replaced Michael Jackson's "Dangerous" at #1 (RC-0015) | Billboard — chart archive | The Guardian — grunge/Nevermind retrospectives | 2026-08-17 | Marketing Manager |
| S-0031 · Nirvana formed Aberdeen, Washington 1987 (RC-0016) | Britannica — "Nirvana" (entry) | Rock & Roll Hall of Fame — Nirvana (inductee) | 2026-08-17 | Marketing Manager |
| S-0032 · Dave Grohl joined 1990; Kurt Cobain died 1994, ending the band (RC-0016) | Britannica — "Kurt Cobain" (entry) | Rock & Roll Hall of Fame — Nirvana (inductee) | 2026-08-17 | Marketing Manager |
| S-0033 · Radiohead formed Abingdon, Oxfordshire 1985 as "On a Friday" (RC-0017) | Radiohead official site — biography | Britannica — "Radiohead" (entry) | 2026-08-17 | Marketing Manager |
| S-0034 · Renamed Radiohead (RC-0017) | Radiohead official site — biography | Rolling Stone — Radiohead history | 2026-08-17 | Marketing Manager |
| S-0035 · "OK Computer" (1997) recorded largely at St Catherine's Court (RC-0018) | Radiohead official site — discography | Rolling Stone — "OK Computer" (500 Greatest Albums) | 2026-08-17 | Marketing Manager |
| S-0036 · Won Best Alternative Music Album Grammy 1998 (RC-0018) | Grammy.com — official winners | Britannica — "Radiohead" (entry) | 2026-08-17 | Marketing Manager |
| S-0037 · "Rumours" (1977) recorded amid the two couples' breakups (RC-0019) | Rolling Stone — "Rumours" (500 Greatest Albums) | Fleetwood Mac official site — biography | 2026-08-17 | Marketing Manager |
| S-0038 · Won Grammy Album of the Year 1978 (RC-0019) | Grammy.com — official winners | Britannica — "Fleetwood Mac" (entry) | 2026-08-17 | Marketing Manager |
| S-0039 · "Thriller" (1982) widely cited as best-selling album of all time (RC-0020) | RIAA — certification database | Britannica — "Thriller" (entry) | 2026-08-17 | Marketing Manager |
| S-0040 · Eight Grammys at the 1984 ceremony — then a record (RC-0020) | Grammy.com — official winners | Rock & Roll Hall of Fame — Michael Jackson (inductee) | 2026-08-17 | Marketing Manager |
| S-0041 · "Thriller" short film (1983) directed by John Landis, ~14 minutes (RC-0021) | Library of Congress — National Recording Registry ("Thriller") | Britannica — "Thriller" (entry) | 2026-08-17 | Marketing Manager |
| S-0042 · Defining MTV-era music-video moment (RC-0021) | Smithsonian — music video history | The Guardian — Thriller at 40 retrospectives | 2026-08-17 | Marketing Manager |
| S-0043 · "Purple Rain" (1984) released as album + film (RC-0022) | Britannica — "Purple Rain" (entry) | Prince official site — discography | 2026-08-17 | Marketing Manager |
| S-0044 · Prince won the 1985 Academy Award for Best Original Song Score (RC-0022) | Academy of Motion Picture Arts and Sciences — official winners | Rolling Stone — Prince retrospectives | 2026-08-17 | Marketing Manager |
| S-0045 · The Smiths formed Manchester 1982 (RC-0023) | Britannica — "The Smiths" (entry) | Rock & Roll Hall of Fame — The Smiths (inductee) | 2026-08-17 | Marketing Manager |
| S-0046 · Morrissey/Marr songwriting partnership (RC-0023) | Rock & Roll Hall of Fame — The Smiths (inductee) | The Smiths official site — biography | 2026-08-17 | Marketing Manager |
| S-0047 · Talking Heads formed at Rhode Island School of Design 1975 (RC-0024) | Rock & Roll Hall of Fame — Talking Heads (inductee) | Britannica — "Talking Heads" (entry) | 2026-08-17 | Marketing Manager |
| S-0048 · Byrne/Weymouth/Frantz, with Harrison completing lineup 1977 (RC-0024) | Rock & Roll Hall of Fame — Talking Heads (inductee) | Talking Heads official site — biography | 2026-08-17 | Marketing Manager |
| S-0049 · "Stop Making Sense" (1984) concert film directed by Jonathan Demme (RC-0025) | Library of Congress — National Film Registry ("Stop Making Sense") | The Criterion Collection — release notes | 2026-08-17 | Marketing Manager |
| S-0050 · Widely regarded as one of the greatest concert films (RC-0025) | Rolling Stone — greatest concert films | The Guardian — Stop Making Sense retrospectives | 2026-08-17 | Marketing Manager |
| S-0051 · "What's Going On" (1971) concept album; inspired by brother Frankie's Vietnam return (RC-0026) | Library of Congress — National Recording Registry ("What's Going On") | Britannica — "Marvin Gaye" (entry) | 2026-08-17 | Marketing Manager |
| S-0052 · Landmark of socially conscious soul (RC-0026) | Motown Museum — history | The Guardian — What's Going On at 50 retrospectives | 2026-08-17 | Marketing Manager |
| S-0053 · Stevie Wonder Album of the Year wins: "Innervisions" (1974), "Fulfillingness' First Finale" (1975), "Songs in the Key of Life" (1977) (RC-0027) | Grammy.com — official winners | Britannica — "Stevie Wonder" (entry) | 2026-08-17 | Marketing Manager |
| S-0054 · One of the most decorated AOTY runs in the award's history (RC-0027) | Grammy.com — records | Rock & Roll Hall of Fame — Stevie Wonder (inductee) | 2026-08-17 | Marketing Manager |
| S-0055 · Signed to Tamla/Motown at 11 as "Little Stevie Wonder" (RC-0028) | Motown Museum — history | Rock & Roll Hall of Fame — Stevie Wonder (inductee) | 2026-08-17 | Marketing Manager |
| S-0056 · "Fingertips" (1963) topped Hot 100 at age 13 — then a youngest-artist record (RC-0028) | Billboard — Hot 100 chart archive | Britannica — "Stevie Wonder" (entry) | 2026-08-17 | Marketing Manager |
| S-0057 · Bob Dylan awarded Nobel Prize in Literature 2016 (RC-0029) | Nobel Prize — official | Britannica — "Bob Dylan" (entry) | 2026-08-17 | Marketing Manager |
| S-0058 · Widely reported as the first songwriter-musician to receive it (RC-0029) | Nobel Prize — official press release | The Guardian — Nobel 2016 coverage | 2026-08-17 | Marketing Manager |
| S-0059 · "Like a Rolling Stone" (1965) over six minutes, from "Highway 61 Revisited" (RC-0030) | Rock & Roll Hall of Fame — "Like a Rolling Stone" (songs that shaped rock) | Library of Congress — National Recording Registry | 2026-08-17 | Marketing Manager |
| S-0060 · Widely credited with changing what a pop single could be (RC-0030) | Britannica — "Like a Rolling Stone" (entry) | Rolling Stone — 500 Greatest Songs | 2026-08-17 | Marketing Manager |
| S-0061 · "Exodus" (1977) recorded in London after the 1976 assassination attempt (RC-0031) | Britannica — "Bob Marley" (entry) | Bob Marley official site — biography | 2026-08-17 | Marketing Manager |
| S-0062 · Time named it album of the century in 1999 (RC-0031) | Time — "The Album of the Century" (1999) | Rolling Stone — Bob Marley retrospectives | 2026-08-17 | Marketing Manager |
| S-0063 · "Respect" (1967) #1; anthem of civil rights/women's movements (RC-0032) | Library of Congress — National Recording Registry ("Respect") | Rock & Roll Hall of Fame — Aretha Franklin (inductee) | 2026-08-17 | Marketing Manager |
| S-0064 · First woman inducted into the Rock & Roll Hall of Fame (1987) (RC-0032) | Rock & Roll Hall of Fame — Aretha Franklin (inductee) | Britannica — "Aretha Franklin" (entry) | 2026-08-17 | Marketing Manager |
| S-0065 · Hendrix closed Woodstock 1969 with instrumental "The Star-Spangled Banner" (RC-0033) | Library of Congress — National Recording Registry (Woodstock performance) | Smithsonian — Woodstock / Hendrix holdings | 2026-08-17 | Marketing Manager |
| S-0066 · One of the most discussed performances in rock history (RC-0033) | Britannica — "Jimi Hendrix" (entry) | Rock & Roll Hall of Fame — Jimi Hendrix (inductee) | 2026-08-17 | Marketing Manager |
| S-0067 · "Tommy" (1969) widely regarded as one of the first rock operas (RC-0034) | Rock & Roll Hall of Fame — The Who (inductee) | Britannica — "The Who" (entry) | 2026-08-17 | Marketing Manager |
| S-0068 · Double album telling a single story (RC-0034) | The Who official site — discography | Rolling Stone — 500 Greatest Albums | 2026-08-17 | Marketing Manager |
| S-0069 · "Pet Sounds" (1966) written/produced largely by Brian Wilson (RC-0035) | Britannica — "The Beach Boys" (entry) | Library of Congress — National Recording Registry ("Pet Sounds") | 2026-08-17 | Marketing Manager |
| S-0070 · Often credited with inspiring "Sgt. Pepper"; McCartney cited it as an influence (RC-0035) | Rolling Stone — Pet Sounds history | The Guardian — Pet Sounds retrospectives | 2026-08-17 | Marketing Manager |
| S-0071 · "The Joshua Tree" (1987) won Grammy Album of the Year 1988 (RC-0036) | Grammy.com — official winners | Rock & Roll Hall of Fame — U2 (inductee) | 2026-08-17 | Marketing Manager |
| S-0072 · Defining 1980s rock band (RC-0036) | Britannica — "U2" (entry) | U2 official site — discography | 2026-08-17 | Marketing Manager |
| S-0073 · Jon Landau 1974 review ("rock and roll's future") (RC-0037) | Rolling Stone — "Born to Run" (500 Greatest Albums) | Bruce Springsteen official site — biography | 2026-08-17 | Marketing Manager |
| S-0074 · "Born to Run" (1975) a defining record of the decade (RC-0037) | Rock & Roll Hall of Fame — Bruce Springsteen (inductee) | Britannica — "Born to Run" (entry) | 2026-08-17 | Marketing Manager |
| S-0075 · "Born in the U.S.A." (1984) produced seven top-ten Hot 100 singles (RC-0038) | Billboard — chart archive | Britannica — "Bruce Springsteen" (entry) | 2026-08-17 | Marketing Manager |
| S-0076 · One of the most successful chart runs for any album (RC-0038) | Bruce Springsteen official site — discography | Rolling Stone — album retrospectives | 2026-08-17 | Marketing Manager |
| S-0077 · "London Calling" (1979) double album mixing punk/reggae/rockabilly (RC-0039) | Rock & Roll Hall of Fame — The Clash (inductee) | Britannica — "The Clash" (entry) | 2026-08-17 | Marketing Manager |
| S-0078 · Named best album of the 1980s in Rolling Stone's 1989 list (RC-0039) | Rolling Stone — "The 100 Best Albums of the Eighties" (1989) | The Clash official site — discography | 2026-08-17 | Marketing Manager |
| S-0079 · Joy Division formed Manchester 1976; "Unknown Pleasures" (1979) with pulsar cover (RC-0040) | Rock & Roll Hall of Fame — Joy Division/New Order (inductee) | Britannica — "Joy Division" (entry) | 2026-08-17 | Marketing Manager |
| S-0080 · After Ian Curtis's death (1980), the rest became New Order (RC-0040) | Rock & Roll Hall of Fame — Joy Division/New Order (inductee) | Factory Records / Manchester music archive | 2026-08-17 | Marketing Manager |
| S-0081 · "That's All Right" (1954) recorded at Sam Phillips' Sun Studios, Memphis (RC-0041) | Rock & Roll Hall of Fame — "That's All Right" (songs that shaped rock) | Smithsonian — Sun Records holdings | 2026-08-17 | Marketing Manager |
| S-0082 · Often cited as the birth of Elvis's career (RC-0041) | Britannica — "Elvis Presley" (entry) | Memphis Rock 'n' Soul Museum — Sun Studio history | 2026-08-17 | Marketing Manager |
| S-0083 · "(Sittin' On) The Dock of the Bay" (1968) written with Steve Cropper; first US #1 (RC-0042) | Library of Congress — National Recording Registry ("Dock of the Bay") | Billboard — Hot 100 chart archive | 2026-08-17 | Marketing Manager |
| S-0084 · Released after Redding's death in the December 1967 plane crash; "often cited as first posthumous #1 of the Hot 100 era" framing (RC-0042) | Rock & Roll Hall of Fame — Otis Redding (inductee) | Britannica — "Otis Redding" (entry) | 2026-08-17 | Marketing Manager |
| S-0085 · "A Change Is Gonna Come" (1964) written after being turned away from a Louisiana motel (RC-0043) | Library of Congress — National Recording Registry ("A Change Is Gonna Come") | Smithsonian — Sam Cooke holdings | 2026-08-17 | Marketing Manager |
| S-0086 · Landmark song of the civil rights era (RC-0043) | Britannica — "Sam Cooke" (entry) | Rock & Roll Hall of Fame — Sam Cooke (inductee) | 2026-08-17 | Marketing Manager |
| S-0087 · Velvet Underground debut "…& Nico" (1967) produced by Andy Warhol; banana cover (RC-0044) | Rock & Roll Hall of Fame — The Velvet Underground (inductee) | Britannica — "The Velvet Underground" (entry) | 2026-08-17 | Marketing Manager |
| S-0088 · Sold few copies on release; now regarded as hugely influential (RC-0044) | The Andy Warhol Museum — collection notes | Rolling Stone — 500 Greatest Albums | 2026-08-17 | Marketing Manager |
| S-0089 · "Random Access Memories" (2013) won Grammy Album of the Year 2014 (RC-0045) | Grammy.com — official winners | Britannica — "Daft Punk" (entry) | 2026-08-17 | Marketing Manager |
| S-0090 · Landmark win for an electronic dance-music record (RC-0045) | Rolling Stone — Daft Punk retrospectives | The Guardian — RAM reviews/features | 2026-08-17 | Marketing Manager |
| S-0091 · "Back to Black" (2006) won five Grammys at the 2008 ceremony, incl. Record of the Year (RC-0046) | Grammy.com — official winners | Britannica — "Amy Winehouse" (entry) | 2026-08-17 | Marketing Manager |
| S-0092 · Tied the then-record for most wins by a female artist in one night (RC-0046) | Grammy.com — records | Rolling Stone — Amy Winehouse retrospectives | 2026-08-17 | Marketing Manager |
| S-0093 · "21" (2011) won six Grammys at the 2012 ceremony, incl. Album of the Year (RC-0047) | Grammy.com — official winners | Britannica — "Adele" (entry) | 2026-08-17 | Marketing Manager |
| S-0094 · Tied the then-record for a female artist in a single night (RC-0047) | Grammy.com — records | The Guardian — Adele features | 2026-08-17 | Marketing Manager |
| S-0095 · Sub Pop founded Seattle 1988 (RC-0048) | Sub Pop official — label history | Britannica — "Sub Pop" (entry) | 2026-08-17 | Marketing Manager |
| S-0096 · Released Nirvana's "Bleach" (1989); label most associated with grunge (RC-0048) | Sub Pop official — discography | Rock & Roll Hall of Fame — Nirvana (inductee) | 2026-08-17 | Marketing Manager |
| S-0097 · Sun Records founded by Sam Phillips in Memphis 1952 (RC-0049) | Memphis Rock 'n' Soul Museum — Sun Studio history | Rock & Roll Hall of Fame — Sam Phillips (inductee) | 2026-08-17 | Marketing Manager |
| S-0098 · Roster: Presley, Cash, Lewis, Perkins, Orbison; shaped early rock and roll (RC-0049) | Britannica — "Sun Records" (entry) | Rock & Roll Hall of Fame — inductee profiles | 2026-08-17 | Marketing Manager |
| S-0099 · Stax Records, Memphis "Soulsville USA," landmark 1960s soul (RC-0050) | Stax Museum of American Soul Music — official | Britannica — "Stax Records" (entry) | 2026-08-17 | Marketing Manager |
| S-0100 · Roster: Otis Redding, Booker T. & the M.G.'s, Isaac Hayes (RC-0050) | Stax Museum of American Soul Music — official | Rock & Roll Hall of Fame — Otis Redding / Booker T. (inductee) | 2026-08-17 | Marketing Manager |

## Source bibliography (stable references)

Institution/archive sources are preferred (RIAA, Grammy.com, Library of
Congress, Smithsonian, Rock & Roll Hall of Fame, official artist/label sites)
and re-checked each sweep. Full URLs are recorded in the pack handoff (see
`localization-notes.md` for the locales where a source needs a local edition).

## Open ledger items

- **RC-0015 (`[FACT]` hedged)** — "Nevermind replaced 'Dangerous' at #1" is a
  dated, documented Billboard event (Jan 1992), not a fluctuating claim; the
  chart-position language is kept as history, not as a live stat.
- **RC-0020 (`[FACT]` hedged)** — "best-selling album of all time" ships as
  "widely cited" (RIAA + Britannica) with no fluctuating sales number; the
  8-Grammy "then-record" framing is dated and durable.
- **RC-0027 (`[FACT]`)** — Stevie Wonder's three AOTY wins are dated and
  durable; phrasing deliberately avoids "consecutive" and "first" (Sinatra
  also won three).
- **RC-0042 (`[FACT]` hedged)** — posthumous-#1 framing ships as "often
  cited," never asserted as the absolute first; re-check at the next sweep.
