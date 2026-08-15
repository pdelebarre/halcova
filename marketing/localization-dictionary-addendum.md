# Localization Dictionary — Addendum v1.1 (new keys · `[VALIDATE]` native testers)

**Owner:** Marketing Manager · **Status:** self-review pass applied (2026-08-15) —
EN is the shipped baseline; FR/NL/PT-BR/DE/ES/IT still need human native
confirmation before shipping. Proper nouns stay as-is: `Halcova`, `Discogs`, `Google Books`,
`ISBN`. `{name}` / `{n}` / `{date}` / `{collectionLabel}` are interpolation
placeholders. `en-GB` inherits `en` for every key here (no GB/US divergence).

**Covers the keys introduced in:**
- `specs/activation-scan-and-onboarding.md` (C1 "Add & scan next" + C2 onboarding)
- `specs/lending-polish-and-reminders.md` (A5 lending polish + B5 Phase 1 "Remind")

**Branch:** attach to the feature branches (`feat/scan-add-loop`,
`feat/lending-polish`); merge the master strings into `feat/localization`.

---

## 0. Glossary notes (read before translating)

1. **`{collectionLabel}`** resolves to the existing per-locale terms already in
   the v1 dictionary — do not re-translate:
   - crate: en `crate` · fr `bac` · nl `krat` · pt-BR `caixa` · de `Kiste` · es `caja` · it `cassa`
   - shelf: en `shelf` · fr `étagère` · nl `plank` · pt-BR `estante` · de `Regal` · es `estante` · it `scaffale`
2. **`emptySteps`** is a 3-item array assembled from `emptyStep1/2/3`. Keep the
   imperative/infinitive voice consistent within each language. **`emptyStep3`
   deliberately uses the generic "collection" noun — not `{collectionLabel}` —**
   to avoid gender/article agreement errors in DE and IT ("deiner Kiste" vs
   "deinem Regal"; "nella cassa" vs "nello scaffale"). This matches the existing
   `catalog.emptyTitle` convention (`Sammlung` / `collezione` / `collection`).
3. **`remindMessage`** is assembled at runtime: a **base** sentence + an
   **optional due clause** appended only when `dueOn` is set. Translate both
   parts separately; keep a space before the due clause.
4. **FR tu/vous:** the Remind message uses informal **tu** (a peer nudge to a
   friend). If brand voice stays formal (`vous`, as in the auth screen), switch
   to the `vous` form flagged in §2.
5. **`{n}` plural caveats:** `addedCount`, `overdueCount` use a past participle
   / invariant form in most languages so `{n}=1` reads correctly. ES `overdueCount`
   uses the count-label form `Atrasados: {n}` (invariant); native testers to
   confirm it reads okay at `{n}=1`.
6. **Pre-existing finding for the dev (not introduced here):** the shipped
   `catalog.*` strings interpolate `{collectionLabel}` as the raw English noun
   (`crate` / `shelf`), and DE uses `dein`/`deinem` which do not agree with a
   feminine `Kiste`. This is a latent i18n bug in existing keys — verify before
   adding more `{collectionLabel}` strings in DE/IT.

---

## 1. Activation (C1 + C2)

| Key | en | fr | nl | pt-BR | de | es | it |
| --- | --- | --- | --- | --- | --- | --- | --- |
| catalog.addAndScanNext | Add & scan next | Ajouter & scanner le suivant | Toevoegen & doorgaan met scannen | Adicionar & escanear o próximo | Hinzufügen & weiter scannen | Añadir y escanear el siguiente | Aggiungi & scansiona il prossimo |
| catalog.addedCount | Added — {n} today | Ajouté — {n} aujourd'hui | Toegevoegd — {n} vandaag | Adicionado — {n} hoje | Hinzugefügt — {n} heute | Añadido — {n} hoy | Aggiunto — {n} oggi |
| catalog.emptyStep1 | Scan the barcode | Scanner le code-barres | Scan de streepjescode | Escanear o código de barras | Barcode scannen | Escanea el código de barras | Scansiona il codice a barre |
| catalog.emptyStep2 | Confirm the match | Confirmer le résultat | Bevestig het resultaat | Confirmar a correspondência | Treffer bestätigen | Confirma la coincidencia | Conferma la corrispondenza |
| catalog.emptyStep3 | Done — it's in your collection | Terminé — c'est dans votre collection | Klaar — het staat in je collectie | Pronto — está na sua coleção | Fertig — es steht in deiner Sammlung | Listo — está en tu colección | Fatto — ora è nella tua collezione |
| catalog.trySample | Try a sample | Essayer un exemple | Probeer een voorbeeld | Experimentar um exemplo | Beispiel ausprobieren | Probar un ejemplo | Prova un esempio |
| catalog.trySampleNote | This is a sample — add your own item to start your collection. | Ceci est un exemple — ajoutez votre propre article pour commencer votre collection. | Dit is een voorbeeld — voeg je eigen item toe om je collectie te starten. | Este é um exemplo — adicione seu próprio item para começar sua coleção. | Das ist ein Beispiel — füge dein eigenes Item hinzu, um deine Sammlung zu starten. | Esto es un ejemplo — añade tu propio artículo para empezar tu colección. | Questo è un esempio — aggiungi il tuo articolo per iniziare la tua collezione. |
| catalog.noTokenHint | Records lookups need a Discogs token — add yours in Settings. | La recherche de disques nécessite un jeton Discogs — ajoutez le vôtre dans Réglages. | Voor platen heb je een Discogs-token nodig — voeg de jouwe toe in Instellingen. | A busca de discos precisa de um token do Discogs — adicione o seu em Configurações. | Für Platten wird ein Discogs-Token benötigt — füge deins in den Einstellungen hinzu. | La búsqueda de discos requiere un token de Discogs — añade el tuyo en Ajustes. | La ricerca dei dischi richiede un token Discogs — aggiungi il tuo nelle Impostazioni. |

---

## 2. Lending (A5 + B5 Phase 1)

| Key | en | fr | nl | pt-BR | de | es | it |
| --- | --- | --- | --- | --- | --- | --- | --- |
| lending.remind | Remind | Rappeler | Herinner | Lembrar | Erinnern | Recordar | Ricorda |
| lending.remindMessage.base | Hey {name} — just checking in on “{title}” I lent you. 😊 | Salut {name} — je pensais juste au « {title} » que je t'ai prêté. 😊 *(vous: je pensais juste au « {title} » que je vous ai prêté.)* | Hoi {name} — ik dacht even aan de “{title}” die ik je heb uitgeleend. 😊 | Oi {name} — só passando para lembrar do “{title}” que te emprestei. 😊 | Hey {name} — ich wollte kurz an „{title}“ erinnern, das ich dir geliehen habe. 😊 | Hola {name} — solo te recuerdo el “{title}” que te presté. 😊 | Ciao {name} — ti scrivo per il “{title}” che ti ho prestato. 😊 |
| lending.remindMessage.due |  It was due {date}. |  Il devait être rendu le {date}. |  Het zou op {date} terug moeten zijn. |  A devolução era para {date}. |  Es sollte bis {date} zurück sein. |  La devolución era para el {date}. |  Andava restituito il {date}. |
| lending.remindCopied | Message copied — send it to {name} | Message copié — envoyez-le à {name} | Bericht gekopieerd — stuur het naar {name} | Mensagem copiada — envie para {name} | Nachricht kopiert — an {name} senden | Mensaje copiado — envíalo a {name} | Messaggio copiato — invialo a {name} |
| lending.due1w | 1 week | 1 semaine | 1 week | 1 semana | 1 Woche | 1 semana | 1 settimana |
| lending.due2w | 2 weeks | 2 semaines | 2 weken | 2 semanas | 2 Wochen | 2 semanas | 2 settimane |
| lending.due1m | 1 month | 1 mois | 1 maand | 1 mês | 1 Monat | 1 mes | 1 mese |
| lending.overdueCount | {n} overdue | {n} en retard | {n} te laat | {n} em atraso | {n} überfällig | Atrasados: {n} | {n} in ritardo |
| lending.historyCapNote | History keeps the last 10 loans. | L'historique conserve les 10 derniers prêts. | De geschiedenis bewaart de laatste 10 uitleningen. | O histórico mantém os últimos 10 empréstimos. | Der Verlauf speichert die letzten 10 Ausleihen. | El historial guarda los últimos 10 préstamos. | La cronologia conserva gli ultimi 10 prestiti. |
| lending.contactCall | Call | Appeler | Bellen | Ligar | Anrufen | Llamar | Chiama |
| lending.contactEmail | Email | E-mail | E-mail | E-mail | E-Mail | Correo | Email |
| lending.contactMessage | Message | Message | Bericht | Mensagem | Nachricht | Mensaje | Messaggio |

---

## Open items `[VALIDATE]`

1. Human native-speaker confirmation on all 6 locales (FR/NL/PT-BR/DE/ES/IT) —
   the self-review below fixed agreement and voice issues, but a human pass is still required.
2. ES `overdueCount` count-label form `Atrasados: {n}` — confirm it reads okay at `{n}=1`.
3. FR `tu` vs `vous` decision for the Remind message — confirm with brand voice.
4. `contactEmail` label verb vs noun in NL (`E-mail` vs `E-mailen`) and IT (`Email` vs `Invia email`) — confirm the short button form is clear.
5. Pre-existing `{collectionLabel}` interpolation bug in DE/IT `catalog.*` strings (raw English noun + gender mismatch) — file a dev ticket to fix before adding more such strings.
