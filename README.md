# Calcio in chiaro

Web app di analisi calcistica in italiano per **Serie A, Premier League, Bundesliga e LaLiga**.
Funziona su smartphone, tablet e computer. Apri l'app, scegli una giornata, entri in una partita e trovi:
come arrivano le squadre, che tipo di gara suggeriscono i dati e quali eventi hanno più probabilità di verificarsi.

Il modello usa **solo dati sportivi**. Quote, probabilità implicite, pronostici dei bookmaker e modelli basati
sulle quote sono esclusi da raccolta dati, stima, selezione degli indicatori e valutazione.

---

## Cosa contiene

| Cartella | Contenuto |
|---|---|
| `pipeline/` | Importazione dalle fonti, database SQLite, modello, pronostici, verifica, esportazione |
| `pipeline/sources/` | Un modulo per fonte: football-data.co.uk, mirror GitHub, openfootball, open-matchday, FPL-Core, Lega Serie A, ESPN, football-data.org, API-Football |
| `web/` | L'app (HTML, CSS, JavaScript senza dipendenze) e i dati esportati in `web/data/` |
| `db/calcio.sqlite` | Il database (creato al primo aggiornamento): partite, statistiche, arbitri, giocatori, pronostici, storico aggiornamenti. Su GitHub resta nella cache delle Actions perché supera i 100 MB |
| `data/pronostici/` | Archivio permanente, versionato in git, di ogni pronostico registrato prima della gara (data, ora, versione del modello, dati usati) |
| `data/manuale/` | Designazioni arbitrali di Serie A trascritte dai comunicati AIA, con la fonte di ogni riga |
| `.github/workflows/aggiornamento.yml` | Aggiornamento automatico quotidiano lato server e pubblicazione |
| `tests/test_parity.py` | Verifica che il calcolo delle probabilità in Python e nel browser coincida |

## Fonti dati

| Fonte | Chiave | Cosa fornisce |
|---|---|---|
| football-data.co.uk | no | Risultati, primo tempo, tiri, tiri in porta, falli, corner, gialli, rossi; arbitro per la Premier League. Le colonne delle quote vengono scartate in lettura (lista bianca di colonne sportive). |
| datasets/football-datasets (GitHub) | no | Copia delle stesse statistiche per le stagioni concluse; usata come storico e riserva. |
| openfootball/football.json (GitHub) | no | Calendario con giornate e orari; risultati di riserva. |
| open-matchday (GitHub, ogni giorno) | no | Stagione in corso per i 4 campionati: calendario, risultati, primo tempo, tiri, tiri in porta, falli, corner anche per tempo, cartellini, minuti dei gol. Uso non commerciale con attribuzione. I file di quote del repository non vengono mai letti. |
| FPL-Core-Insights (GitHub, due volte al giorno) | no | Premier League: statistiche avanzate di squadra e di ogni giocatore (xG, grandi occasioni, passaggi, cross, dribbling, contrasti, intercetti, duelli, falli subiti e commessi, cartellini). Origine FotMob e Fantasy Premier League. |
| Match Report Lega Serie A (serie-a-observatory, GitHub, settimanale) | no | Serie A: statistiche ufficiali di squadra e di ogni giocatore (tiri, tiri in porta, passaggi chiave, recuperi, palloni giocati, falli subiti, cartellini, parate). Non contengono falli commessi, contrasti e dribbling del singolo giocatore. |
| ESPN (site.api.espn.com, ogni giorno) | no | Stagione in corso per i 4 campionati. Squadra: contrasti effettuati e vinti (quindi persi), intercetti, spazzate, passaggi, cross, lanci lunghi, possesso, falli. Giocatore: falli commessi e subiti, tiri, tiri in porta, gol, assist, fuorigioco, cartellini, titolari; minuti stimati dalle sostituzioni. In Serie A si abbina ai giocatori dei report Lega (maglia e nome) e aggiunge solo falli commessi, fuorigioco e titolari. Interfaccia pubblica non documentata, uso personale; le sezioni con quote della risposta vengono scartate. |
| Designazioni AIA (`data/manuale/`) | no | Arbitro di ogni partita di Serie A, trascritto dai comunicati ufficiali con la fonte di ogni riga. Va aggiornato a ogni giornata (una riga per partita) se non si attiva API-Football. |
| football-data.org | sì, gratuita | Calendario ufficiale con orari, giornate, rinvii, stato partita, arbitri designati. |
| API-Football | sì; il piano gratuito copre solo le stagioni 2022–2024, per la stagione in corso serve un piano a pagamento | Possesso, passaggi, xG del fornitore, tiri in/fuori area, parate, statistiche giocatore (contrasti, dribbling, duelli), formazioni ufficiali, indisponibili. Gli endpoint `/odds` e `/predictions` non vengono mai chiamati. |

Copertura reale, stato e ora dell'ultimo aggiornamento riuscito sono visibili nella pagina **Fonti** dell'app.

## Installazione dal tablet o dal telefono (senza computer)

1. Su github.com crea un account e un repository **pubblico** `calcio-in-chiaro`, spuntando *Add a README file*.
2. Nel repository: *Add file → Upload files* e carica il file `calcio-in-chiaro.zip` così com'è (non estrarlo). *Commit changes*.
3. *Add file → Create new file*: come nome scrivi `.github/workflows/aggiornamento.yml`, incolla il contenuto del file
   `.github/workflows/aggiornamento.yml` di questo progetto e conferma con *Commit changes*.
4. *Settings → Pages → Source: GitHub Actions*.
5. *Actions → Aggiornamento quotidiano → Run workflow*. Il primo avvio estrae lo zip, costruisce il database e pubblica l'app (15–20 minuti).
6. Apri l'indirizzo che compare in *Settings → Pages* con Chrome o Samsung Internet e scegli *Installa app* / *Aggiungi a schermata Home*.
7. **Nuove versioni dell'app.** Carica il nuovo zip con *Add file → Upload files* e lancia *Run workflow*: il codice viene sostituito,
   l'archivio dei pronostici salvati resta. Se il workflow è stato incollato prima del 27 novembre 2026, sostituiscilo una volta
   (matita su `.github/workflows/aggiornamento.yml`) con quello di questa versione, che sa applicare gli aggiornamenti.

## Attivare l'app con l'aggiornamento quotidiano (GitHub, gratuito, da computer)

Servono un account GitHub e circa 10 minuti. È più comodo da computer.

1. **Crea il repository.** Su github.com: *New repository* → nome a piacere (es. `calcio-in-chiaro`) → *Public* → *Create*.
2. **Carica i file.** Nel nuovo repository: *uploading an existing file* → trascina **il contenuto** della cartella estratta dallo zip (anche le cartelle `pipeline`, `web`, `db`, `tests`, `.github`) → *Commit changes*.
   Se la cartella `.github` non viene caricata (è nascosta su alcuni sistemi), creala a mano: *Add file → Create new file* → nome `.github/workflows/aggiornamento.yml` → incolla il contenuto del file.
3. **Abilita la pubblicazione.** *Settings → Pages → Build and deployment → Source: GitHub Actions*.
4. **Aggiungi le chiavi (facoltativo ma consigliato).** *Settings → Secrets and variables → Actions → New repository secret*:
   - `FOOTBALL_DATA_ORG_KEY`: registrati su <https://www.football-data.org/client/register>, ricevi il token per email.
   - `API_FOOTBALL_KEY`: crea un account su <https://dashboard.api-football.com/register> e copia la chiave.
   Le chiavi restano nei segreti di GitHub: non compaiono mai nell'app né nei dati pubblicati.
5. **Primo avvio.** *Actions → Aggiornamento quotidiano → Run workflow*. Il primo avvio costruisce il database da zero
   scaricando tutte le stagioni dalle fonti. Al termine (10–15 minuti) l'indirizzo dell'app compare
   in *Settings → Pages* (di solito `https://<tuo-utente>.github.io/<nome-repository>/`). Aggiungilo alla schermata Home del telefono.

Da quel momento l'aggiornamento parte da solo **ogni giorno alle 06:15 UTC**, anche ad app chiusa: importa nuove partite e
risultati, recupera correzioni, ricalcola gli indicatori, salva i pronostici delle partite dei 14 giorni successivi,
aggiorna la verifica e ripubblica l'app. Se una fonte non risponde, l'aggiornamento prosegue con le altre e l'app lo segnala.

### Arbitri di Serie A senza chiavi API

Il file `data/manuale/designazioni_sa_2026-27.csv` contiene l'arbitro di ogni partita fino alla 12ª giornata.
Per le giornate successive basta aggiungere una riga per partita (`giornata,casa,ospite,arbitro,fonte`) dopo il
comunicato AIA del venerdì, direttamente dal sito di GitHub (*Edit*). Con API-Football attiva le designazioni arrivano da sole.

## Eseguire in locale

```bash
pip install -r requirements.txt
python -m pipeline.run              # aggiornamento completo
python -m pipeline.run --tune       # con nuova taratura dei parametri
python -m http.server -d web 8000   # poi apri http://localhost:8000
```

Per un server qualsiasi basta pianificare il primo comando una volta al giorno (es. `cron`: `15 6 * * * cd /percorso && python -m pipeline.run`)
e servire la cartella `web/`.

Variabili d'ambiente utili: `FOOTBALL_DATA_ORG_KEY`, `API_FOOTBALL_KEY`, `API_FOOTBALL_DAILY_BUDGET` (default 90),
`CALCIO_SEASONS` (default `2022-23,…,2026-27`), `CALCIO_SOURCES`.

## Il modello in breve

Per gol, corner, tiri, tiri in porta, falli e cartellini il valore atteso di ogni squadra è:

> media del campionato (casa o trasferta) × produzione della squadra × fattore campo × concessione dell'avversario × fattore campo dell'avversario

- forza degli avversari stimata insieme alle squadre (procedura iterativa);
- forma recente con peso che si dimezza dopo un'emivita scelta dai dati;
- con pochi dati la stima viene avvicinata alla media del campionato; per le neopromosse il punto di partenza è il loro rendimento storico medio;
- arbitro (falli e cartellini) solo se designato prima della gara, con peso prudente;
- gol con Poisson, altre statistiche con binomiale negativa; soglie cumulative sempre coerenti; intervalli all'80%.

Taratura sulla stagione 2024-25, verifica sulle stagioni successive con dati sempre precedenti alla gara, confronto con
la sola media del campionato. Ogni pronostico è salvato con data, ora, versione del modello e data dei dati usati.
Dettagli nella pagina **Metodo** dell'app e in `pipeline/model.py`.

## Limiti dichiarati

- Dati individuali dei giocatori: Premier League (FPL-Core-Insights); Serie A (Match Report ufficiali più falli commessi, fuorigioco e titolari da ESPN); Bundesliga e LaLiga da ESPN. Contrasti e dribbling del singolo giocatore solo in Premier League: nessuna fonte gratuita li pubblica per gli altri campionati (contrasti di squadra disponibili per tutti da ESPN).
- Arbitri: Serie A dal file delle designazioni AIA; Premier League dalle stagioni di football-data.co.uk; per le altre leghe e per la stagione in corso in automatico servono API-Football o football-data.org.
- Non disponibili con nessuna delle fonti configurate: grandi occasioni, xA, passaggi progressivi, cross, ingressi
  nell'ultimo terzo, errori che portano al tiro, minuto del primo corner. Compaiono nel catalogo come "n.d.".
- Sui totali di gol e corner il modello fa poco meglio della media del campionato: la pagina "Quanto è preciso?" lo mostra.
