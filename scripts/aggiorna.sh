#!/usr/bin/env bash
# Aggiornamento quotidiano eseguito da GitHub Actions.
set -euo pipefail
pip install -q -r requirements.txt
if [ -n "${RAPIDO:-}" ]; then
  # ogni 30 minuti: risultati appena conclusi e formazioni ufficiali, poi ricalcolo
  python -m pipeline.run --trigger "github-actions (rapido)" --nota "" --pianificazione "" --rapido
else
  python -m pipeline.run --trigger github-actions --nota "" --pianificazione "" ${TARATURA:+--tune}
  python tests/test_parity.py
  python tests/test_sources.py
fi
