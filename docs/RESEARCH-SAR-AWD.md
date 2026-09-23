# Research: SAR-based AWD detection & automatic field boundaries

Collected 15 Aug 2026. Everything here is open source and directly relevant to
the two hardest items on the roadmap: remote AWD verification, and getting
parcel boundaries without walking every field.

---

## 1. Ricemapper — AWD vs continuous flooding from Sentinel-1

**https://github.com/microsoft/rice-irrigation-mapping-s1s2** — MIT licence,
Microsoft (AI for Good), published Oct 2025.
Paper: *Remote Sensing Reveals Adoption of Sustainable Rice Farming Practices
Across Punjab, India*, arXiv:2507.08605

This is our number-one roadmap item, already built and open-sourced. It
classifies rice plots along two axes from Sentinel-1 time series:

- **Irrigation:** AWD vs continuous flooding (CF)
- **Sowing:** direct-seeded rice (DSR) vs puddled transplanted rice (PTR)

Pipeline: S1 gamma0 VV/VH time series per polygon -> handcrafted + learned
features -> Random Forest / LightGBM classifier.

Feature sources it supports:
1. Handcrafted statistics over the VV/VH series
2. **Presto** embeddings (NASA Harvest pretrained remote-sensing transformer,
   MIT, https://github.com/nasaharvest/presto)
3. **Google Satellite Embeddings** (AlphaEarth Foundations V1, CC-BY 4.0,
   in the Earth Engine catalog as `GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL`)

Best date range for the AWD task in their work: **1 May to 15 Dec, sampled
every 10 days**. For sowing: 1 Jun to 5 Sep at 4 days.

### The catch, stated plainly

Training labels come from The Nature Conservancy's PRANA project in Punjab
(~1,400 plots, Kharif 2024) and are **not publicly redistributable**. The repo
ships de-identified features with coordinates stripped. The README warns that
transferring regions requires a similar cropping calendar — Cambodia's is not
Punjab's.

So we cannot simply run their model on Kampong Thom and trust the output.

### Why that is an opportunity, not a blocker

The thing their model needs and cannot get for Cambodia is **ground-truth
labels: which plot practised AWD, on which dates.** That is precisely what
Field Watch already records — dated flooded/drained events with tube readings,
per parcel, by named staff.

BRM's field ledger is training data for a Cambodia-specific model. That is a
real research contribution, it is fundable, and no amount of software alone
produces it. It only exists because someone logs events in the field.

---

## 2. Automatic field boundaries — the blocker, solved by others

### FTW — Fields of the World
**https://github.com/fieldsoftheworld/ftw-baselines**
Ricemapper uses FTW to derive rice field boundaries from **bi-temporal
Sentinel-2** imagery, then runs the S1 analysis inside those polygons. This is
the "stop drawing polygons by hand" path.

### agribound
**https://github.com/montimaj/agribound** — Apache-2.0, pip installable
(`pip install agribound`), Google Earth Engine integration, documented, DOI'd.
Describes itself as a unified agricultural field boundary delineation toolkit.
Worth evaluating first because it is packaged rather than research code.

### Han et al. 2022 — APRA500
500 m annual paddy rice maps for **monsoon Asia, 2000–2021**, CC BY 4.0.
https://doi.org/10.5281/zenodo.5557022
Too coarse for parcel work, but useful as a *mask* — to know where rice is
grown at all across Kampong Thom, and as a baseline for regional claims.

---

## 3. Flood / water detection from SAR (supporting method)

Detecting whether a paddy is flooded or drained is the core signal behind AWD
classification. Mature open-source options:

- **cordmaur/sentinel1-flood-finder** — packaged S1 flood mapping, friendly API
- **kimbielby/sentinel-flood-mapper** — U-Net on Sen1Floods11 + STURM-Flood,
  reports test F1 0.76 / IoU 0.61 for water
- **xavibou/sar_flood_detection** — *Portraying the Need for Temporal Data in
  Flood Detection via Sentinel-1* (arXiv:2403.03671). Key lesson: single-image
  water detection is ill-posed; you need the time series to separate permanent
  water from a newly flooded field. Directly applicable — an AWD cycle is by
  definition a temporal signal.
- **tamer-saleh/s1gflood-detection** — DAM-Net, ISPRS paper, benchmark dataset

---

## 4. Supporting literature

- **arXiv:2507.08605** — the Punjab paper behind Ricemapper. Read first.
- **PMC10070606** — eddy covariance measurement of AWD effect on rice methane.
  Useful for justifying why AWD records matter, in a funder's language.
- **PMID 31783470** — mild AWD and mid-season drainage effects on CH4 and N2O.
  Note it covers N2O too: draining can trade methane for nitrous oxide, which
  is a caveat worth knowing before claiming emission reductions.
- **PMID 40179556** — mitigation during the growing season is partly offset in
  the fallow season. Another honesty check on any emissions claim.
- **PMID 39918696** — Sentinel SAR + ML for paddy mapping at 10 m, Lower
  Gangetic Plain.

---

## 5. What I would actually do with this

**Phase 1 — boundaries (unblocks everything else).**
Evaluate `agribound` first, FTW second, on a Sentinel-2 pair over the estate.
Even 70% accurate polygons that a field officer corrects on a phone beats
drawing 2,200 ha by hand. Import result as GeoJSON, which the app already
stores.

**Phase 2 — flooded/drained signal.**
Not full AWD classification yet. Just: for each parcel, each S1 pass, is it
flooded or drained? Store it beside the field officer's logged water events.
Two independent records of the same fact is exactly what an MRV auditor wants,
and it makes the logbook self-checking.

**Phase 3 — Cambodia-specific AWD model.**
Once one or two seasons of paired data exist (satellite signal + our dated
ground truth), train the Ricemapper pipeline on Cambodian labels. This is the
part worth writing a grant around, and the part nobody else can do without
field records.

**Cost note:** Sentinel-1 is free like Sentinel-2, but processing is heavier
(gamma0 preprocessing via SNAP, or use Earth Engine / a hosted service).
Confirm CDSE quota before committing to an approach.

---

## 6. Honest caveats to carry into any pitch

- Ricemapper's accuracy figures are Punjab's, not ours. Do not quote them as
  our expected performance.
- AWD reduces methane but can raise N2O, and growing-season gains are partly
  offset in fallow. Anyone serious will know this; know it first.
- Automatic boundaries need human correction. Budget review time, not zero.
