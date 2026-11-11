import json
from datetime import date
from unittest.mock import patch

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from analysis import scoring, indices
from analysis.diagnosis_rules import infer_causes
from analysis.gee_pipeline import _analyze, cluster_pixels, _silhouette, _mask_s2_clouds, _composite, QUALITY_BANDS
from analysis.heatmap import _suitability_2d, _month_starts, _colorize


class ScalarImage:
    """Evaluate actual EE expressions locally; no network or alternate formulas."""
    def __init__(self, value): self.value = value
    def select(self, name): return ScalarImage(self.value[name])
    def divide(self, n): return ScalarImage(np.asarray(self.value) / n)
    def expression(self, expr, bands):
        with np.errstate(divide="ignore", invalid="ignore"):
            value = eval(expr, {"__builtins__": {}, "sqrt": np.sqrt}, {k: v.value for k,v in bands.items()})
        return ScalarImage(value)
    def abs(self): return ScalarImage(np.abs(self.value))
    def gt(self, x): return ScalarImage(self.value > x)
    def eq(self, x): return ScalarImage(np.asarray(self.value) == x)
    def Or(self, x): return ScalarImage(self.value | x.value)
    def updateMask(self, mask):
        if isinstance(self.value, dict): return ScalarImage({k: np.where(mask.value, v, np.nan) for k,v in self.value.items()})
        return ScalarImage(np.where(mask.value, self.value, np.nan))
    def rename(self, name): return ScalarImage({name: self.value})
    def addBands(self, images):
        values = dict(self.value)
        for img in images: values.update(img.value)
        return ScalarImage(values)


def test_reflectance_formulas_and_psri_mapping():
    result = indices.spectral_indices(ScalarImage({"B2": 500., "B3": 1000., "B4": 2000.,
        "B5": 3000., "B6": 4000., "B8": 6000., "B11": 2500., "B12": 1500.})).value
    assert result["NDVI"] == pytest.approx(.5)
    assert result["EVI"] == pytest.approx(1 / 2.425)
    assert result["SAVI"] == pytest.approx(.6 / 1.3)
    assert result["MSAVI"] == pytest.approx((2.2-np.sqrt(1.64))/2)
    assert result["PSRI"] == pytest.approx(.15/.4)
    assert result["BSI"] == pytest.approx(-.2/1.1)


def test_zero_denominators_are_missing():
    result = indices.spectral_indices(ScalarImage({b: 0. for b in ("B2","B3","B4","B5","B6","B8","B11","B12")})).value
    for name in ("NDVI", "PSRI", "NDMI", "BSI", "MSI", "SIPI"):
        assert np.isnan(result[name])


def test_cloud_shadow_water_snow_nodata_excluded():
    result = _mask_s2_clouds(ScalarImage({"SCL": np.arange(12), "B4": np.ones(12)})).value["B4"]
    assert np.flatnonzero(np.isfinite(result)).tolist() == [4, 5]


@pytest.mark.parametrize("study", ["agro", "reforestacion"])
def test_monthly_and_primary_score_identical_with_fixed_reference(study):
    preset = indices.PRESETS[study]
    raw = {n: np.linspace(.1, .7, 100) for n in preset["indices"]}
    ref = scoring.fit_reference(raw, preset.get("weights"), preset.get("profile_overrides"))
    primary = scoring.compute_suitability(raw, reference=ref)
    monthly = _suitability_2d({n:a.reshape(10,10) for n,a in raw.items()}, ref)
    np.testing.assert_allclose(primary, monthly.ravel())
    shifted = {n: a+.05 for n,a in raw.items()}
    # A changed input must not silently be re-fitted to the same ranks.
    assert not np.allclose(primary, scoring.compute_suitability(shifted, reference=ref))
    assert sum(p["weight"] for p in ref["profiles"].values()) == pytest.approx(1)


def test_constant_and_nonfinite_scores():
    raw = {"NDVI": np.ones(30)}
    np.testing.assert_allclose(scoring.compute_suitability(raw), 50)
    raw["NDVI"][0] = np.nan
    result = scoring.compute_suitability(raw)
    assert np.isnan(result[0])
    with pytest.raises(ValueError): scoring.compute_suitability({"Aspect": np.ones(30)})
    assert infer_causes({"NDVI": .1, "NDSI": .9}) == []


def test_no_final_contrast_stretch():
    ref = {"profiles": {"NDVI": {"direction":"high_good","weight":1,"low":0,"high":1}}}
    np.testing.assert_allclose(scoring.compute_suitability({"NDVI":np.array([.49,.50,.51])}, reference=ref),[49,50,51])


def test_homogeneous_small_and_nonfinite_clusters():
    labels, name = cluster_pixels(np.zeros((25,2)), "kmeans", 4)
    assert name == "homogeneous" and set(labels) == {0}
    with pytest.raises(ValueError): cluster_pixels(np.zeros((4,2)), "kmeans", 4)
    with pytest.raises(ValueError): cluster_pixels(np.full((25,2),np.inf), "kmeans", 4)
    with pytest.raises(ValueError): cluster_pixels(np.zeros((25,2)), "kmeans", 0)


def test_density_noise_is_not_forced_into_kmeans():
    X = np.arange(60).reshape(30,2)*100.
    labels, name = cluster_pixels(X, "dbscan", 4)
    assert name == "dbscan" and set(labels) == {-1}
    assert _silhouette(X, labels) is None


def test_month_intervals_end_exclusive():
    assert _month_starts(date(2025,1,20), date(2025,2,1)) == [date(2025,1,1)]
    assert _month_starts(date(2024,12,20), date(2025,2,2)) == [date(2024,12,1),date(2025,1,1),date(2025,2,1)]


def test_nodata_png_transparent():
    rgba = np.array(_colorize(np.array([[np.nan, 50]]), 0, 100, "RdYlGn"))
    assert rgba[0,0,3] == 0 and rgba[0,1,3] == 255


def raster_case(tmp_path, cloudy=False, small=False):
    values = np.linspace(.1,.8,100).reshape(10,10)
    data = np.stack([values, np.ones((10,10)), np.ones((10,10))*3]).astype("float32")
    data[0,0,:] = -9999
    if cloudy: data[0] = -9999
    if small: data[0].ravel()[5:] = -9999
    path = tmp_path / "case.tif"
    with rasterio.open(path,"w",driver="GTiff",height=10,width=10,count=3,dtype="float32",nodata=-9999,
        crs="EPSG:4326",transform=from_origin(-71.5,-16.4,.0002,.0002)) as dst: dst.write(data)
    return path


def test_full_raster_analysis_provenance_and_masks(tmp_path):
    with patch("analysis.gee_pipeline._importance", return_value=([],"none")):
        result = _analyze(str(raster_case(tmp_path)), ["NDVI"], "kmeans", 3, False, "agro")
    stats = result["statistics"]
    assert stats["quality"]["valid_pixels"] == 90
    assert stats["quality"]["valid_fraction"] == .9
    assert stats["calibrated"] is False
    assert all(c["differential"] == [] and c["label"].startswith("Grupo") for c in stats["clusters"])
    json.dumps(result, allow_nan=False)


@pytest.mark.parametrize("kwargs", [{"cloudy":True},{"small":True}])
def test_unusable_rasters_fail_honestly(tmp_path,kwargs):
    with pytest.raises(ValueError, match="Píxeles válidos insuficientes"):
        _analyze(str(raster_case(tmp_path,**kwargs)),["NDVI"],"kmeans",4,False,"agro")


@pytest.mark.parametrize("selection", [[], ["LAI"], ["WDI"], ["inventado"]])
def test_unverified_or_invalid_indices_rejected(selection):
    with pytest.raises(ValueError): indices.resolve_indices("agro",selection)


def test_actual_ee_graph_builds_without_network():
    import ee
    from ee.apitestcase import ApiTestCase
    api = ApiTestCase()
    api.setUp()
    try:
        aoi = ee.Geometry.Rectangle([-71.54,-16.41,-71.53,-16.40])
        composite = ee.Image.constant([500,1000,2000,3000,4000,6000,2500,1500]).rename(
            ["B2","B3","B4","B5","B6","B8","B11","B12"])
        graph = indices.build_index_stack(aoi, composite, indices.resolve_indices("agro",None)).serialize()
        assert json.loads(graph)  # verifies actual SDK signatures and graph construction
        with patch.object(ee.Number, "getInfo", return_value=3):
            period, count = _composite(aoi,"2025-06-01","2025-07-01")
            export = indices.build_index_stack(aoi,period,["NDVI"]).addBands(period.select(QUALITY_BANDS)).toFloat()
            assert count == 3 and json.loads(export.serialize())
    finally:
        api.tearDown()


def test_constant_multiband_pca_does_not_create_false_groups(tmp_path):
    path = tmp_path / "flat.tif"
    data = np.ones((5,10,10), dtype="float32") * .2
    data[3] = 1
    data[4] = 3
    with rasterio.open(path,"w",driver="GTiff",height=10,width=10,count=5,dtype="float32",
        crs="EPSG:4326",transform=from_origin(-71.5,-16.4,.0002,.0002)) as dst: dst.write(data)
    result = _analyze(str(path), ["NDVI","EVI","NDMI"],"kmeans",4,True,"agro")
    assert result["statistics"]["n_clusters"] == 1
    assert result["statistics"]["silhouette"] is None
    assert result["statistics"]["pca"] is None


def test_pca_importance_uses_original_dimensions(tmp_path):
    path = tmp_path / "pca.tif"
    x = np.linspace(.1,.8,100).reshape(10,10)
    data = np.stack([x,x*2,x*3,np.ones((10,10)),np.ones((10,10))*3]).astype("float32")
    with rasterio.open(path,"w",driver="GTiff",height=10,width=10,count=5,dtype="float32",
        crs="EPSG:4326",transform=from_origin(-71.5,-16.4,.0002,.0002)) as dst: dst.write(data)
    result = _analyze(str(path),["NDVI","EVI","NDMI"],"kmeans",3,True,"agro")
    stats = result["statistics"]
    assert stats["pca"]["n_components"] == 1
    assert {v["feature"] for v in stats["feature_importance"]} == {"NDVI","EVI","NDMI"}
    assert all("evi_mean" in c for c in stats["clusters"])


def test_uncalibrated_report_is_factual_without_provider():
    from analysis.llm_report import generate_report
    text = generate_report({"science_version":"v2","quality":{"valid_fraction":.42},
        "clusters":[{"cluster_id":0,"suitability_mean":12.3,"area_ha":2.1}],
        "calibrated":False, "weights":{"NDVI":1}, "total_area_ha":2.1})
    assert "42.0%" in text and "12.3" in text and "2.1" in text
    assert "Sin calibración de campo" in text


def test_monthly_export_clips_dates_and_reuses_reference(tmp_path):
    from analysis import heatmap
    from types import SimpleNamespace
    dates = []
    stack = SimpleNamespace()
    stack.addBands = lambda *a: stack
    stack.select = lambda *a: stack
    stack.toFloat = lambda: stack
    def composite(aoi, start, end):
        dates.append((start,end))
        return stack, 3
    raw = {"NDVI":np.linspace(.1,.8,100)}
    ref = scoring.fit_reference(raw)
    with patch.object(heatmap,"init_gee"), patch.object(heatmap.ee,"Geometry",lambda a:a), \
         patch.object(heatmap,"_composite",side_effect=composite), \
         patch.object(heatmap,"build_index_stack",return_value=stack), \
         patch.object(heatmap,"_download",side_effect=lambda *a:raster_case(tmp_path)):
        result = heatmap.generate_heatmaps({},"2025-01-20","2025-02-05","test",str(tmp_path),"agro",["NDVI"],ref)
    assert dates == [("2025-01-20","2025-02-01"),("2025-02-01","2025-02-05")]
    assert result["indices"] == ["suitability","ndvi"]
    assert result["scoring_reference"] == ref
    assert all(s["valid_pixels"] == 90 for s in result["suitability_series"])
    assert (tmp_path/"heatmaps/test/suitability/2025-01.png").exists()
