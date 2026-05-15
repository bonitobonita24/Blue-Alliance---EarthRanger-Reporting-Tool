# EarthRanger Reporting Tool - Accomplishment Report

**Date:** 2026-05-15  
**Audience:** Future AI agents, Claude Code, Codex, and human maintainers  
**Project:** Blue Alliance - EarthRanger Reporting Tool

## Why This Moment Matters

This project moved from being a patrol list/reporting utility into a practical operations-analysis tool. The most important milestone is the new direction for municipality-aware patrol reporting:

> Rangers often start from a shoreline municipality, then travel into places such as Apo Reef Park, Taytay, or Aborlan. A report that only counts patrols by where they start misses the actual area covered by the patrol.

The user identified this as a milestone because solving it means the report can represent not only where patrols begin, but where patrol effort is actually spent.

## What Was Built In This Session

### 1. Advanced Patrol Start Time Filtering

The Manage List filters now support a clearer advanced time workflow:

- `Advanced start time window` hides its time controls unless enabled.
- `From time` and `To time` only appear when the advanced filter is checked.
- A new option allows filtering patrols that start at or after `From time`, regardless of ending time.
- The option is labeled:
  - `Ignore To time and match any patrol starting from From time`

This supports cases like filtering patrols that started from 10:00 PM onward, without caring when they ended.

### 2. Generated Patrol Report Table Layout

The generated report opened in a new tab was refined for print readability:

- Title column wraps.
- Title column was tuned to `20%`.
- Start/End columns were narrowed so time can wrap below date.
- Other columns allow wrapping.
- Headers and cells are centered.
- Start Location and End Location were widened.

The goal was to make the printable patrol list compact but readable.

### 3. Template Report Page 1 Improvements

The `Report template - Generate period summaries and GPS map` output was improved:

- Foot Patrol and Seaborne Patrol summary cards are narrower.
- The map area is wider.
- A combined total card was added below the patrol-type cards with:
  - Total patrols
  - Total KMS
  - Total HRS
- The template defaults now open to:
  - Weekly
  - Current year
  - Last completed week from today

As of 2026-05-15, the default week is May 4-10, 2026.

### 4. Municipality Patrol Page

A second page was added to the generated template report:

- Header matches the existing report-template design system.
- A municipality table shows:
  - Municipality
  - No. of Patrols
  - Total KMS
  - Total HRS
- A chart panel shows:
  - Raw metrics
  - Variance vs highest municipality (%)
- An info button beside the variance chart opens a dialog explaining the purpose of the chart.

The municipalities currently tracked are:

Mindoro:
- Calapan
- Baco
- San Teodoro
- Puerto Galera
- Sablayan
- Apo Reef Park

Palawan:
- Roxas
- Aracelli
- El Nido
- Dumaran
- Taytay
- Aborlan

### 5. Municipality Classification Discovery

An important discovery was made while debugging zero values in the municipality table:

- The ArcGIS Municipal Waters service returns boundary `LineString` paths such as `calapan path`.
- It does not return filled municipality polygons for the layer currently used.
- Therefore, a point-in-polygon check cannot classify patrols using this layer.

The current implementation classifies a patrol's starting point by finding the nearest listed municipal boundary line.

This is good enough for "where did this patrol start nearest to?", but it does not fully answer "which area did this patrol actually cover?"

## Current Municipality Logic

The report currently does this:

1. Fetch GPS tracks for selected patrols in the template period.
2. Use the first GPS coordinate as the patrol start point.
3. Load municipal boundary line features from ArcGIS.
4. Match the start point to the nearest listed municipal boundary line.
5. Add that patrol's count, KMS, and HRS to that municipality.

This populates the municipality table and charts for start-location-based reporting.

## The Next Milestone: Area Covered Metrics

The user asked whether patrols that start from one municipality but travel into Apo Reef Park, Taytay, Aborlan, etc. can count toward those patrolled areas.

The answer is yes, but the first experimental UI pass was removed at user request because it did not match the desired report structure.

The right next feature is to distinguish:

- **Started From Municipality**
  - Based on the patrol's first GPS coordinate.
  - Good for showing launch/origin municipalities.

- **Area Patrolled / Covered**
  - Based on the full GPS track.
  - Good for showing effort spent inside or near target areas, even if the patrol started somewhere else.

## Recommended Design For Area Covered Metrics

Add a second municipality/area metric mode or section:

### Started From

Keep the current table/chart:

- No. of Patrols
- Total KMS
- Total HRS

Meaning: patrols whose first GPS point is nearest this municipality boundary.

### Area Covered

Recommended as a future metric mode or carefully designed section:

- Coverage Patrols
- Coverage KMS
- Estimated HRS

Meaning: patrols whose track entered or traveled near the municipality/area boundary.

For Apo Reef Park, Taytay, Aborlan, and similar places, this is more operationally meaningful because rangers often start from a shoreline and then patrol the actual target area.

## Proposed Algorithm For Area Covered

For every selected patrol track:

1. Extract all GPS coordinates from the track.
2. Split the track into segments between consecutive GPS points.
3. For each segment:
   - Compute segment distance using Haversine or existing distance helpers.
   - Assign the segment to the nearest listed municipal boundary line, or to an area polygon if better GIS data becomes available.
4. Accumulate segment distance per municipality/area as Coverage KMS.
5. Estimate segment time proportionally:
   - segment hours = patrol total hours * (segment distance / patrol total distance)
6. Count coverage patrols once per municipality/area if any segment is assigned there.

Use distance-weighted estimated hours if the current frontend track extraction only has coordinates from the EarthRanger subject tracks response. If timestamped track points are exposed in the response or through another EarthRanger endpoint, this should be upgraded to actual segment elapsed time.

## Accuracy Notes

### KMS

Coverage KMS can be estimated well from GPS coordinates.

### HRS

Coverage HRS depends on track timestamp availability:

- If EarthRanger track points include timestamps, HRS can be calculated more accurately.
- If timestamps are not available, HRS should be presented as estimated hours based on distance share.

The UI/report should label this clearly, for example:

- `Estimated Coverage HRS`
- `Coverage HRS (distance-weighted estimate)`

## Relevant Files

Primary file changed:

- `public/index.html`

Important backend endpoints and helpers:

- `api/patrol-tracks.js`
  - Fetches GPS tracks for a patrol's tracked subject.
- `api/patrol-kilometers.js`
  - Computes GPS-derived kilometers.
- `lib/earthranger.js`
  - EarthRanger API client, including `getSubjectTracks()`.
- `lib/patrol-cache.js`
  - Local patrol cache.
- `lib/patrol-sync.js`
  - Background patrol sync engine.

## Current Report Template Concepts

The generated template report currently includes:

Page 1:
- Patrol type summaries
- Combined total card
- GPS map with tracks and municipal water boundaries

Page 2:
- Municipality Patrol table
- Raw metrics chart
- Variance vs highest municipality chart
- Info popup explaining the variance chart

## Notes For Claude Code And Future Agents

This app has no frontend framework. Most UI/report logic is in one file:

- `public/index.html`

Be careful when editing generated report HTML inside template strings. Always run:

```bash
node --check server.js
node - <<'NODE'
const fs = require('fs');
const vm = require('vm');
const html = fs.readFileSync('public/index.html', 'utf8');
const start = html.indexOf('<script>');
const end = html.lastIndexOf('</script>');
new vm.Script(html.slice(start + '<script>'.length, end));
console.log('inline script parsed');
NODE
```

After changes, rebuild Docker because `public/` is copied into the image:

```bash
docker compose up -d --build
```

## Status At Time Of This Report

Implemented:
- Start-time filter UX improvements.
- Printable patrol report table refinements.
- Template report page 1 summary/map refinements.
- Template report page 2 municipality table/charts.
- Start-location-based municipality classification using nearest boundary line.
- Variance chart explanation popup.
- Weekly/last-completed-week default template settings.
- Browser-local boundary manager:
  - Header menu opens a Boundaries workspace.
  - Current monitored municipalities/areas are seeded into a local browser database.
  - Users can add, update, hide, and delete monitored boundary/report rows.
  - Users can draw custom polygon boundaries for new areas or to override/augment existing monitored rows.
  - Selecting an official municipality previews the official ArcGIS boundary in the editor map.
  - Official water-boundary lines can be copied into the local boundary database as editable report overrides.
  - Saving a drawn boundary on an official municipality marks it as a custom override and disables the official boundary for that row in generated reports.
  - Generated template reports use the enabled municipality database rows plus any saved custom polygons.

Not yet implemented:
- Full track-based Area Covered metrics. An experimental Area Covered table/chart was intentionally removed because it did not match the desired report design.
- Actual timestamp-based Coverage HRS if EarthRanger exposes timestamps per GPS point.
- A stronger polygon/area dataset for exact in-boundary coverage.
- Backend caching for computed track coverage metrics.

This next feature is the natural continuation of the milestone.
