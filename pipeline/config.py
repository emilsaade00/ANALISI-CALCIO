"""Configurazione centrale: campionati, stagioni, percorsi, parametri del modello."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.environ.get("CALCIO_DB", ROOT / "db" / "calcio.sqlite"))
RAW_DIR = ROOT / "raw"
MANUAL_DIR = ROOT / "data" / "manuale"
PRED_DIR = ROOT / "data" / "pronostici"  # archivio permanente dei pronostici registrati prima della gara
WEB_DIR = ROOT / "web"
EXPORT_DIR = Path(os.environ.get("CALCIO_EXPORT", WEB_DIR / "data"))
TZ_DISPLAY = "Europe/Rome"

# Solo queste quattro competizioni maschili di prima divisione.
LEAGUES = {
    "sa": {"name": "Serie A", "country": "Italia", "tz": "Europe/Rome",
           "fd_couk": "I1", "fd_org": "SA", "api_football": 135, "openfootball": "it.1",
           "mirror": "serie-a", "om": "ITA_1_serie-a"},
    "pl": {"name": "Premier League", "country": "Inghilterra", "tz": "Europe/London",
           "fd_couk": "E0", "fd_org": "PL", "api_football": 39, "openfootball": "en.1",
           "mirror": "premier-league", "om": "ENG_1_premier-league", "fplcore": True},
    "bl": {"name": "Bundesliga", "country": "Germania", "tz": "Europe/Berlin",
           "fd_couk": "D1", "fd_org": "BL1", "api_football": 78, "openfootball": "de.1",
           "mirror": "bundesliga", "om": "GER_1_bundesliga"},
    "ll": {"name": "LaLiga", "country": "Spagna", "tz": "Europe/Madrid",
           "fd_couk": "SP1", "fd_org": "PD", "api_football": 140, "openfootball": "es.1",
           "mirror": "la-liga", "om": "ESP_1_la-liga"},
}
# Ordine di priorita' quando il budget delle API e' limitato (prima Serie A e Premier League)
PRIORITY_LEAGUES = ["sa", "pl", "bl", "ll"]


# Stagioni caricate. La prima serve solo come storico per addestrare il modello.
SEASONS = [s.strip() for s in os.environ.get(
    "CALCIO_SEASONS", "2022-23,2023-24,2024-25,2025-26,2026-27").split(",") if s.strip()]
CURRENT_SEASON = os.environ.get("CALCIO_CURRENT_SEASON", SEASONS[-1])
# Stagione usata per tarare i parametri; le successive servono per la valutazione.
TUNING_SEASON = os.environ.get("CALCIO_TUNING_SEASON", "2024-25")
EVAL_SEASONS = [s for s in SEASONS if s > TUNING_SEASON]


def season_code(season: str) -> str:
    """'2026-27' -> '2627' (formato football-data.co.uk)."""
    a, b = season.split("-")
    return a[2:] + b


def season_start_year(season: str) -> int:
    return int(season.split("-")[0])


# Chiavi API: lette SOLO da variabili d'ambiente (in GitHub: Settings > Secrets).
FOOTBALL_DATA_ORG_KEY = os.environ.get("FOOTBALL_DATA_ORG_KEY", "").strip()
API_FOOTBALL_KEY = os.environ.get("API_FOOTBALL_KEY", "").strip()
API_FOOTBALL_DAILY_BUDGET = int(os.environ.get("API_FOOTBALL_DAILY_BUDGET", "90"))

# Fonti abilitate: "fdcouk,fdorg,apifootball,openfootball,mirror"
SOURCES_ENABLED = [s.strip() for s in os.environ.get(
    "CALCIO_SOURCES", "openfootball,fdcouk,mirror,openmatchday,fplcore,legaseriea,designazioni,espn,fdorg,apifootball").split(",") if s.strip()]

MODEL_VERSION = "1.1.0"
SCHEDULE_NOTE = os.environ.get("CALCIO_SCHEDULE_NOTE",
                               "Completo ogni mattina alle 06:15 UTC (07:15 ora italiana in inverno); ogni 30 minuti risultati appena conclusi e formazioni ufficiali. Tramite GitHub Actions, anche ad app chiusa.")

# Parametri di default del modello (sovrascritti dalla taratura, se eseguita).
MODEL_DEFAULTS = {
    "window_days": 730,       # dati usati: ultimi 2 anni
    "half_life_days": 180,    # peso dimezzato ogni 180 giorni (forma recente)
    "k_shrink": 6.0,          # partite fittizie di media campionato (prudenza con pochi dati)
    "k_venue": 10.0,          # prudenza sul fattore casa/trasferta della singola squadra
    "k_referee": 12.0,        # prudenza sull'effetto arbitro
    "min_obs": 3,             # partite minime osservate per stimare una metrica
    "iterations": 12,
}

# Metriche modellate (codice: famiglia di distribuzione)
MODELLED_METRICS = {
    "gol": "poisson",
    "corner": "negbin",
    "tiri": "negbin",
    "tiri_porta": "negbin",
    "falli": "negbin",
    "cartellini": "negbin",
}
REFEREE_METRICS = {"falli", "cartellini"}
