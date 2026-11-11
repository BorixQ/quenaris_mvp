"""Export literal preset metadata without initializing Django or Earth Engine."""
import ast
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
def literal(path, name):
    for node in ast.parse(path.read_text(encoding='utf-8')).body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in node.targets):
            return ast.literal_eval(node.value)
    raise ValueError(name)

if __name__ == '__main__':
    indices = ROOT/'backend/analysis/indices.py'
    presets = literal(indices, 'PRESETS')
    profiles = literal(ROOT/'backend/analysis/scoring.py', 'INDEX_PROFILES')
    data = {'indices':[i for i in literal(indices, 'REGISTRY') if i not in ('LAI','WDI')], 'presets':{}}
    for study in ('agro','reforestacion','riego','fumigacion','fertilizacion'):
        p = presets[study]
        weights = p.get('weights') or {k:v['weight'] for k,v in profiles.items()}
        data['presets'][study] = {'indices':p['indices'], 'scoring_indices':[k for k in profiles if weights.get(k,0)>0]}
    dest = ROOT/'frontend/app/src/data/science.json'
    dest.parent.mkdir(parents=True,exist_ok=True)
    dest.write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
