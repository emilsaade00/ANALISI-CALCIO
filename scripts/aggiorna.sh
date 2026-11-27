#!/usr/bin/env bash
# Aggiornamento quotidiano eseguito da GitHub Actions.
set -euo pipefail
pip install -q -r requirements.txt
python -m pipeline.run --trigger github-actions --nota "" --pianificazione "" ${TARATURA:+--tune}
python tests/test_parity.py
python tests/test_sources.py
