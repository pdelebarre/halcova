# Localization Dictionary — v1 (draft · `[VALIDATE]` native testers)

**Owner:** Marketing Manager · **Status:** v1 draft — EN is the shipped
baseline; FR/NL/PT-BR/DE/ES/IT must be confirmed by the native testers before
shipping. Proper nouns stay as-is in all languages: `Alcove`, `Discogs`,
`Google Books`, `ISBN`, the `RU-…` code format. The `{name}`/`{n}`/`{date}`
markers are interpolation placeholders.
**Branch:** `feat/localization` · **Plan:** `localization-plan.md`

---

## 0. Language names (endonyms — same in every locale, used in the switcher)

| Key | en | fr | nl | pt-BR | de | es | it |
| --- | --- | --- | --- | --- | --- | --- | --- |
| languageName | English | Français | Nederlands | Português (Brasil) | Deutsch | Español | Italiano |

---

## 1. Common

| Key | en | fr | nl | pt-BR | de | es | it |
| --- | --- | --- | --- | --- | --- | --- | --- |
| common.close | Close | Fermer | Sluiten | Fechar | Schließen | Cerrar | Chiudi |
| common.cancel | Cancel | Annuler | Annuleren | Cancelar | Abbrechen | Cancelar | Annulla |
| common.done | Done | Terminé | Klaar | Concluído | Fertig | Hecho | Fatto |
| common.back | Back | Retour | Terug | Voltar | Zurück | Atrás | Indietro |
| common.loading | Loading… | Chargement… | Laden… | Carregando… | Wird geladen… | Cargando… | Caricamento… |
| common.retry | Retry | Réessayer | Opnieuw | Tentar de novo | Erneut versuchen | Reintentar | Riprova |
| common.tryAgain | Try again | Réessayer | Probeer opnieuw | Tente novamente | Erneut versuchen | Inténtalo de nuevo | Riprova |
| common.save | Save | Enregistrer | Opslaan | Salvar | Speichern | Guardar | Salva |
| common.signOut | Sign out | Se déconnecter | Uitloggen | Sair | Abmelden | Cerrar sesión | Esci |
| common.settings | Settings | Réglages | Instellingen | Configurações | Einstellungen | Ajustes | Impostazioni |
| common.adminPanel | Admin panel | Panneau admin | Beheerpaneel | Painel admin | Admin-Bereich | Panel de administración | Pannello admin |
| common.scan | Scan | Scanner | Scannen | Escanear | Scannen | Escanear | Scansiona |
| common.search | Search | Rechercher | Zoeken | Pesquisar | Suchen | Buscar | Cerca |
| common.by | by | par | door | por | von | por | di |

---

## 2. Kinds & tags (used in tabs, admin switches, aria)

| Key | en | fr | nl | pt-BR | de | es | it |
| --- | --- | --- | --- | --- | --- | --- | --- |
| kind.records | Records | Disques | Platen | Discos | Platten | Discos | Dischi |
| kind.books | Books | Livres | Boeken | Livros | Bücher | Libros | Libri |
| kind.recordsAccess | Records access | Accès disques | Platen-toegang | Acesso a discos | Platten-Zugang | Acceso a discos | Accesso ai dischi |
| kind.booksAccess | Books access | Accès livres | Boeken-toegang | Acesso a livros | Bücher-Zugang | Acceso a libros | Accesso ai libri |

---

## 3. Auth screen

| Key | en | fr | nl | pt-BR | de | es | it |
| --- | --- | --- | --- | --- | --- | --- | --- |
| auth.tagline | your crate & shelf, cataloged | votre bac à disques et votre étagère, répertoriés | je platen en boeken, gecatalogiseerd | seu acervo de discos e livros, catalogado | deine Plattenkiste und dein Regal, katalogisiert | tu colección de discos y libros, catalogada | i tuoi dischi e libri, catalogati |
| auth.haveCode | I have an access code | J'ai un code d'accès | Ik heb een toegangscode | Eu tenho um código de acesso | Ich habe einen Zugangscode | Tengo un código de acceso | Ho un codice di accesso |
| auth.requestAccess | Request access | Demander l'accès | Toegang aanvragen | Solicitar acesso | Zugang beantragen | Solicitar acceso | Richiedi accesso |
| auth.enterCode | Enter the access code the admin gave you. | Saisissez le code d'accès que l'admin vous a donné. | Voer de toegangscode in die de beheerder je gaf. | Digite o código de acesso que o admin te deu. | Gib den Zugangscode ein, den du vom Admin bekommen hast. | Introduce el código de acceso que te dio el administrador. | Inserisci il codice di accesso che ti ha dato l'amministratore. |
| auth.pasteTip | Tip: paste your access code — it's case-sensitive | Astuce : collez votre code d'accès — il est sensible à la casse | Tip: plak je toegangscode — hoofdlettergevoelig | Dica: cole seu código de acesso — ele diferencia maiúsculas | Tipp: Füge deinen Zugangscode ein — er unterscheidet Groß-/Kleinschreibung | Consejo: pega tu código de acceso: distingue mayúsculas | Suggerimento: incolla il tuo codice di accesso — fa distinzione tra maiuscole e minuscole |
| auth.signIn | Sign in | Se connecter | Inloggen | Entrar | Anmelden | Iniciar sesión | Accedi |
| auth.signingIn | Signing in… | Connexion… | Inloggen… | Entrando… | Anmelden… | Iniciando sesión… | Accesso… |
| auth.requestToStart | Request access to start cataloging. The admin will approve your account and send you an access code. | Demandez l'accès pour commencer à répertorier. L'admin approuvera votre compte et vous enverra un code d'accès. | Vraag toegang aan om te beginnen met catalogiseren. De beheerder keurt je account goed en stuurt je een toegangscode. | Solicite acesso para começar a catalogar. O admin aprovará sua conta e enviará um código de acesso. | Beantrage Zugang, um mit dem Katalogisieren zu beginnen. Der Admin genehmigt dein Konto und schickt dir einen Zugangscode. | Solicita acceso para empezar a catalogar. El administrador aprobará tu cuenta y te enviará un código de acceso. | Richiedi l'accesso per iniziare a catalogare. L'amministratore approverà il tuo account e ti invierà un codice di accesso. |
| auth.yourName | Your name | Votre nom | Je naam | Seu nome | Dein Name | Tu nombre | Il tuo nome |
| auth.requesting | Requesting… | Demande… | Aanvragen… | Solicitando… | Wird angefragt… | Solicitando… | Invio richiesta… |
| auth.requestSent | Request sent ✉️ | Demande envoyée ✉️ | Aanvraag verzonden ✉️ | Solicitação enviada ✉️ | Anfrage gesendet ✉️ | Solicitud enviada ✉️ | Richiesta inviata ✉️ |
| auth.requestSentBody | The admin will review it and send you an access code. Once you have it, come back and sign in. | L'admin l'examinera et vous enverra un code d'accès. Dès que vous l'avez, revenez vous connecter. | De beheerder bekijkt het en stuurt je een toegangscode. Kom daarna terug om in te loggen. | O admin vai analisar e enviar um código de acesso. Quando receber, volte e entre. | Der Admin prüft das und schickt dir einen Zugangscode. Sobald du ihn hast, melde dich wieder an. | El administrador lo revisará y te enviará un código de acceso. Cuando lo tengas, vuelve e inicia sesión. | L'amministratore la esaminerà e ti invierà un codice di accesso. Quando lo ricevi, torna e accedi. |
| auth.noCollections | Hi {name} — your account doesn't include any collections yet. Ask the admin to grant you Records and/or Books. | Bonjour {name} — votre compte ne comprend encore aucune collection. Demandez à l'admin de vous accorder Disques et/ou Livres. | Hoi {name} — je account bevat nog geen collecties. Vraag de beheerder om Platen en/of Boeken toe te kennen. | Oi {name} — sua conta ainda não inclui coleções. Peça ao admin para liberar Discos e/ou Livros. | Hallo {name} — dein Konto enthält noch keine Sammlungen. Bitte den Admin, dir Platten und/oder Bücher zu gewähren. | Hola {name} — tu cuenta aún no incluye colecciones. Pide al administrador que te conceda Discos y/o Libros. | Ciao {name} — il tuo account non include ancora collezioni. Chiedi all'amministratore di concederti Dischi e/o Libri. |

---

## 4. Header

| Key | en | fr | nl | pt-BR | de | es | it |
| --- | --- | --- | --- | --- | --- | --- | --- |
| header.collectionType | Collection type | Type de collection | Collectietype | Tipo de coleção | Sammlungstyp | Tipo de colección | Tipo di collezione |
| header.account | Account | Compte | Account | Conta | Konto | Cuenta | Account |
| header.accountLabel | Account: {name} | Compte : {name} | Account: {name} | Conta: {name} | Konto: {name} | Cuenta: {name} | Account: {name} |

---

## 5. Settings (incl. new language control)

| Key | en | fr | nl | pt-BR | de | es | it |
| --- | --- | --- | --- | --- | --- | --- | --- |
| settings.language | Language | Langue | Taal | Idioma | Sprache | Idioma | Lingua |
| settings.languageHint | Choose the language for this app. You can switch anytime. | Choisissez la langue de l'application. Vous pouvez changer à tout moment. | Kies de taal van deze app. Je kunt altijd wisselen. | Escolha o idioma do aplicativo. Você pode trocar a qualquer momento. | Wähle die Sprache dieser App. Du kannst jederzeit wechseln. | Elige el idioma de la aplicación. Puedes cambiarlo cuando quieras. | Scegli la lingua dell'app. Puoi cambiarla quando vuoi. |
| settings.recordsHelp | Records are looked up on Discogs, which needs no token — just switch to the Records tab and scan a barcode. | Les disques sont recherchés sur Discogs, sans jeton — passez simplement à l'onglet Disques et scannez un code-barres. | Platen worden opgezocht op Discogs, zonder token — schakel naar het tabblad Platen en scan een streepjescode. | Discos são pesquisados no Discogs, sem token — basta ir à aba Discos e escanear um código de barras. | Platten werden bei Discogs nachgeschlagen, ohne Token — wechsle einfach zum Tab Platten und scanne einen Barcode. | Los discos se buscan en Discogs, sin token — cambia a la pestaña Discos y escanea un código de barras. | I dischi vengono cercati su Discogs, senza token — basta passare alla scheda Dischi e scansionare un codice a barre. |
| settings.booksHelp | Books are looked up on Google Books, which needs no token — just switch to the Books tab and scan an ISBN. | Les livres sont recherchés sur Google Books, sans jeton — passez à l'onglet Livres et scannez un ISBN. | Boeken worden opgezocht op Google Books, zonder token — schakel naar het tabblad Boeken en scan een ISBN. | Livros são pesquisados no Google Books, sem token — basta ir à aba Livros e escanear um ISBN. | Bücher werden bei Google Books nachgeschlagen, ohne Token — wechsle zum Tab Bücher und scanne eine ISBN. | Los libros se buscan en Google Books, sin token — cambia a la pestaña Libros y escanea un ISBN. | I libri vengono cercati su Google Books, senza token — basta passare alla scheda Libri e scansionare un ISBN. |

---

## 6. Scanner

| Key | en | fr | nl | pt-BR | de | es | it |
| --- | --- | --- | --- | --- | --- | --- | --- |
| scan.startingCamera | Starting camera… | Démarrage de la caméra… | Camera starten… | Iniciando câmera… | Kamera wird gestartet… | Iniciando cámara… | Avvio fotocamera… |
| scan.aimAtBarcode | Aim at the barcode | Visez le code-barres | Richt op de streepjescode | Aponte para o código de barras | Ziele auf den Barcode | Apunta al código de barras | Inquadra il codice a barre |
| scan.cameraDenied | Camera access was denied. Allow camera access in Settings to scan barcodes. | L'accès à la caméra a été refusé. Autorisez la caméra dans les réglages pour scanner des codes-barres. | Cameratoegang geweigerd. Sta camera toe in Instellingen om te scannen. | O acesso à câmera foi negado. Permita o acesso nas Configurações para escanear. | Kamerazugriff verweigert. Erlaube den Kamerazugriff in den Einstellungen, um Barcodes zu scannen. | Se denegó el acceso a la cámara. Permite el acceso en Ajustes para escanear. | Accesso alla fotocamera negato. Consenti l'accesso nelle Impostazioni per scansionare. |
| scan.cameraFail | Could not start the camera on this device. | Impossible de démarrer la caméra sur cet appareil. | Kan de camera op dit apparaat niet starten. | Não foi possível iniciar a câmera neste dispositivo. | Kamera konnte auf diesem Gerät nicht gestartet werden. | No se pudo iniciar la cámara en este dispositivo. | Impossibile avviare la fotocamera su questo dispositivo. |
| scan.restartingCamera | Restarting camera… | Redémarrage de la caméra… | Camera opnieuw starten… | Reiniciando câmera… | Kamera wird neu gestartet… | Reiniciando cámara… | Riavvio fotocamera… |
| scan.scanBarcode | Scan barcode | Scanner un code-barres | Streepjescode scannen | Escanear código de barras | Barcode scannen | Escanear código de barras | Scansiona codice a barre |
| scan.cancelScan | Cancel scan | Annuler le scan | Scan annuleren | Cancelar escaneamento | Scan abbrechen | Cancelar escaneo | Annulla scansione |
| scan.torchOn | Turn on torch | Allumer la lampe | Zaklamp aan | Acender a lanterna | Taschenlampe an | Encender linterna | Accendi torcia |
| scan.torchOff | Turn off torch | Éteindre la lampe | Zaklamp uit | Apagar a lanterna | Taschenlampe aus | Apagar linterna | Spegni torcia |
| scan.retryCamera | Retry camera | Réessayer la caméra | Camera opnieuw | Tentar câmera novamente | Kamera erneut versuchen | Reintentar cámara | Riprova fotocamera |
| scan.enterManually | Enter details manually instead | Saisir les détails manuellement à la place | Voer de gegevens handmatig in | Inserir os dados manualmente | Details stattdessen manuell eingeben | Introducir los datos manualmente | Inserisci i dati manualmente |

---

## 7. Manual add (records & books)

| Key | en | fr | nl | pt-BR | de | es | it |
| --- | --- | --- | --- | --- | --- | --- | --- |
| add.searchResults | Search results | Résultats de recherche | Zoekresultaten | Resultados da pesquisa | Suchergebnisse | Resultados de búsqueda | Risultati della ricerca |
| add.lookingUpDiscogs | Looking it up on Discogs… | Recherche sur Discogs… | Zoeken op Discogs… | Pesquisando no Discogs… | Suche bei Discogs… | Buscando en Discogs… | Ricerca su Discogs… |
| add.noMatchDiscogs | No matches found on Discogs. | Aucun résultat sur Discogs. | Geen resultaten op Discogs. | Nenhum resultado no Discogs. | Keine Treffer bei Discogs. | Sin resultados en Discogs. | Nessun risultato su Discogs. |
| add.lookingUpGoogle | Looking it up on Google Books… | Recherche sur Google Books… | Zoeken op Google Books… | Pesquisando no Google Books… | Suche bei Google Books… | Buscando en Google Books… | Ricerca su Google Books… |
| add.noMatchGoogle | No matches found on Google Books. | Aucun résultat sur Google Books. | Geen resultaten op Google Books. | Nenhum resultado no Google Books. | Keine Treffer bei Google Books. | Sin resultados en Google Books. | Nessun risultato su Google Books. |
| add.addRecordManually | Add record manually | Ajouter un disque manuellement | Plaat handmatig toevoegen | Adicionar disco manualmente | Platte manuell hinzufügen | Añadir disco manualmente | Aggiungi disco manualmente |
| add.addBookManually | Add book manually | Ajouter un livre manuellement | Boek handmatig toevoegen | Adicionar livro manualmente | Buch manuell hinzufügen | Añadir libro manualmente | Aggiungi libro manualmente |
| add.addByHand | Add by hand | Ajouter à la main | Handmatig toevoegen | Adicionar manualmente | Manuell hinzufügen | Añadir a mano | Aggiungi a mano |
| add.artist | Artist | Artiste | Artiest | Artista | Künstler:in | Artista | Artista |
| add.author | Author | Auteur | Auteur | Autor(a) | Autor:in | Autor(a) | Autore |
| add.titleRequired | Title is required | Le titre est requis | Titel is verplicht | O título é obrigatório | Titel ist erforderlich | El título es obligatorio | Il titolo è obbligatorio |
| add.format | Format | Format | Formaat | Formato | Format | Formato | Formato |
| add.year | Year | Année | Jaar | Ano | Jahr | Año | Anno |
| add.label | Label | Label | Label | Gravadora | Label | Sello | Etichetta |
| add.catalogNumber | Catalog # | N° catalogue | Catalogusnr. | Nº de catálogo | Katalognr. | N.º de catálogo | N. catalogo |
| add.genre | Genre | Genre | Genre | Gênero | Genre | Género | Genere |
| add.publisher | Publisher | Éditeur | Uitgever | Editora | Verlag | Editorial | Editore |
| add.category | Category | Catégorie | Categorie | Categoria | Kategorie | Categoría | Categoria |
| add.backToSearch | Back to search | Retour à la recherche | Terug naar zoeken | Voltar para a pesquisa | Zurück zur Suche | Volver a la búsqueda | Torna alla ricerca |
| add.addToCrate | Add to crate | Ajouter au bac | Toevoegen aan krat | Adicionar à caixa | Zur Kiste hinzufügen | Añadir a la caja | Aggiungi alla cassa |
| add.addToShelf | Add to shelf | Ajouter à l'étagère | Toevoegen aan plank | Adicionar à estante | Zum Regal hinzufügen | Añadir al estante | Aggiungi allo scaffale |
| add.findRecord | Find a record | Trouver un disque | Een plaat zoeken | Encontrar um disco | Eine Platte finden | Encontrar un disco | Trova un disco |
| add.findBook | Find a book | Trouver un livre | Een boek zoeken | Encontrar um livro | Ein Buch finden | Encontrar un libro | Trova un libro |
| add.findAnotherWay | Find it another way | Le trouver autrement | Anders zoeken | Encontrar de outro jeito | Anders finden | Encontrarlo de otra forma | Trovarlo in altro modo |
| add.searchPlaceholderRecord | Artist or album title | Artiste ou titre d'album | Artiest of albumtitel | Artista ou título do álbum | Künstler:in oder Albumtitel | Artista o título del álbum | Artista o titolo dell'album |
| add.searchPlaceholderBook | Title or author | Titre ou auteur | Titel of auteur | Título ou autor | Titel oder Autor:in | Título o autor | Titolo o autore |
| add.searchDiscogs | Search Discogs | Rechercher sur Discogs | Zoeken op Discogs | Pesquisar no Discogs | Bei Discogs suchen | Buscar en Discogs | Cerca su Discogs |
| add.searchGoogleBooks | Search Google Books | Rechercher sur Google Books | Zoeken op Google Books | Pesquisar no Google Books | Bei Google Books suchen | Buscar en Google Books | Cerca su Google Books |
| add.skipSearchAddByHand | Skip search — add it by hand | Passer la recherche — ajouter à la main | Zoek overslaan — handmatig toevoegen | Pular pesquisa — adicionar manualmente | Suche überspringen — manuell hinzufügen | Saltar búsqueda — añadir a mano | Salta la ricerca — aggiungi a mano |

> Example placeholders ("Miles Davis", "Kind of Blue", "1959", "Columbia",
> "Ursula K. Le Guin", "you@example.com") stay as-is — they're examples, not UI.

---

## 8. Toolbar · filter · sort

| Key | en | fr | nl | pt-BR | de | es | it |
| --- | --- | --- | --- | --- | --- | --- | --- |
| toolbar.filter | Filter | Filtre | Filter | Filtro | Filter | Filtro | Filtro |
| toolbar.filtersActive | {n} active | {n} actif(s) | {n} actief | {n} ativo(s) | {n} aktiv | {n} activos | {n} attivi |
| toolbar.clearSearch | Clear search | Effacer la recherche | Zoekopdracht wissen | Limpar pesquisa | Suche löschen | Borrar búsqueda | Cancella ricerca |
| toolbar.sortBy | Sort by | Trier par | Sorteer op | Ordenar por | Sortieren nach | Ordenar por | Ordina per |
| toolbar.gridView | Grid view | Vue grille | Rasterweergave | Visualização em grade | Rasteransicht | Vista de cuadrícula | Vista a griglia |
| toolbar.listView | List view | Vue liste | Lijstweergave | Visualização em lista | Listenansicht | Vista de lista | Vista a elenco |
| toolbar.searchCollection | Search collection | Rechercher dans la collection | Collectie doorzoeken | Pesquisar na coleção | Sammlung durchsuchen | Buscar en la colección | Cerca nella collezione |
| toolbar.recentlyAdded | Recently added | Ajouté récemment | Recent toegevoegd | Adicionados recentemente | Kürzlich hinzugefügt | Añadido recientemente | Aggiunti di recente |
| toolbar.artistAZ | Artist A–Z | Artiste A–Z | Artiest A–Z | Artista A–Z | Künstler:in A–Z | Artista A–Z | Artista A–Z |
| toolbar.titleAZ | Title A–Z | Titre A–Z | Titel A–Z | Título A–Z | Titel A–Z | Título A–Z | Titolo A–Z |
| toolbar.all | All | Tous | Alles | Todos | Alle | Todos | Tutti |
| toolbar.noArtists | No matching artists | Aucun artiste correspondant | Geen overeenkomende artiesten | Nenhum artista correspondente | Keine passenden Künstler:innen | Sin artistas coincidentes | Nessun artista corrispondente |
| toolbar.noAuthors | No matching authors | Aucun auteur correspondant | Geen overeenkomende auteurs | Nenhum autor correspondente | Keine passenden Autor:innen | Sin autores coincidentes | Nessun autore corrispondente |
| toolbar.reset | Reset | Réinitialiser | Resetten | Redefinir | Zurücksetzen | Restablecer | Reimposta |

---

## 9. List & detail

| Key | en | fr | nl | pt-BR | de | es | it |
| --- | --- | --- | --- | --- | --- | --- | --- |
| list.jumpToLetter | Jump to letter | Aller à la lettre | Spring naar letter | Ir para a letra | Zum Buchstaben springen | Ir a la letra | Vai alla lettera |
| list.jumpTo | Jump to | Aller à | Spring naar | Ir para | Springen zu | Ir a | Vai a |
| list.collectionList | Collection list | Liste de la collection | Collectielijst | Lista da coleção | Sammlungsliste | Lista de la colección | Elenco della collezione |
| list.collectionItem | Collection item | Élément de la collection | Collectie-item | Item da coleção | Sammlungsobjekt | Elemento de la colección | Oggetto della collezione |
| list.nothingMatches | Nothing matches | Rien ne correspond | Niets komt overeen | Nada corresponde | Nichts passt | Nada coincide | Nessuna corrispondenza |
| list.tryDifferentSearch | Try a different search or clear the filters. | Essayez une autre recherche ou effacez les filtres. | Probeer een andere zoekopdracht of wis de filters. | Tente outra pesquisa ou limpe os filtros. | Versuche eine andere Suche oder lösche die Filter. | Prueba otra búsqueda o borra los filtros. | Prova un'altra ricerca o cancella i filtri. |
| detail.country | Country | Pays | Land | País | Land | País | Paese |
| detail.tracklist | Tracklist | Liste des titres | Tracklist | Faixas | Tracklist | Lista de canciones | Tracklist |
| detail.tracklistError | Couldn't load tracklist. | Impossible de charger la liste des titres. | Kon tracklist niet laden. | Não foi possível carregar as faixas. | Tracklist konnte nicht geladen werden. | No se pudo cargar la lista de canciones. | Impossibile caricare la tracklist. |
| detail.noTracklist | No tracklist on file. | Aucune liste des titres enregistrée. | Geen tracklist opgeslagen. | Nenhuma lista de faixas registrada. | Keine Tracklist vorhanden. | No hay lista de canciones. | Nessuna tracklist. |
| detail.notes | Notes | Notes | Notities | Notas | Notizen | Notas | Note |
| detail.notesPlaceholderRecord | Condition, pressing details, where you found it… | État, détails du pressage, où vous l'avez trouvé… | Staat, persingsdetails, waar je het vond… | Condição, detalhes da prensagem, onde encontrou… | Zustand, Pressungsdetails, wo du es gefunden hast… | Estado, detalles de la edición, dónde lo encontraste… | Condizioni, dettagli della stampa, dove l'hai trovato… |
| detail.notesPlaceholderBook | Condition, where you got it, whether it's signed… | État, où vous l'avez eu, s'il est signé… | Staat, waar je het vandaan hebt, of het gesigneerd is… | Condição, onde conseguiu, se é autografado… | Zustand, woher du es hast, ob es signiert ist… | Estado, dónde lo conseguiste, si está firmado… | Condizioni, dove l'hai preso, se è firmato… |
| detail.couldNotSaveNotes | Could not save notes | Impossible d'enregistrer les notes | Kon notities niet opslaan | Não foi possível salvar as notas | Notizen konnten nicht gespeichert werden | No se pudieron guardar las notas | Impossibile salvare le note |
| detail.pages | Pages | Pages | Pagina's | Páginas | Seiten | Páginas | Pagine |
| detail.categories | Categories | Catégories | Categorieën | Categorias | Kategorien | Categorías | Categorie |
| detail.aboutThisBook | About this book | À propos de ce livre | Over dit boek | Sobre este livro | Über dieses Buch | Acerca de este libro | A proposito di questo libro |
| detail.descriptionError | Couldn't load the description. | Impossible de charger la description. | Kon beschrijving niet laden. | Não foi possível carregar a descrição. | Beschreibung konnte nicht geladen werden. | No se pudo cargar la descripción. | Impossibile caricare la descrizione. |
| detail.viewInCollection | View in collection → | Voir dans la collection → | Bekijk in collectie → | Ver na coleção → | In der Sammlung ansehen → | Ver en la colección → | Visualizza nella collezione → |
| detail.albumByArtist | {album} by {artist} | {album} de {artist} | {album} van {artist} | {album} por {artist} | {album} von {artist} | {album} de {artist} | {album} di {artist} |

---

## 10. Collection view

| Key | en | fr | nl | pt-BR | de | es | it |
| --- | --- | --- | --- | --- | --- | --- | --- |
| view.isThisIt | Is this it? | C'est bien ça ? | Is dit hem? | É isso? | Ist es das? | ¿Es este? | È questo? |
| view.couldNotReach | Couldn't reach your collection. {error} | Impossible d'accéder à votre collection. {error} | Kon je collectie niet bereiken. {error} | Não foi possível acessar sua coleção. {error} | Deine Sammlung konnte nicht erreicht werden. {error} | No se pudo acceder a tu colección. {error} | Impossibile raggiungere la tua collezione. {error} |
| view.couldNotSave | Could not save — check your connection | Impossible d'enregistrer — vérifiez votre connexion | Kon niet opslaan — controleer je verbinding | Não foi possível salvar — verifique sua conexão | Speichern fehlgeschlagen — Verbindung prüfen | No se pudo guardar — comprueba tu conexión | Impossibile salvare — controlla la connessione |
| view.lookupsNotConfigured | {lookupName} lookups aren't configured yet — ask the owner to set up the shared token | Les recherches {lookupName} ne sont pas encore configurées — demandez au propriétaire de configurer le jeton partagé | {lookupName}-zoekopdrachten zijn nog niet geconfigureerd — vraag de eigenaar het gedeelde token in te stellen | As pesquisas {lookupName} ainda não estão configuradas — peça ao proprietário para configurar o token compartilhado | {lookupName}-Suchen sind noch nicht eingerichtet — bitte den Besitzer, das geteilte Token einzurichten | Las búsquedas de {lookupName} aún no están configuradas: pide al propietario que configure el token compartido | Le ricerche {lookupName} non sono ancora configurate — chiedi al proprietario di configurare il token condiviso |

---

## 11. Admin panel

| Key | en | fr | nl | pt-BR | de | es | it |
| --- | --- | --- | --- | --- | --- | --- | --- |
| admin.pendingRequests | Pending requests | Demandes en attente | Openstaande aanvragen | Solicitações pendentes | Offene Anfragen | Solicitudes pendientes | Richieste in attesa |
| admin.noPending | No pending requests right now. | Aucune demande en attente pour le moment. | Op dit moment geen openstaande aanvragen. | Nenhuma solicitação pendente no momento. | Zurzeit keine offenen Anfragen. | No hay solicitudes pendientes ahora. | Nessuna richiesta in attesa al momento. |
| admin.requestedOn | requested {date} | demandé le {date} | aangevraagd op {date} | solicitado em {date} | beantragt am {date} | solicitado el {date} | richiesta il {date} |
| admin.approve | Approve | Approuver | Goedkeuren | Aprovar | Genehmigen | Aprobar | Approva |
| admin.reject | Reject | Rejeter | Afwijzen | Rejeitar | Ablehnen | Rechazar | Rifiuta |
| admin.grantAccess | Grant access | Accorder l'accès | Toegang verlenen | Conceder acesso | Zugang gewähren | Conceder acceso | Concedi accesso |
| admin.whichCollections | Which collections should this member get? | Quelles collections ce membre doit-il recevoir ? | Welke collecties moet dit lid krijgen? | Quais coleções este membro deve receber? | Welche Sammlungen soll dieses Mitglied bekommen? | ¿Qué colecciones debe recibir este miembro? | Quali collezioni deve ricevere questo membro? |
| admin.generateCode | Generate access code | Générer un code d'accès | Toegangscode genereren | Gerar código de acesso | Zugangscode generieren | Generar código de acceso | Genera codice di accesso |
| admin.accessCodeFor | Access code for {name} | Code d'accès pour {name} | Toegangscode voor {name} | Código de acesso para {name} | Zugangscode für {name} | Código de acceso para {name} | Codice di accesso per {name} |
| admin.shareCodeHint | Share this code out of band — it's how they sign in. | Partagez ce code en dehors de l'app — c'est ainsi qu'ils se connectent. | Deel deze code buiten de app — zo loggen ze in. | Compartilhe este código por fora — é assim que eles entram. | Teile diesen Code außerhalb der App — so melden sie sich an. | Comparte este código fuera de la app: así inician sesión. | Condividi questo codice fuori dall'app — è così che accedono. |
| admin.copied | Copied ✓ | Copié ✓ | Gekopieerd ✓ | Copiado ✓ | Kopiert ✓ | Copiado ✓ | Copiato ✓ |
| admin.members | Members | Membres | Leden | Membros | Mitglieder | Miembros | Membri |
| admin.noMembers | No members yet. | Aucun membre pour le moment. | Nog geen leden. | Nenhum membro ainda. | Noch keine Mitglieder. | Aún no hay miembros. | Nessun membro ancora. |
| admin.disabled | Disabled | Désactivé | Uitgeschakeld | Desativado | Deaktiviert | Desactivado | Disattivato |
| admin.hideCode | Hide code | Masquer le code | Code verbergen | Ocultar código | Code verbergen | Ocultar código | Nascondi codice |
| admin.showCode | Show code | Afficher le code | Code tonen | Mostrar código | Code anzeigen | Mostrar código | Mostra codice |
| admin.disable | Disable | Désactiver | Uitschakelen | Desativar | Deaktivieren | Desactivar | Disattiva |
| admin.enable | Enable | Activer | Inschakelen | Ativar | Aktivieren | Activar | Attiva |
| admin.delete | Delete | Supprimer | Verwijderen | Excluir | Löschen | Eliminar | Elimina |
| admin.deleteConfirm | Delete this member and their collections? This cannot be undone. | Supprimer ce membre et ses collections ? Impossible d'annuler. | Dit lid en hun collecties verwijderen? Dit kan niet ongedaan worden gemaakt. | Excluir este membro e as coleções dele? Isso não pode ser desfeito. | Dieses Mitglied und seine Sammlungen löschen? Das kann nicht rückgängig gemacht werden. | ¿Eliminar a este miembro y sus colecciones? No se puede deshacer. | Eliminare questo membro e le sue collezioni? Non si può annullare. |

---

## 12. Errors (API)

| Key | en | fr | nl | pt-BR | de | es | it |
| --- | --- | --- | --- | --- | --- | --- | --- |
| err.requestFailed | Request failed ({status}) | Requête échouée ({status}) | Verzoek mislukt ({status}) | Falha na requisição ({status}) | Anfrage fehlgeschlagen ({status}) | Falló la solicitud ({status}) | Richiesta non riuscita ({status}) |
| err.lookupsNotConfiguredToken | Lookups aren't configured yet — tell the owner to set the Discogs token. | Les recherches ne sont pas encore configurées — dites au propriétaire de définir le jeton Discogs. | Zoekopdrachten zijn nog niet geconfigureerd — zeg de eigenaar het Discogs-token in te stellen. | As pesquisas ainda não estão configuradas — avise o proprietário para definir o token do Discogs. | Suchen sind noch nicht eingerichtet — sag dem Besitzer, das Discogs-Token zu setzen. | Las búsquedas aún no están configuradas: dile al propietario que configure el token de Discogs. | Le ricerche non sono ancora configurate — di' al proprietario di impostare il token Discogs. |
| err.tokenRejected | Discogs token rejected. | Jeton Discogs refusé. | Discogs-token afgewezen. | Token do Discogs rejeitado. | Discogs-Token abgelehnt. | Token de Discogs rechazado. | Token Discogs rifiutato. |
| err.rateLimitDiscogs | Discogs rate limit hit — wait a moment and try again. | Limite de débit Discogs atteinte — attendez un instant et réessayez. | Discogs-limiet bereikt — wacht even en probeer opnieuw. | Limite de taxa do Discogs atingida — aguarde um momento e tente novamente. | Discogs-Ratenlimit erreicht — warte einen Moment und versuche es erneut. | Límite de Discogs alcanzado: espera un momento e inténtalo de nuevo. | Limite di velocità Discogs raggiunto — attendi un attimo e riprova. |
| err.discogsFailed | Discogs request failed. | La requête Discogs a échoué. | Discogs-verzoek mislukt. | Falha na requisição ao Discogs. | Discogs-Anfrage fehlgeschlagen. | Falló la solicitud a Discogs. | Richiesta Discogs non riuscita. |
| err.rateLimitGoogle | Google Books rate limit hit — wait a moment and try again. | Limite de débit Google Books atteinte — attendez un instant et réessayez. | Google Books-limiet bereikt — wacht even en probeer opnieuw. | Limite de taxa do Google Books atingida — aguarde um momento e tente novamente. | Google-Books-Ratenlimit erreicht — warte einen Moment und versuche es erneut. | Límite de Google Books alcanzado: espera un momento e inténtalo de nuevo. | Limite di velocità Google Books raggiunto — attendi un attimo e riprova. |
| err.googleFailed | Google Books request failed. | La requête Google Books a échoué. | Google Books-verzoek mislukt. | Falha na requisição ao Google Books. | Google-Books-Anfrage fehlgeschlagen. | Falló la solicitud a Google Books. | Richiesta Google Books non riuscita. |
| err.couldNotRefreshSession | Could not refresh session | Impossible d'actualiser la session | Kan sessie niet verversen | Não foi possível atualizar a sessão | Sitzung konnte nicht aktualisiert werden | No se pudo renovar la sesión | Impossibile aggiornare la sessione |

---

## 13. Catalog `.copy` bridge

The catalog `.copy` blocks should map to keys + the `{collectionLabel}`
(crate/shelf) and `{lookupName}` (Discogs/Google Books) parameters. v1 mapping
(populate from the above + keep the existing EN as baseline):

| catalog key (records) | en (baseline — keep existing) | pattern |
| --- | --- | --- |
| emptyTitle | Your crate is empty | `emptyTitle` |
| emptySub | Scan the barcode on a sleeve to catalog your first record. | `emptySub` |
| emptyTagline | your crate, cataloged | `emptyTagline` ({collectionLabel}) |
| emptyBtn | Scan a record | `emptyBtn` |
| emptyManualBtn | Add by title | `addByTitle` |
| clearFilters | Clear filters | `clearFilters` |
| loading | Loading your crate… | `loadingCollection` |
| addToast | Added to your crate | `addedToast` ({collectionLabel}) |
| addDone | Added | `added` |
| removedToast | Removed | `removed` |
| removeLabel | Remove from crate | `removeLabel` ({collectionLabel}) |
| removeConfirm | Confirm remove? | `removeConfirm` |
| lookingUp | Looking it up on Discogs… | `lookingUp` ({lookupName}) |
| noMatch | No matches found on Discogs. | `noMatch` ({lookupName}) |
| resultGood | Not in your crate yet | `resultGood` ({collectionLabel}) |
| resultOwned | Already in your crate | `resultOwned` ({collectionLabel}) |
| resultSame | You already own this album | `resultSame` |
| sameHeading | Other pressings you own | `sameHeading` |
| moreBy | More by {name} in your crate ({n}) | `moreBy` ({collectionLabel}) |
| nothingElseBy | Nothing else by {name} in your crate | `nothingElseBy` |
| moreRelated | and {n} more | `moreRelated` |
| scanNext | Scan next | `scanNext` |
| add | Add to crate | `add` ({collectionLabel}) |
| addAnyway | Add anyway | `addAnyway` |
| manualTitleRequired | Add a title — give this record a name first. | `manualTitleRequired` |
| notesSave | Save | `save` |
| notesSaved | Saved ✓ | `saved` |
| filterLabel | Filter | `filter` |
| searchClear | Clear search | `clearSearch` |
| filtersActive | {n} filter(s) active | `filtersActive` |
| sortMenu.label | Sort by | `sortBy` |
| view.label | View | `view` |
| view.grid | Grid view | `gridView` |
| view.list | List view | `listView` |
| view.showing | Showing {n} of {m} | `showing` |
| list.label | Collection list | `collectionList` |
| list.jumpRail | Jump to letter | `jumpToLetter` |
| list.jumpTo | Jump to | `jumpTo` |

> Books copy mirrors records with `shelf` for `{collectionLabel}` and `Google
> Books` for `{lookupName}` (already parallel in `src/catalog.js`).

---

## 14. Additional keys (completes the contract used by `ticket-localization.md`)

| Key | en | fr | nl | pt-BR | de | es | it |
| --- | --- | --- | --- | --- | --- | --- | --- |
| common.copy | Copy | Copier | Kopiëren | Copiar | Kopieren | Copiar | Copia |
| toolbar.clearFilters | Clear filters | Effacer les filtres | Filters wissen | Limpar filtros | Filter löschen | Borrar filtros | Cancella filtri |
| toolbar.filterBy | Filter by {artistLabel} | Filtrer par {artistLabel} | Filteren op {artistLabel} | Filtrar por {artistLabel} | Filtern nach {artistLabel} | Filtrar por {artistLabel} | Filtra per {artistLabel} |
| add.lookingUp | Looking it up… | Recherche… | Zoeken… | Pesquisando… | Suche… | Buscando… | Ricerca… |
| add.noMatch | No matches found. | Aucun résultat trouvé. | Geen resultaten gevonden. | Nenhum resultado encontrado. | Keine Treffer gefunden. | No se encontraron resultados. | Nessun risultato trovato. |
| add.searchByTitleInstead | Search by title instead | Rechercher par titre à la place | Zoek in plaats daarvan op titel | Pesquisar por título em vez disso | Stattdessen nach Titel suchen | Buscar por título en su lugar | Cerca per titolo invece |
| add.addManually | Add manually | Ajouter manuellement | Handmatig toevoegen | Adicionar manualmente | Manuell hinzufügen | Añadir manualmente | Aggiungi manualmente |
| detail.barcode | Barcode | Code-barres | Streepjescode | Código de barras | Barcode | Código de barras | Codice a barre |
| detail.isbn | ISBN | ISBN | ISBN | ISBN | ISBN | ISBN | ISBN |

> `detail.isbn` stays "ISBN" in all languages (universal proper noun) but is
> keyed so the label renders consistently.

---

## Validation & completion

- EN = shipped baseline (do not change wording).
- All 6 non-EN columns are **v1 drafts** — validate with the native testers
  (FR · NL · BR · DE · ES · IT) before the `feat/localization` branch ships.
- Missing keys should fall back to EN via the `copy.x || t('x')` pattern
  (no dark-screen risk).
