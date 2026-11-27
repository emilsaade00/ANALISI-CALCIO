"""Verifica che web/model.js e pipeline/events.py diano le stesse probabilita'."""
import json, subprocess, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from pipeline.events import events

ROOT = Path(__file__).resolve().parent.parent
preds = json.loads((ROOT / "web/data/p/sa-2526.json").read_text())
sample = [v["p"] for v in list(preds.values())[:40]]
js = f"""
const CM=require('{ROOT}/web/model.js');
const S={json.dumps(sample)};
console.log(JSON.stringify(S.map(p=>[CM.events(p,false),CM.events(p,true)])));
"""
out = json.loads(subprocess.check_output(["node", "-e", js]))
worst = 0
for p, (jm, jb) in zip(sample, out):
    for mode, jl in ((False, jm), (True, jb)):
        pl = events(p, baseline=mode)
        assert len(pl) == len(jl), (len(pl), len(jl))
        for a, b in zip(pl, jl):
            assert a[0] == b[0] and a[1] == b[1], (a, b)
            worst = max(worst, abs(a[3] - b[3]))
print(f"parita' OK su {len(sample)} pronostici, differenza massima {worst:.2e}")
assert worst < 1e-9
