import time
import urllib.request
import urllib.error


class SourceError(Exception):
    pass


def http_get(url, headers=None, timeout=40, retries=2):
    """GET con nuovi tentativi; rispetta HTTPS_PROXY e i certificati di sistema."""
    last = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "analisi-calcio/1.0", **(headers or {})})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code} su {url}"
            if e.code in (400, 401, 403, 404):
                break
            if e.code == 429:
                time.sleep(15)
        except Exception as e:  # rete, timeout, DNS
            msg = str(e)
            if "Tunnel connection failed" in msg or "Forbidden" in msg:
                raise SourceError(f"non raggiungibile dalla rete di questo server ({url.split('/')[2]})")
            last = f"{type(e).__name__}: {e}"
        time.sleep(2 * (attempt + 1))
    raise SourceError(last or f"errore su {url}")


# Statistiche delle colonne football-data.co.uk (stesso formato nel mirror GitHub).
# Si usa una LISTA BIANCA: ogni altra colonna (quote, mercati, medie dei bookmaker)
# viene scartata in lettura e non entra mai nel database.
FDCOUK_STATS = {
    "HS": ("H", "tiri"), "AS": ("A", "tiri"),
    "HST": ("H", "tiri_porta"), "AST": ("A", "tiri_porta"),
    "HHW": ("H", "legni"), "AHW": ("A", "legni"),
    "HC": ("H", "corner"), "AC": ("A", "corner"),
    "HF": ("H", "falli"), "AF": ("A", "falli"),
    "HFKC": ("H", "punizioni_concesse"), "AFKC": ("A", "punizioni_concesse"),
    "HO": ("H", "fuorigioco"), "AO": ("A", "fuorigioco"),
    "HY": ("H", "gialli"), "AY": ("A", "gialli"),
    "HR": ("H", "rossi"), "AR": ("A", "rossi"),
    "HBP": ("H", "punti_disciplina"), "ABP": ("A", "punti_disciplina"),
}
FDCOUK_BASE = {"Div", "Date", "Time", "HomeTeam", "AwayTeam", "FTHG", "FTAG", "FTR",
               "HTHG", "HTAG", "HTR", "Referee", "Attendance", "HG", "AG", "Res", "Home", "Away"}


def to_int(v):
    if v is None:
        return None
    v = str(v).strip()
    if v == "" or v.upper() in ("NA", "N/A", "-"):
        return None
    try:
        return int(float(v))
    except ValueError:
        return None
