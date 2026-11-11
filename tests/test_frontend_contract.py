import json
from pathlib import Path

import numpy as np
import pytest
from analysis import heatmap
from analysis.indices import PRESETS, REGISTRY, UNVERIFIED
from analysis.scoring import INDEX_PROFILES, WEIGHTS


@pytest.mark.parametrize('layer', ['suitability', 'ndmi', 'slope', 'solarexposure'])
def test_legends_match_actual_raster_colors(layer):
    spec = heatmap.DISPLAY[layer]
    legend = heatmap._legend(spec)
    assert legend['vmin'] == spec['vmin'] and legend['vmax'] == spec['vmax']
    assert len(legend['colors']) == 256
    rgba = np.asarray(heatmap._colorize(np.linspace(spec['vmin'], spec['vmax'], 256)[None, :], spec['vmin'], spec['vmax'], spec['cmap']))
    assert legend['colors'] == ['#%02x%02x%02x' % tuple(pixel[:3]) for pixel in rgba[0]]
    assert np.asarray(heatmap._colorize(np.array([[np.nan]]), spec['vmin'], spec['vmax'], spec['cmap']))[0, 0, 3] == 0


def test_frontend_presets_are_exported_from_engine():
    path = Path(__file__).resolve().parents[1]/'frontend/app/src/data/science.json'
    data = json.loads(path.read_text(encoding='utf-8'))
    assert data['indices'] == [i for i in REGISTRY if i not in UNVERIFIED]
    for study, exported in data['presets'].items():
        assert exported['indices'] == PRESETS[study]['indices']
        weights = PRESETS[study].get('weights') or WEIGHTS
        assert exported['scoring_indices'] == [k for k in INDEX_PROFILES if weights.get(k, 0) > 0]
