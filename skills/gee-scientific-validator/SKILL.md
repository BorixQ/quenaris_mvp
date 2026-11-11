---
name: gee-scientific-validator
description: Audit Earth Engine spectral indices, masks, spatial scales, relative scoring and uncertainty in Quenaris. Use for scientific corrections and reproducible validation, not deployment or UI redesign.
---

# Scientific validation of Quenaris

Read the current engine and its callers before treating an earlier handoff as accurate.
Trace indices → composite/masks → downloaded raster → score/clustering → heatmap → report.

- Verify sensor band mappings, scaling and additive offsets against the exact collection's official catalog. Scaling cancels only in homogeneous ratios; additive constants require reflectance units. Do not apply Landsat offsets to Sentinel-2.
- Check pixel cloud/shadow/snow/nodata masks, usable land coverage and observation counts. Scene-level cloud percentage is not AOI coverage. Classifier masks have errors and are not field truth.
- Declare native resolution, output grid, resampling, CRS, area method and time interval (end exclusive). Never claim that upsampling creates spatial detail. `bestEffort` changes scale; use only with an explicit reproducibility tradeoff.
- Inspect finite values, denominator masks, zero variance, collinearity, cluster noise, small samples and homogeneous scenes. A silhouette score measures geometric separation, not agronomic correctness.
- Separate spectral observations, relative heuristic ranks and calibrated predictions. AOI-fitted percentiles cannot establish universal suitability or be re-fitted independently for temporal comparisons.
- Use the same study, indices, weights, directions and fixed normalization reference for analysis and monthly maps. Record actual effective weights and model version.
- Do not invent causes, species, salinity, nutrient levels, irrigation or treatment prescriptions from uncalibrated indices. Return no differential diagnoses when evidence is absent; softmax is not calibration.
- Build a source matrix: implemented formula, primary reference/catalog, exact sensor adaptation, evidence limitations and action. Mark inaccessible or unverified formulas explicitly. Distinguish source confirmation from local validation.
- Prefer deterministic local regression tests plus small recorded live EE cases. Record collection IDs, dates, AOIs, scale, image counts, quality, request budget and failures. Never store credentials in reports or Git.

Priorities: general vegetation condition and restoration in Arequipa agricultural and high-Andean contexts. Bare soil is not automatically available for planting; native grasslands, land tenure, species suitability and ecology require field review. Preserve public API fields where possible, add provenance and uncertainty, and disclose semantic changes to legacy scores. Without independent field data all outputs remain exploratory.
