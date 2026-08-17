# Source ledger — books-core pack

The ledger for every claim in `books-core/pack.json` (BC-0001…BC-0030).
Format (mandatory, one row per claim):

```text
{ claim, source1, source2, lastVerified, verifiedBy }
```

Rules (see `lore-layer-plan.md` §3): **two independent sources** per claim;
`source1`/`source2` are stable references (institution/archive/publisher
preferred); `lastVerified` is the ISO date of the most recent verification
sweep; `verifiedBy` is the human/role who verified. The quarterly fact-sweep
updates `lastVerified` and retires anything that stopped being true.

Work item: `(FEAT-EPIC-5, #277)` — Halcova Library lore content packs.

## Ledger

| Claim | Source 1 | Source 2 | Last verified | Verified by |
| --- | --- | --- | --- | --- |
| S-0001 · Orwell wrote "Nineteen Eighty-Four" (1949) on the island of Jura (BC-0001) | Britannica — "Nineteen Eighty-Four" (entry) | The Orwell Foundation (official) | 2026-08-17 | Marketing Manager |
| S-0002 · "Big Brother" entered the English language (BC-0001) | Oxford English Dictionary — "Big Brother" (usage) | The Orwell Foundation (official) | 2026-08-17 | Marketing Manager |
| S-0003 · "Animal Farm" (1945) allegory of the Russian Revolution/Stalinism (BC-0002) | The Orwell Foundation (official) | Britannica — "Animal Farm" (entry) | 2026-08-17 | Marketing Manager |
| S-0004 · Rejected by several publishers incl. Faber (T.S. Eliot was an editor) before acceptance (BC-0002) | The Orwell Foundation (official) | British Library — Orwell collection notes | 2026-08-17 | Marketing Manager |
| S-0005 · Austen published anonymously; "By a Lady" (BC-0003) | Jane Austen's House Museum (official) | Britannica — "Jane Austen" (entry) | 2026-08-17 | Marketing Manager |
| S-0006 · "Pride and Prejudice" (1813) second published novel, after "Sense and Sensibility" (1811) (BC-0003) | Jane Austen's House Museum (official) | British Library — Jane Austen | 2026-08-17 | Marketing Manager |
| S-0007 · "Emma" (1815) dedicated to the Prince Regent at his librarian's request (BC-0004) | Jane Austen's House Museum (official) | British Library — Jane Austen | 2026-08-17 | Marketing Manager |
| S-0008 · Austen was known to dislike the Prince Regent (BC-0004) | Jane Austen's House Museum (official) | Britannica — "Jane Austen" (entry) | 2026-08-17 | Marketing Manager |
| S-0009 · "The Lord of the Rings" (1954–55) grew from "The Hobbit" (1937), written for his children (BC-0005) | Britannica — "The Lord of the Rings" (entry) | Bodleian Libraries — Tolkien exhibition | 2026-08-17 | Marketing Manager |
| S-0010 · Tolkien wrote both as a professor at Oxford (BC-0005) | Bodleian Libraries — Tolkien exhibition | The Tolkien Society (official) | 2026-08-17 | Marketing Manager |
| S-0011 · Tolkien and C.S. Lewis were members of the Inklings (BC-0006) | The Tolkien Society (official) | Britannica — "C.S. Lewis" (entry) | 2026-08-17 | Marketing Manager |
| S-0012 · The Inklings read works in progress aloud (BC-0006) | The Tolkien Society (official) | Oxford — Inklings archive/history | 2026-08-17 | Marketing Manager |
| S-0013 · "Philosopher's Stone" rejected by several publishers before Bloomsbury (1997) (BC-0007) | Bloomsbury (official) — Harry Potter publishing history | J.K. Rowling official site | 2026-08-17 | Marketing Manager |
| S-0014 · Published in the US as "Sorcerer's Stone" (1998) (BC-0007) | Scholastic (official) — US edition | British Library — Harry Potter exhibition | 2026-08-17 | Marketing Manager |
| S-0015 · "The Handmaid's Tale" (1985) dystopian novel; won Governor General's Literary Award for fiction 1985 (BC-0008) | Governor General's Literary Awards (official) | Britannica — "Margaret Atwood" (entry) | 2026-08-17 | Marketing Manager |
| S-0016 · Adapted into a TV series in 2017 (BC-0008) | Britannica — "The Handmaid's Tale" (entry) | Penguin Random House — Atwood author page | 2026-08-17 | Marketing Manager |
| S-0017 · "Carrie" (1974) first published novel; made King a bestselling author (BC-0009) | Stephen King official site | Britannica — "Stephen King" (entry) | 2026-08-17 | Marketing Manager |
| S-0018 · Grew from a short story at his wife's suggestion (BC-0009) | Stephen King official site | The Guardian — Carrie retrospective features | 2026-08-17 | Marketing Manager |
| S-0019 · "The Shining" (1977) inspired by the Stanley Hotel, Colorado (BC-0010) | Stephen King official site | The Stanley Hotel (official) — history | 2026-08-17 | Marketing Manager |
| S-0020 · The Overlook Hotel drawn from the Stanley (BC-0010) | The Stanley Hotel (official) | Britannica — "The Shining" (entry) | 2026-08-17 | Marketing Manager |
| S-0021 · "The Old Man and the Sea" (1952) won the Pulitzer Prize for Fiction 1953 (BC-0011) | Pulitzer Prizes (official) | Britannica — "The Old Man and the Sea" (entry) | 2026-08-17 | Marketing Manager |
| S-0022 · Nobel Prize in Literature 1954 citing the novella (BC-0011) | Nobel Prize (official) | Hemingway Society (official) | 2026-08-17 | Marketing Manager |
| S-0023 · "The Sun Also Rises" (1926) first novel; captured the "Lost Generation" (BC-0012) | Hemingway Society (official) | Britannica — "The Sun Also Rises" (entry) | 2026-08-17 | Marketing Manager |
| S-0024 · 1920s Paris expatriate circle incl. Fitzgerald and Gertrude Stein (BC-0012) | Britannica — "Ernest Hemingway" (entry) | Hemingway Society (official) | 2026-08-17 | Marketing Manager |
| S-0025 · "The Great Gatsby" (1925) portrait of the Jazz Age; sold modestly in his lifetime (BC-0013) | Britannica — "The Great Gatsby" (entry) | F. Scott Fitzgerald Society (official) | 2026-08-17 | Marketing Manager |
| S-0026 · Now a cornerstone of American literature; among the most-taught novels in the US (BC-0013) | F. Scott Fitzgerald Society (official) | Library of America — Fitzgerald editions | 2026-08-17 | Marketing Manager |
| S-0027 · "This Side of Paradise" (1920) debut; made Fitzgerald famous at 23 (BC-0014) | F. Scott Fitzgerald Society (official) | Britannica — "F. Scott Fitzgerald" (entry) | 2026-08-17 | Marketing Manager |
| S-0028 · Helped define the "Jazz Age" generation (BC-0014) | Britannica — "F. Scott Fitzgerald" (entry) | Library of America — Fitzgerald editions | 2026-08-17 | Marketing Manager |
| S-0029 · García Márquez awarded the Nobel Prize in Literature 1982 (BC-0015) | Nobel Prize (official) | Britannica — "Gabriel García Márquez" (entry) | 2026-08-17 | Marketing Manager |
| S-0030 · Prize cited his novels and short stories incl. "One Hundred Years of Solitude" (BC-0015) | Nobel Prize (official) | Instituto Cervantes — García Márquez | 2026-08-17 | Marketing Manager |
| S-0031 · "One Hundred Years of Solitude" (1967) first published by Editorial Sudamericana, Buenos Aires (BC-0016) | Editorial Sudamericana / Penguin Random House — publishing history | Britannica — "One Hundred Years of Solitude" (entry) | 2026-08-17 | Marketing Manager |
| S-0032 · Widely considered a defining work of magical realism (BC-0016) | Britannica — "magical realism" (entry) | Real Academia Española — literary references | 2026-08-17 | Marketing Manager |
| S-0033 · "Norwegian Wood" (1987) became a bestseller in Japan (BC-0017) | Britannica — "Haruki Murakami" (entry) | The Guardian — Murakami profile features | 2026-08-17 | Marketing Manager |
| S-0034 · Preceded his international fame in the 1990s (BC-0017) | Britannica — "Haruki Murakami" (entry) | Penguin — Murakami author page | 2026-08-17 | Marketing Manager |
| S-0035 · "The Left Hand of Darkness" (1969) won the Hugo Award (BC-0018) | The Hugo Awards (official) | Britannica — "Ursula K. Le Guin" (entry) | 2026-08-17 | Marketing Manager |
| S-0036 · Won the Nebula Award — a rare double; landmark exploring gender and society (BC-0018) | The Nebula Awards (official) | Ursula K. Le Guin official site | 2026-08-17 | Marketing Manager |
| S-0037 · Earthsea series began with "A Wizard of Earthsea" (1968) (BC-0019) | Britannica — "Ursula K. Le Guin" (entry) | Ursula K. Le Guin official site | 2026-08-17 | Marketing Manager |
| S-0038 · Helped establish fantasy as serious literary territory (BC-0019) | Ursula K. Le Guin official site | Penguin — Earthsea edition history | 2026-08-17 | Marketing Manager |
| S-0039 · Christie widely cited as the best-selling fiction writer of all time (BC-0020) | Guinness World Records | Agatha Christie official site | 2026-08-17 | Marketing Manager |
| S-0040 · "The Mousetrap" running continuously in London since 1952; longest-running play in history (BC-0020) | The Mousetrap (official, London) | Guinness World Records | 2026-08-17 | Marketing Manager |
| S-0041 · Christie wrote part of "Murder on the Orient Express" (1934) at the Pera Palace Hotel, Istanbul (BC-0021) | Pera Palace Hotel (official) — history | Agatha Christie official site | 2026-08-17 | Marketing Manager |
| S-0042 · The hotel keeps a room named for her (BC-0021) | Pera Palace Hotel (official) | Agatha Christie official site | 2026-08-17 | Marketing Manager |
| S-0043 · "Beloved" (1987) won the Pulitzer Prize for Fiction 1988 (BC-0022) | Pulitzer Prizes (official) | Britannica — "Toni Morrison" (entry) | 2026-08-17 | Marketing Manager |
| S-0044 · 1993: first Black woman to receive the Nobel Prize in Literature (BC-0022) | Nobel Prize (official) | The Nobel Prize — Morrison profile | 2026-08-17 | Marketing Manager |
| S-0045 · "Mrs Dalloway" (1925) unfolds over a single day in London (BC-0023) | Britannica — "Mrs. Dalloway" (entry) | British Library — Virginia Woolf | 2026-08-17 | Marketing Manager |
| S-0046 · Landmark of modernist stream-of-consciousness fiction (BC-0023) | British Library — Virginia Woolf | Britannica — "modernism" (entry) | 2026-08-17 | Marketing Manager |
| S-0047 · "Fahrenheit 451" (1953) written largely in the UCLA library basement on a rented typewriter (BC-0024) | Ray Bradbury official / Center for Ray Bradbury Studies | Britannica — "Ray Bradbury" (entry) | 2026-08-17 | Marketing Manager |
| S-0048 · Named for the temperature at which paper catches fire; about a future where books are burned (BC-0024) | Britannica — "Fahrenheit 451" (entry) | Ray Bradbury official site | 2026-08-17 | Marketing Manager |
| S-0049 · "Slaughterhouse-Five" (1969) draws on Vonnegut's POW experience of the Dresden firebombing (1945) (BC-0025) | Kurt Vonnegut official / Vonnegut Museum | Britannica — "Slaughterhouse-Five" (entry) | 2026-08-17 | Marketing Manager |
| S-0050 · Most famous Vonnegut novel (BC-0025) | Kurt Vonnegut official site | The Guardian — Vonnegut retrospectives | 2026-08-17 | Marketing Manager |
| S-0051 · "To Kill a Mockingbird" (1960) first novel; won the Pulitzer Prize for Fiction 1961 (BC-0026) | Pulitzer Prizes (official) | Britannica — "To Kill a Mockingbird" (entry) | 2026-08-17 | Marketing Manager |
| S-0052 · Among the most widely read and taught American novels (BC-0026) | Harper Lee official / publisher page | The Guardian — Mockingbird features | 2026-08-17 | Marketing Manager |
| S-0053 · "Foundation" grew from 1940s stories into a trilogy in the early 1950s (BC-0027) | Isaac Asimov official site | Britannica — "Isaac Asimov" (entry) | 2026-08-17 | Marketing Manager |
| S-0054 · Robot stories introduced the "Three Laws of Robotics," a sci-fi touchstone (BC-0027) | Isaac Asimov official site | Science Fiction and Fantasy Writers — reference | 2026-08-17 | Marketing Manager |
| S-0055 · "Dune" (1965) set on Arrakis; won the Nebula Award and shared the Hugo Award 1966 (BC-0028) | The Nebula Awards (official) | The Hugo Awards (official) | 2026-08-17 | Marketing Manager |
| S-0056 · Adapted for film multiple times, most recently 2021 (BC-0028) | Britannica — "Dune" (entry) | Legendary/Warner Bros — film release history | 2026-08-17 | Marketing Manager |
| S-0057 · "Brave New World" (1932) takes its title from "The Tempest" (BC-0029) | Britannica — "Brave New World" (entry) | The Shakespeare Birthplace Trust — "The Tempest" | 2026-08-17 | Marketing Manager |
| S-0058 · Novel about a sterilized future society (BC-0029) | Britannica — "Brave New World" (entry) | Aldous Huxley Society (official) | 2026-08-17 | Marketing Manager |
| S-0059 · "A Christmas Carol" (1843) written in about six weeks, published in time for Christmas (BC-0030) | Charles Dickens Museum (official) | Britannica — "A Christmas Carol" (entry) | 2026-08-17 | Marketing Manager |
| S-0060 · Immediate success; helped revive interest in Victorian Christmas traditions (BC-0030) | Charles Dickens Museum (official) | British Library — Dickens | 2026-08-17 | Marketing Manager |

## Source bibliography (stable references)

Institution/archive sources are preferred (British Library, Bodleian,
museum sites, official award bodies, publisher records) and re-checked each
sweep. Full URLs are recorded in the pack handoff (see
`localization-notes.md` for the locales where a source needs a local edition).

## Open ledger items

- **BC-0020 (`[FACT]` hedged)** — "best-selling fiction writer of all time"
  ships as "widely cited" (Guinness) with no fluctuating sales number; the
  Mousetrap "longest-running play" record is durable and documented.
- **BC-0022 (`[FACT]`)** — "first Black woman to receive the Nobel Prize in
  Literature" is a dated, durable, widely documented record (1993).
- **BC-0008 / BC-0009 / BC-0010 / BC-0017 (`[FACT]` living authors)** — Atwood,
  King, and Murakami are living; every entry ships only sourced,
  non-defamatory, public-record facts. No speculation, no private-life detail.
- **BC-0001 (voice)** — "Big Brother moved into the dictionary" is a voice
  line; the OED-source fact is the phrase entering English usage.
