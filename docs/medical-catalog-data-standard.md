# Taiba Smart Lab — Medical Catalog Data Standard

## Purpose

This is the data contract for the shared medical master catalog and each laboratory's editable tenant copy. Names supplied by a laboratory are source aliases only; they do not establish the test method, panel composition, reference interval, or clinical interpretation.

## Catalog layers

1. **Master release** — versioned, globally read-only definitions curated and published centrally.
2. **Master test** — canonical identity, aliases, classification, service type, and default laboratory workflow.
3. **Master parameters** — result fields, units, reference intervals, critical limits, interpretation rules, applicability, and formula dependencies.
4. **Tenant copy** — independently editable test and parameter rows owned by one tenant.
5. **Master link** — records the source release and baseline snapshot for future opt-in update comparisons. Master updates must never silently overwrite tenant edits.

A tenant import does not create a price. The tenant owner must set base/branch prices before the test can be ordered.

## Test identity and classification

Every test needs a stable master code, canonical display name, alternate names, category, test kind (individual or panel), service type (laboratory_test, panel, procedure, or service), specimen, method, turnaround time, and optional LOINC mapping. A panel has its own test code and price; each component has a separate parameter code. Do not collapse panel component codes into the parent test code.

Service and procedure items must not be represented as result-bearing laboratory tests unless they genuinely produce a reportable result.

## Patient and specimen workflow

Capture patient preparation (fasting, timing, medication considerations), collection requirements (container/tube, anticoagulant, volume, collection time), specimen requirements (type, acceptable alternatives, minimum volume), transport conditions, stability windows by temperature and container, rejection criteria, and biosafety notes.

Each requirement should be structured and may include separate rules for routine, urgent, pediatric, and special collection workflows. Do not infer fasting or collection conditions from a test name alone.

## Parameter and result model

A parameter includes a stable code, display name, data type (numeric, text, boolean, choice), unit, UCUM unit where available, decimal precision, allowed choices, required/optional status, display order, and manual/calculated source. Numeric and text results must remain distinct. Qualitative results should use controlled choices where appropriate.

### Reference intervals

reference_ranges is a list of independently applicable intervals. Suggested object shape:

~~~json
[
  {
    "population": "adult",
    "sex": "female",
    "age": {"min": 18, "max": 120, "unit": "years"},
    "pregnancy": {"trimester": 1},
    "lower": null,
    "upper": null,
    "unit": "unit as reported",
    "lower_inclusive": true,
    "upper_inclusive": true,
    "method": "method/analyzer-specific context",
    "source_refs": ["reference-id"]
  }
]
~~~

Null values above are placeholders, not clinical ranges. Real intervals must be populated from the performing laboratory's validated method, analyzer/reagent insert, verified local population interval, or a traceable authoritative source. Keep age bands, sex, pregnancy trimester, neonatal age in days/weeks, and other applicable populations as separate entries. Do not substitute one generic adult range for pediatric or pregnancy ranges.

### Critical limits and interpretation

critical_ranges is separate from reference intervals and must specify the clinical population, unit, threshold direction, urgency, notification workflow, and source. interpretation_rules may encode qualitative meaning, reflex recommendations, delta checks, and comments, but must not autonomously diagnose a patient.

### Calculated parameters

Calculated parameters must be numeric, have a validated formula, explicit input dependencies, unit/precision, and documented rounding. Formula dependencies must be same-test, acyclic, and versioned in the visit technical snapshot. Missing inputs and divide-by-zero must remain visible as incomplete/unavailable rather than generating fabricated values. Record the equation and its source.

## Clinical governance

Every test and parameter has a review state: draft, needs_review, verified, or deprecated. Only verified definitions should be presented as approved master defaults. Review records should capture reviewer, date, source/version, method/analyzer applicability, and change rationale. A tenant's local review state is a local workflow assertion, not a substitute for external accreditation.

## Quality and reporting requirements

Maintain method, analyzer/reagent applicability, calibration/QC notes, interferences, limitations, report comments, critical result policy, specimen rejection rules, parameter-level clinical metadata, and source references. Preserve test/parameter snapshots on each visit so later catalog edits cannot rewrite historical reports.

## Import and update safety

- Master imports are opt-in and owner-authorized.
- A tenant copy is editable without changing the shared master.
- Master releases are immutable after publication; corrections create a new release.
- Update previews compare the new release with the saved baseline and current tenant copy.
- Automatically apply only fields still equal to the old baseline; keep changed tenant fields untouched and mark them as customized.
- Require explicit owner confirmation for each update batch.
- Never auto-create visits, invoices, payments, prices, or financial ledger entries during catalog import.
- Never activate an unreviewed or incomplete definition merely because it exists in the master library.
