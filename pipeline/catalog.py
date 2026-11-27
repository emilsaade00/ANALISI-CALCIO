"""Catalogo delle statistiche: definizione, unita', fonte, formula di calcolo.

La formula ('f') e' interpretata dall'app web. Tipi:
  raw     valore della fonte per la squadra (for), l'avversaria (against) o la somma (total)
  goals   gol fatti/subiti/totali/differenza, anche per tempo ('ht' = primo tempo, 'st' = secondo)
  res     esito: W, D, L, pts
  flag    eventi si'/no (porta inviolata, senza segnare, entrambe a segno)
  ratio   rapporto tra somme (es. tiri in porta / tiri)
  na      non disponibile con le fonti configurate (indica la fonte che servirebbe)
Aggregazione 'agg': mean = media per partita; rate = % di partite; ratio = rapporto tra totali.
"""

C_RES, C_OFF, C_SHO, C_DEF, C_DIS, C_COR, C_INT = (
    "Risultati e gol", "Costruzione offensiva", "Tiri", "Difesa e portieri",
    "Disciplina", "Corner", "Intensità")
C_POS = C_OFF

FD = "football-data.co.uk / open-matchday"
AF = "API-Football"
FM = "FotMob via FPL-Core-Insights (solo Premier League)"
FMAF = FM + "; API-Football se attiva"
OF = "open-matchday / openfootball / football-data.org"


def m(code, name, cat, unit, agg, f, src, definition, model=None):
    return {"code": code, "name": name, "cat": cat, "unit": unit, "agg": agg, "f": f,
            "src": src, "def": definition, "model": model}


def raw(k, s="for"):
    return {"t": "raw", "k": k, "s": s}


def ratio(a, b, s="for", pct=True, bs=None):
    f = {"t": "ratio", "a": a, "b": b, "s": s, "pct": pct}
    if bs:
        f["bs"] = bs
    return f


BANDS = [(0, 15), (16, 30), (31, 45), (46, 60), (61, 75), (76, 90)]

TEAM_METRICS = [
    # Risultati e gol
    m("vittorie", "Vittorie", C_RES, "% partite", "rate", {"t": "res", "v": "W"}, OF, "Partite vinte sul totale delle partite considerate."),
    m("pareggi", "Pareggi", C_RES, "% partite", "rate", {"t": "res", "v": "D"}, OF, "Partite pareggiate sul totale."),
    m("sconfitte", "Sconfitte", C_RES, "% partite", "rate", {"t": "res", "v": "L"}, OF, "Partite perse sul totale."),
    m("punti", "Punti", C_RES, "punti/partita", "mean", {"t": "res", "v": "pts"}, OF, "3 per la vittoria, 1 per il pareggio, 0 per la sconfitta."),
    m("gol_fatti", "Gol fatti", C_RES, "gol/partita", "mean", {"t": "goals", "v": "for"}, OF, "Gol segnati nei 90 minuti (recupero incluso).", "gol"),
    m("gol_subiti", "Gol subiti", C_RES, "gol/partita", "mean", {"t": "goals", "v": "against"}, OF, "Gol incassati nei 90 minuti."),
    m("gol_totali", "Gol totali in partita", C_RES, "gol/partita", "mean", {"t": "goals", "v": "total"}, OF, "Somma dei gol delle due squadre."),
    m("diff_reti", "Differenza reti", C_RES, "gol/partita", "mean", {"t": "goals", "v": "diff"}, OF, "Gol fatti meno gol subiti."),
    m("porta_inviolata", "Porte inviolate", C_RES, "% partite", "rate", {"t": "flag", "v": "cs"}, OF, "Partite senza gol subiti."),
    m("senza_segnare", "Gare senza segnare", C_RES, "% partite", "rate", {"t": "flag", "v": "fts"}, OF, "Partite chiuse con zero gol fatti."),
    m("entrambe_segnano", "Entrambe a segno", C_RES, "% partite", "rate", {"t": "flag", "v": "btts"}, OF, "Partite in cui hanno segnato entrambe le squadre."),
    m("gol_fatti_1t", "Gol fatti nel 1° tempo", C_RES, "gol/partita", "mean", {"t": "goals", "v": "for", "p": "ht"}, OF, "Gol segnati entro l'intervallo."),
    m("gol_fatti_2t", "Gol fatti nel 2° tempo", C_RES, "gol/partita", "mean", {"t": "goals", "v": "for", "p": "st"}, OF, "Gol finali meno gol del primo tempo."),
    m("gol_subiti_1t", "Gol subiti nel 1° tempo", C_RES, "gol/partita", "mean", {"t": "goals", "v": "against", "p": "ht"}, OF, "Gol incassati entro l'intervallo."),
    m("gol_subiti_2t", "Gol subiti nel 2° tempo", C_RES, "gol/partita", "mean", {"t": "goals", "v": "against", "p": "st"}, OF, "Gol incassati nel secondo tempo."),
] + [m(f"gol_partita_{a}_{b}", f"Gol nelle sue partite, minuti {a}–{b}{'+' if b in (45, 90) else ''}", C_RES, "gol/partita", "mean",
       {"t": "gband", "a": a, "b": b, "s": "total"}, "open-matchday (minuti dei gol)",
       f"Gol segnati da entrambe le squadre tra il minuto {a} e il {b}{' (recupero incluso)' if b in (45, 90) else ''}.") for a, b in BANDS] + [
    # Costruzione offensiva
    m("possesso", "Possesso palla", C_OFF, "%", "mean", raw("possesso"), FMAF, "Quota di possesso secondo il fornitore."),
    m("passaggi", "Passaggi tentati", C_OFF, "per partita", "mean", raw("passaggi"), FMAF, "Passaggi totali."),
    m("passaggi_riusciti", "Passaggi riusciti", C_OFF, "per partita", "mean", raw("passaggi_riusciti"), FMAF, "Passaggi arrivati a un compagno."),
    m("precisione_passaggi", "Precisione passaggi", C_OFF, "%", "ratio", ratio("passaggi_riusciti", "passaggi"), FMAF, "Passaggi riusciti diviso tentati."),
    m("passaggi_meta_avversaria", "Passaggi nella metà campo avversaria", C_OFF, "per partita", "mean", raw("passaggi_meta_avversaria"), FM, "Passaggi giocati nella metà campo avversaria."),
    m("passaggi_chiave", "Passaggi chiave (occasioni create)", C_OFF, "per partita", "mean", {"t": "rawp", "k": "passaggi_chiave"}, "Match Report Lega Serie A; FotMob (Premier League)", "Passaggi che portano direttamente a un tiro."),
    m("passaggi_ultimo_terzo", "Passaggi nell'ultimo terzo", C_OFF, "per partita", "mean", {"t": "rawp", "k": "passaggi_ultimo_terzo"}, "Match Report Lega Serie A; FotMob (Premier League)", "Passaggi riusciti giocati nell'ultimo terzo di campo."),
    m("passaggi_avanti", "Palloni giocati in avanti riusciti", C_OFF, "per partita", "mean", raw("passaggi_avanti"), "Match Report Lega Serie A", "Passaggi riusciti verso la porta avversaria."),
    m("lanci_lunghi", "Lanci lunghi", C_OFF, "per partita", "mean", raw("lanci_lunghi"), "Match Report Lega Serie A; FotMob", "Passaggi lunghi tentati."),
    m("tocchi_area_avversaria", "Tocchi nell'area avversaria", C_OFF, "per partita", "mean", raw("tocchi_area_avversaria"), FM, "Palloni toccati dentro l'area di rigore avversaria (indicatore di ingressi in area)."),
    m("cross", "Cross tentati", C_OFF, "per partita", "mean", raw("cross"), FM, "Cross tentati (riusciti diviso percentuale di riuscita)."),
    m("cross_riusciti", "Cross riusciti", C_OFF, "per partita", "mean", raw("cross_riusciti"), FM, "Cross arrivati a un compagno."),
    m("precisione_cross", "Precisione cross", C_OFF, "%", "ratio", ratio("cross_riusciti", "cross"), FM, "Cross riusciti diviso tentati."),
    m("lanci_lunghi_riusciti", "Lanci lunghi riusciti", C_OFF, "per partita", "mean", raw("lanci_lunghi_riusciti"), FM, "Lanci lunghi arrivati a un compagno."),
    m("dribbling_tentati", "Dribbling tentati", C_OFF, "per partita", "mean", raw("dribbling_tentati"), FMAF, "Tentativi di superare l'avversario palla al piede."),
    m("dribbling_riusciti", "Dribbling riusciti", C_OFF, "per partita", "mean", raw("dribbling_riusciti"), FMAF, "Dribbling completati."),
    m("precisione_dribbling", "Dribbling riusciti in %", C_OFF, "%", "ratio", ratio("dribbling_riusciti", "dribbling_tentati"), FMAF, "Dribbling riusciti diviso tentati."),
    m("grandi_occasioni", "Grandi occasioni", C_OFF, "per partita", "mean", raw("grandi_occasioni"), FM, "Occasioni in cui ci si aspetta ragionevolmente un gol (definizione del fornitore)."),
    m("xg", "xG (expected goals)", C_OFF, "xG/partita", "mean", raw("xg"), "xG del fornitore FotMob (Premier League) o API-Football", "Gol attesi secondo il modello del fornitore indicato. Fornitori diversi danno valori diversi."),
    m("xg_azione", "xG su azione", C_OFF, "xG/partita", "mean", raw("xg_azione"), "xG del fornitore FotMob", "Gol attesi da azioni manovrate."),
    m("xg_piazzati", "xG su calci piazzati", C_OFF, "xG/partita", "mean", raw("xg_piazzati"), "xG del fornitore FotMob", "Gol attesi da calci piazzati: rendimento sulle palle inattive."),
    m("xg_no_rigori", "xG senza rigori", C_OFF, "xG/partita", "mean", raw("xg_no_rigori"), "xG del fornitore FotMob", "Gol attesi esclusi i rigori."),
    m("fuorigioco", "Fuorigioco", C_OFF, "per partita", "mean", raw("fuorigioco"), FMAF, "Fuorigioco fischiati alla squadra."),
    # Tiri
    m("tiri", "Tiri totali", C_SHO, "tiri/partita", "mean", raw("tiri"), FD, "Tutte le conclusioni verso la porta, in porta o no.", "tiri"),
    m("tiri_porta", "Tiri in porta", C_SHO, "tiri/partita", "mean", raw("tiri_porta"), FD, "Conclusioni nello specchio (gol inclusi).", "tiri_porta"),
    m("tiri_non_porta", "Tiri non in porta (fuori + respinti)", C_SHO, "tiri/partita", "mean", {"t": "diff", "a": "tiri", "b": "tiri_porta", "s": "for"}, FD, "Tiri totali meno tiri in porta."),
    m("tiri_fuori", "Tiri fuori", C_SHO, "tiri/partita", "mean", raw("tiri_fuori"), FMAF, "Conclusioni fuori dallo specchio."),
    m("tiri_respinti", "Tiri respinti", C_SHO, "tiri/partita", "mean", raw("tiri_respinti"), FMAF, "Conclusioni bloccate da un difensore."),
    m("tiri_area", "Tiri dall'area", C_SHO, "tiri/partita", "mean", raw("tiri_area"), FMAF, "Conclusioni da dentro l'area di rigore."),
    m("tiri_fuori_area", "Tiri da fuori area", C_SHO, "tiri/partita", "mean", raw("tiri_fuori_area"), FMAF, "Conclusioni da fuori area."),
    m("precisione_tiro", "Precisione al tiro", C_SHO, "%", "ratio", ratio("tiri_porta", "tiri"), FD, "Tiri in porta diviso tiri totali."),
    m("conversione", "Gol per tiro", C_SHO, "%", "ratio", ratio("@gol", "tiri"), FD, "Gol fatti diviso tiri totali."),
    m("legni", "Pali e traverse", C_SHO, "per partita", "mean", raw("legni"), "football-data.co.uk (alcune stagioni) / FotMob", "Conclusioni sui legni."),
    m("grandi_occasioni_sbagliate", "Grandi occasioni sbagliate", C_SHO, "per partita", "mean", raw("grandi_occasioni_sbagliate"), FM, "Grandi occasioni non trasformate."),
    m("xgot", "xG sui tiri in porta (xGOT)", C_SHO, "per partita", "mean", raw("xgot"), "xG del fornitore FotMob", "Gol attesi calcolati dopo il tiro, solo per i tiri nello specchio."),
    m("xg_per_tiro", "xG per tiro", C_SHO, "xG/tiro", "ratio", ratio("xg", "tiri", pct=False), "xG del fornitore indicato", "xG totali diviso tiri."),
    # Difesa e portieri
    m("tiri_concessi", "Tiri concessi", C_DEF, "tiri/partita", "mean", raw("tiri", "against"), FD, "Tiri effettuati dagli avversari."),
    m("tiri_porta_concessi", "Tiri in porta concessi", C_DEF, "tiri/partita", "mean", raw("tiri_porta", "against"), FD, "Tiri in porta degli avversari."),
    m("xg_concessi", "xG concessi", C_DEF, "xG/partita", "mean", raw("xg", "against"), "xG del fornitore indicato", "Gol attesi degli avversari."),
    m("grandi_occasioni_concesse", "Grandi occasioni concesse", C_DEF, "per partita", "mean", raw("grandi_occasioni", "against"), FM, "Grandi occasioni avute dagli avversari."),
    m("parate", "Parate", C_DEF, "parate/partita", "mean", raw("parate"), FMAF, "Interventi del portiere su tiri in porta."),
    m("perc_parate", "Percentuale di parate", C_DEF, "%", "ratio", ratio("parate", "tiri_porta", bs="against"), FMAF, "Parate diviso tiri in porta subiti. Non applicabile se non si subiscono tiri in porta."),
    m("contrasti", "Contrasti tentati", C_DEF, "per partita", "mean", raw("contrasti"), FMAF, "Interventi per sottrarre il pallone all'avversario."),
    m("contrasti_vinti", "Contrasti vinti", C_DEF, "per partita", "mean", raw("contrasti_vinti"), FM, "Contrasti con cui la squadra recupera il pallone."),
    m("precisione_contrasti", "Contrasti vinti in %", C_DEF, "%", "ratio", ratio("contrasti_vinti", "contrasti"), FM, "Contrasti vinti diviso tentati."),
    m("intercetti", "Intercetti", C_DEF, "per partita", "mean", raw("intercetti"), FMAF, "Passaggi avversari intercettati."),
    m("respinte", "Respinte su tiro", C_DEF, "per partita", "mean", raw("respinte"), FMAF, "Tiri avversari bloccati."),
    m("spazzate", "Spazzate", C_DEF, "per partita", "mean", raw("spazzate"), FM, "Palloni allontanati dalla propria area."),
    m("recuperi", "Recuperi palla", C_DEF, "per partita", "mean", {"t": "rawp", "k": "recuperi"}, "Match Report Lega Serie A; FotMob (Premier League)", "Palloni conquistati dalla squadra."),
    m("duelli_vinti", "Duelli vinti", C_DEF, "per partita", "mean", raw("duelli_vinti"), FMAF, "Contese individuali vinte (a terra e aeree)."),
    m("duelli_aerei_vinti", "Duelli aerei vinti", C_DEF, "per partita", "mean", raw("duelli_aerei_vinti"), FM, "Contese di testa vinte."),
    m("duelli_terra_vinti", "Duelli a terra vinti", C_DEF, "per partita", "mean", raw("duelli_terra_vinti"), FM, "Contese a terra vinte."),
    m("dribbling_subiti", "Dribbling subiti", C_DEF, "per partita", "mean", {"t": "psum", "k": "dribblato"}, FMAF + " (somma giocatori)", "Volte in cui un giocatore è stato superato in dribbling."),
    m("gol_evitati", "Gol evitati dal portiere", C_DEF, "per partita", "mean", {"t": "psum", "k": "gol_evitati"}, FM + " (somma giocatori)", "xG sui tiri in porta subiti meno gol subiti: positivo se il portiere para più del previsto."),
    m("errori_tiro_gol", "Errori che portano al tiro o al gol", C_DEF, "per partita", "mean", {"t": "na"}, "Fonte Opta con licenza", "Non fornita dalle fonti configurate."),
    m("rigori_affrontati", "Rigori affrontati", C_DEF, "per partita", "mean", {"t": "na"}, "Fonte con dati evento", "Non fornita in forma completa dalle fonti configurate."),
    # Disciplina
    m("falli", "Falli commessi", C_DIS, "falli/partita", "mean", raw("falli"), FD, "Falli fischiati contro la squadra.", "falli"),
    m("falli_subiti", "Falli subiti", C_DIS, "falli/partita", "mean", raw("falli", "against"), FD, "Falli commessi dagli avversari."),
    m("gialli", "Ammonizioni", C_DIS, "per partita", "mean", raw("gialli"), FD, "Cartellini gialli come conteggiati dalla fonte."),
    m("rossi", "Espulsioni", C_DIS, "per partita", "mean", raw("rossi"), FD, "Cartellini rossi (la fonte non separa rossi diretti e doppie ammonizioni)."),
    m("cartellini", "Cartellini totali (gialli + rossi)", C_DIS, "per partita", "mean", {"t": "sum", "k": ["gialli", "rossi"], "s": "for"}, FD,
      "Regola di conteggio: ogni giallo vale 1 e ogni rosso vale 1, come registrati dalla fonte. Un'espulsione per doppia ammonizione può risultare come giallo + rosso.", "cartellini"),
    m("cartellini_subiti", "Cartellini avversari", C_DIS, "per partita", "mean", {"t": "sum", "k": ["gialli", "rossi"], "s": "against"}, FD, "Cartellini ricevuti dagli avversari."),
    m("rigori_commessi", "Rigori concessi", C_DIS, "per partita", "mean", {"t": "psum", "k": "rigori_commessi"}, AF + " (somma giocatori)", "Rigori provocati dai giocatori della squadra."),
    m("seconde_ammonizioni", "Seconde ammonizioni", C_DIS, "per partita", "mean", {"t": "na"}, "API-Football (eventi partita)", "Richiede i dati evento: fonte non attiva."),
    m("rossi_diretti", "Espulsioni dirette", C_DIS, "per partita", "mean", {"t": "na"}, "API-Football (eventi partita)", "Richiede i dati evento: fonte non attiva."),
    m("punti_disciplina", "Punti disciplina", C_DIS, "punti/partita", "mean", raw("punti_disciplina"), "football-data.co.uk", "10 per giallo, 25 per rosso (solo alcune stagioni)."),
    # Corner
    m("corner", "Corner a favore", C_COR, "corner/partita", "mean", raw("corner"), FD, "Calci d'angolo battuti dalla squadra.", "corner"),
    m("corner_contro", "Corner contro", C_COR, "corner/partita", "mean", raw("corner", "against"), FD, "Calci d'angolo concessi agli avversari."),
    m("corner_totali", "Corner totali in partita", C_COR, "corner/partita", "mean", raw("corner", "total"), FD, "Somma dei corner delle due squadre."),
    m("corner_1t", "Corner a favore nel 1° tempo", C_COR, "corner/partita", "mean", raw("corner_1t"), "open-matchday (FotMob)", "Corner battuti entro l'intervallo."),
    m("corner_2t", "Corner a favore nel 2° tempo", C_COR, "corner/partita", "mean", raw("corner_2t"), "open-matchday (FotMob)", "Corner battuti nel secondo tempo."),
    m("corner_contro_1t", "Corner contro nel 1° tempo", C_COR, "corner/partita", "mean", raw("corner_1t", "against"), "open-matchday (FotMob)", "Corner concessi entro l'intervallo."),
    m("corner_totali_1t", "Corner totali nel 1° tempo", C_COR, "corner/partita", "mean", raw("corner_1t", "total"), "open-matchday (FotMob)", "Corner delle due squadre nel primo tempo."),
    m("corner_totali_2t", "Corner totali nel 2° tempo", C_COR, "corner/partita", "mean", raw("corner_2t", "total"), "open-matchday (FotMob)", "Corner delle due squadre nel secondo tempo."),
    m("primo_corner", "Minuto del primo corner", C_COR, "minuto", "mean", {"t": "na"}, "Fonte con dati evento", "Richiede il minuto di ogni corner: fonte non attiva."),
    # Intensità
    m("distanza_km", "Distanza percorsa", C_INT, "km/partita", "mean", raw("distanza_km"), FM, "Chilometri percorsi dalla squadra."),
    m("sprint", "Sprint", C_INT, "per partita", "mean", raw("sprint"), FM, "Numero di sprint della squadra."),
]

P_GEN, P_ATT, P_PAS, P_DEF, P_DIS, P_GK = ("Presenze", "Tiri e gol", "Passaggi e dribbling", "Difesa e duelli", "Disciplina", "Portieri")

# codice, nome, categoria, per 90, formula ('sum' o rapporto num/den in %)
PLAYER_METRICS = [
    ("minuti", "Minuti", P_GEN, False), ("titolare", "Partite da titolare", P_GEN, False),
    ("gol", "Gol", P_ATT, True), ("assist", "Assist", P_ATT, True), ("tiri", "Tiri", P_ATT, True),
    ("tiri_porta", "Tiri in porta", P_ATT, True), ("xg", "xG", P_ATT, True), ("xa", "xA (assist attesi)", P_ATT, True),
    ("grandi_occasioni_sbagliate", "Grandi occasioni sbagliate", P_ATT, True), ("tocchi_area", "Tocchi in area avversaria", P_ATT, True),
    ("fuorigioco", "Fuorigioco", P_ATT, True), ("rigori_segnati", "Rigori segnati", P_ATT, False), ("rigori_sbagliati", "Rigori sbagliati", P_ATT, False),
    ("rigori_ottenuti", "Rigori ottenuti", P_ATT, False),
    ("passaggi", "Passaggi tentati", P_PAS, True), ("passaggi_riusciti", "Passaggi riusciti", P_PAS, True),
    ("passaggi_chiave", "Passaggi chiave", P_PAS, True), ("passaggi_ultimo_terzo", "Passaggi nell'ultimo terzo", P_PAS, True),
    ("cross", "Cross tentati", P_PAS, True), ("cross_riusciti", "Cross riusciti", P_PAS, True),
    ("lanci_lunghi_riusciti", "Lanci lunghi riusciti", P_PAS, True), ("tocchi", "Tocchi", P_PAS, True),
    ("dribbling_tentati", "Dribbling tentati", P_PAS, True), ("dribbling_riusciti", "Dribbling riusciti", P_PAS, True),
    ("contrasti", "Contrasti tentati", P_DEF, True), ("contrasti_vinti", "Contrasti vinti", P_DEF, True),
    ("intercetti", "Intercetti", P_DEF, True), ("recuperi", "Recuperi", P_DEF, True), ("respinte", "Respinte", P_DEF, True),
    ("spazzate", "Spazzate", P_DEF, True), ("duelli", "Duelli disputati", P_DEF, True), ("duelli_vinti", "Duelli vinti", P_DEF, True),
    ("duelli_persi", "Duelli persi", P_DEF, True), ("duelli_aerei_vinti", "Duelli aerei vinti", P_DEF, True),
    ("dribblato", "Volte superato in dribbling", P_DEF, True), ("contributi_difensivi", "Contributi difensivi (FPL)", P_DEF, True),
    ("falli_commessi", "Falli commessi", P_DIS, True), ("falli_subiti", "Falli subiti", P_DIS, True),
    ("gialli", "Gialli", P_DIS, False), ("rossi", "Rossi", P_DIS, False), ("rigori_commessi", "Rigori causati", P_DIS, False),
    ("parate", "Parate", P_GK, True), ("gol_subiti", "Gol subiti", P_GK, True), ("gol_evitati", "Gol evitati", P_GK, True),
    ("rigori_parati", "Rigori parati", P_GK, False), ("respinte_portiere", "Respinte del portiere", P_GK, True),
    ("lanci_lunghi", "Lanci lunghi", P_PAS, True), ("passaggi_avanti", "Passaggi in avanti riusciti", P_PAS, True),
    ("occasioni", "Occasioni da gol", P_ATT, True), ("distanza_km", "Km percorsi", P_GEN, True),
]
PLAYER_RATIOS = [
    ("perc_tiri_porta", "Tiri in porta in %", "tiri_porta", "tiri", P_ATT),
    ("perc_passaggi", "Precisione passaggi", "passaggi_riusciti", "passaggi", P_PAS),
    ("perc_dribbling", "Dribbling riusciti in %", "dribbling_riusciti", "dribbling_tentati", P_PAS),
    ("perc_contrasti", "Contrasti vinti in %", "contrasti_vinti", "contrasti", P_DEF),
    ("perc_duelli", "Duelli vinti in %", "duelli_vinti", "duelli", P_DEF),
]
PLAYER_NA = [("xg_su_azione", "xG su azione del giocatore", "Non fornito dalle fonti attive")]

REFEREE_METRICS = [
    ("falli", "Falli fischiati"), ("gialli", "Gialli"), ("rossi", "Rossi"), ("cartellini", "Cartellini totali"),
]
