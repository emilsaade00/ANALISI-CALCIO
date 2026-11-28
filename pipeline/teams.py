"""Normalizzazione dei nomi squadra tra fonti diverse.

Il nome canonico e' quello di football-data.co.uk (fonte delle statistiche).
Ogni fonte usa nomi diversi: qui si mappano tutti sullo stesso identificativo.
Un nome sconosciuto viene segnalato nello stato fonti, mai inventato.
"""
import re
import unicodedata
import difflib

# canonico -> (nome visualizzato in italiano, [alias di altre fonti])
TEAMS = {
    "sa": {
        "Atalanta": ("Atalanta", ["Atalanta BC"]),
        "Bologna": ("Bologna", ["Bologna FC 1909"]),
        "Cagliari": ("Cagliari", ["Cagliari Calcio"]),
        "Como": ("Como", ["Como 1907"]),
        "Cremonese": ("Cremonese", ["US Cremonese"]),
        "Empoli": ("Empoli", ["Empoli FC"]),
        "Fiorentina": ("Fiorentina", ["ACF Fiorentina"]),
        "Frosinone": ("Frosinone", ["Frosinone Calcio"]),
        "Genoa": ("Genoa", ["Genoa CFC"]),
        "Inter": ("Inter", ["FC Internazionale Milano", "Internazionale", "Inter Milan"]),
        "Juventus": ("Juventus", ["Juventus FC"]),
        "Lazio": ("Lazio", ["SS Lazio"]),
        "Lecce": ("Lecce", ["US Lecce"]),
        "Milan": ("Milan", ["AC Milan"]),
        "Monza": ("Monza", ["AC Monza"]),
        "Napoli": ("Napoli", ["SSC Napoli"]),
        "Parma": ("Parma", ["Parma Calcio 1913"]),
        "Pisa": ("Pisa", ["AC Pisa 1909"]),
        "Roma": ("Roma", ["AS Roma"]),
        "Salernitana": ("Salernitana", ["US Salernitana 1919"]),
        "Sassuolo": ("Sassuolo", ["US Sassuolo Calcio"]),
        "Spezia": ("Spezia", ["Spezia Calcio"]),
        "Sampdoria": ("Sampdoria", ["UC Sampdoria"]),
        "Torino": ("Torino", ["Torino FC"]),
        "Udinese": ("Udinese", ["Udinese Calcio"]),
        "Venezia": ("Venezia", ["Venezia FC"]),
        "Verona": ("Hellas Verona", ["Hellas Verona FC", "Hellas Verona"]),
        "Palermo": ("Palermo", ["Palermo FC"]),
        "Bari": ("Bari", ["SSC Bari"]),
    },
    "pl": {
        "Arsenal": ("Arsenal", ["Arsenal FC"]),
        "Aston Villa": ("Aston Villa", ["Aston Villa FC"]),
        "Bournemouth": ("Bournemouth", ["AFC Bournemouth"]),
        "Brentford": ("Brentford", ["Brentford FC"]),
        "Brighton": ("Brighton", ["Brighton & Hove Albion FC", "Brighton & Hove Albion", "Brighton Hove"]),
        "Burnley": ("Burnley", ["Burnley FC"]),
        "Chelsea": ("Chelsea", ["Chelsea FC"]),
        "Coventry": ("Coventry", ["Coventry City FC", "Coventry City"]),
        "Crystal Palace": ("Crystal Palace", ["Crystal Palace FC"]),
        "Everton": ("Everton", ["Everton FC"]),
        "Fulham": ("Fulham", ["Fulham FC"]),
        "Hull": ("Hull City", ["Hull City AFC", "Hull City"]),
        "Ipswich": ("Ipswich", ["Ipswich Town FC", "Ipswich Town"]),
        "Leeds": ("Leeds", ["Leeds United FC", "Leeds United"]),
        "Leicester": ("Leicester", ["Leicester City FC", "Leicester City"]),
        "Liverpool": ("Liverpool", ["Liverpool FC"]),
        "Luton": ("Luton", ["Luton Town FC", "Luton Town"]),
        "Man City": ("Manchester City", ["Manchester City FC", "Manchester City"]),
        "Man United": ("Manchester United", ["Manchester United FC", "Manchester United", "Man Utd", "Man Utd."]),
        "Middlesbrough": ("Middlesbrough", ["Middlesbrough FC"]),
        "Newcastle": ("Newcastle", ["Newcastle United FC", "Newcastle United"]),
        "Norwich": ("Norwich", ["Norwich City FC", "Norwich City"]),
        "Nott'm Forest": ("Nottingham Forest", ["Nottingham Forest FC", "Nottingham Forest"]),
        "Sheffield United": ("Sheffield United", ["Sheffield United FC", "Sheffield Utd"]),
        "Southampton": ("Southampton", ["Southampton FC"]),
        "Sunderland": ("Sunderland", ["Sunderland AFC"]),
        "Tottenham": ("Tottenham", ["Tottenham Hotspur FC", "Tottenham Hotspur", "Spurs"]),
        "West Brom": ("West Bromwich", ["West Bromwich Albion FC", "West Bromwich Albion"]),
        "West Ham": ("West Ham", ["West Ham United FC", "West Ham United"]),
        "Wolves": ("Wolverhampton", ["Wolverhampton Wanderers FC", "Wolverhampton Wanderers", "Wolves"]),
    },
    "bl": {
        "Augsburg": ("Augsburg", ["FC Augsburg"]),
        "Bayern Munich": ("Bayern Monaco", ["FC Bayern München", "Bayern München", "Bayern Munchen"]),
        "Bochum": ("Bochum", ["VfL Bochum 1848", "VfL Bochum"]),
        "Darmstadt": ("Darmstadt", ["SV Darmstadt 98"]),
        "Dortmund": ("Borussia Dortmund", ["Borussia Dortmund"]),
        "Ein Frankfurt": ("Eintracht Francoforte", ["Eintracht Frankfurt"]),
        "Elversberg": ("Elversberg", ["SV 07 Elversberg", "SV Elversberg"]),
        "FC Koln": ("Colonia", ["1. FC Köln", "1. FC Koln", "FC Köln", "FC Cologne", "Cologne"]),
        "Freiburg": ("Friburgo", ["SC Freiburg"]),
        "Hamburg": ("Amburgo", ["Hamburger SV"]),
        "Heidenheim": ("Heidenheim", ["1. FC Heidenheim 1846", "1. FC Heidenheim"]),
        "Hertha": ("Hertha Berlino", ["Hertha BSC"]),
        "Hoffenheim": ("Hoffenheim", ["TSG 1899 Hoffenheim", "TSG Hoffenheim"]),
        "Holstein Kiel": ("Holstein Kiel", ["Holstein Kiel"]),
        "Leverkusen": ("Bayer Leverkusen", ["Bayer 04 Leverkusen", "Bayer Leverkusen"]),
        "M'gladbach": ("Borussia M'gladbach", ["Borussia Mönchengladbach", "Borussia Monchengladbach"]),
        "Mainz": ("Mainz", ["1. FSV Mainz 05", "FSV Mainz 05"]),
        "Paderborn": ("Paderborn", ["SC Paderborn 07"]),
        "RB Leipzig": ("RB Lipsia", ["RB Leipzig"]),
        "Schalke 04": ("Schalke 04", ["FC Schalke 04"]),
        "St Pauli": ("St. Pauli", ["FC St. Pauli 1910", "FC St. Pauli"]),
        "Stuttgart": ("Stoccarda", ["VfB Stuttgart"]),
        "Union Berlin": ("Union Berlino", ["1. FC Union Berlin"]),
        "Werder Bremen": ("Werder Brema", ["SV Werder Bremen"]),
        "Wolfsburg": ("Wolfsburg", ["VfL Wolfsburg"]),
        "Hannover": ("Hannover", ["Hannover 96"]),
        "Nurnberg": ("Norimberga", ["1. FC Nürnberg"]),
        "Karlsruhe": ("Karlsruhe", ["Karlsruher SC"]),
        "Kaiserslautern": ("Kaiserslautern", ["1. FC Kaiserslautern"]),
    },
    "ll": {
        "Alaves": ("Alavés", ["Deportivo Alavés", "Deportivo Alaves", "Alavés"]),
        "Almeria": ("Almería", ["UD Almería", "UD Almeria", "Almería"]),
        "Ath Bilbao": ("Athletic Bilbao", ["Athletic Club", "Athletic Club Bilbao", "Athletic Bilbao"]),
        "Ath Madrid": ("Atlético Madrid", ["Club Atlético de Madrid", "Atlético de Madrid", "Atletico Madrid", "Atlético Madrid"]),
        "Barcelona": ("Barcellona", ["FC Barcelona", "Barcelona"]),
        "Betis": ("Betis", ["Real Betis Balompié", "Real Betis", "Real Betis Balompie"]),
        "Cadiz": ("Cádiz", ["Cádiz CF", "Cadiz CF"]),
        "Celta": ("Celta Vigo", ["RC Celta de Vigo", "Celta Vigo", "Celta"]),
        "Elche": ("Elche", ["Elche CF"]),
        "Espanol": ("Espanyol", ["RCD Espanyol de Barcelona", "RCD Espanyol", "Espanyol"]),
        "Getafe": ("Getafe", ["Getafe CF"]),
        "Girona": ("Girona", ["Girona FC"]),
        "Granada": ("Granada", ["Granada CF"]),
        "La Coruna": ("Deportivo La Coruña", ["RC Deportivo La Coruña", "RC Deportivo", "Deportivo La Coruna", "Dep. La Coruna", "Deportivo"]),
        "Las Palmas": ("Las Palmas", ["UD Las Palmas"]),
        "Leganes": ("Leganés", ["CD Leganés", "CD Leganes"]),
        "Levante": ("Levante", ["Levante UD"]),
        "Malaga": ("Málaga", ["Málaga CF", "Malaga CF"]),
        "Mallorca": ("Maiorca", ["RCD Mallorca", "Mallorca"]),
        "Osasuna": ("Osasuna", ["CA Osasuna"]),
        "Oviedo": ("Real Oviedo", ["Real Oviedo"]),
        "Real Madrid": ("Real Madrid", ["Real Madrid CF"]),
        "Santander": ("Racing Santander", ["Real Racing Club de Santander", "R. Racing Club", "Racing Santander", "Racing Club"]),
        "Sevilla": ("Siviglia", ["Sevilla FC"]),
        "Sociedad": ("Real Sociedad", ["Real Sociedad de Fútbol", "Real Sociedad"]),
        "Valencia": ("Valencia", ["Valencia CF"]),
        "Valladolid": ("Valladolid", ["Real Valladolid CF", "Real Valladolid"]),
        "Vallecano": ("Rayo Vallecano", ["Rayo Vallecano de Madrid", "Rayo Vallecano"]),
        "Villarreal": ("Villarreal", ["Villarreal CF"]),
    },
}


def norm(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    s = s.replace("&", " and ").replace("'", "")
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return s


def slug(name: str) -> str:
    return norm(name).replace(" ", "-")


def team_id(league: str, canonical: str) -> str:
    return f"{league}-{slug(canonical)}"


class TeamResolver:
    """Restituisce l'id squadra a partire da un nome di qualsiasi fonte."""

    def __init__(self):
        self.by_alias = {}
        self.display = {}
        self.unknown = []  # (lega, nome, fonte)
        for lg, teams in TEAMS.items():
            for canon, (disp, aliases) in teams.items():
                tid = team_id(lg, canon)
                self.display[tid] = (canon, disp)
                for a in [canon, disp] + aliases:
                    self.by_alias[(lg, norm(a))] = tid

    def resolve(self, league: str, name: str, source: str = "", allow_new: bool = True):
        key = (league, norm(name))
        if key in self.by_alias:
            return self.by_alias[key]
        # tentativo prudente: somiglianza alta con un alias noto della stessa lega
        cands = {a: t for (lg, a), t in self.by_alias.items() if lg == league}
        best = difflib.get_close_matches(norm(name), list(cands), n=1, cutoff=0.88)
        if best:
            tid = cands[best[0]]
            self.by_alias[key] = tid
            return tid
        self.unknown.append((league, name, source))
        if not allow_new:
            return None
        tid = team_id(league, name)
        self.display[tid] = (name, name)
        self.by_alias[key] = tid
        return tid

    def names(self, tid):
        return self.display.get(tid, (tid, tid))
