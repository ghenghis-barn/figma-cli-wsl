# Adversarial Review Run Audit

Date: 2026-07-01
Source: Figma Desktop via `figma-cli`
File: `UX Strategy`
Page: `WSL/Windows`
Nodes:
- `916:1008` - `CTO Review - Mac Hardware Request`
- `919:1065` - `CTO Review - Supporting Challenges`

## Purpose

Preserve the SAMRE smoke outputs used to validate the configurable two-side adversarial review implementation. These files are intended for traceability and future backtesting against model-backed runs.

## Artifacts

- `custom-roles.json` - SAMRE review using custom roles `Design Org` and `Platform Org`.
- `custom-roles.md` - Markdown summary of the custom-role SAMRE review.
- `requester-cto-smoke.json` - SAMRE smoke review using the default `Requester` and `CTO` framing.
- `requester-cto-smoke.md` - Markdown summary of the default framing smoke review.
- `screenshots/` - PNG exports of the two reviewed Figma frames captured during evidence collection.

## Replay Commands

Custom role dry-run evidence check:

```bash
node src/index.js adversarial review \
  --nodes "916:1008,919:1065" \
  --dry-run \
  --no-screenshots \
  --answer1-id design \
  --answer1-label "Design Org" \
  --answer1-position "Invest in the workflow path that unlocks design productivity." \
  --answer2-id platform \
  --answer2-label "Platform Org" \
  --answer2-position "Standardise around the lowest operational burden until evidence clears the bar." \
  --json
```

Custom role SAMRE smoke run:

```bash
node src/index.js adversarial review \
  --nodes "916:1008,919:1065" \
  --rounds 2 \
  --no-screenshots \
  --answer1-id design \
  --answer1-label "Design Org" \
  --answer1-position "Invest in the workflow path that unlocks design productivity." \
  --answer2-id platform \
  --answer2-label "Platform Org" \
  --answer2-position "Standardise around the lowest operational burden until evidence clears the bar." \
  --jurors-json '[{"id":"product","name":"Product Lead","lens":"AI-native product velocity"},{"id":"security","name":"Security Lead","lens":"platform controls and residual risk"}]' \
  --out /tmp/figma-adversarial-review-custom-roles.json \
  --md /tmp/figma-adversarial-review-custom-roles.md
```

Default Requester/CTO SAMRE smoke run:

```bash
node src/index.js adversarial review \
  --protocol samre \
  --nodes "916:1008,919:1065" \
  --rounds 3 \
  --no-screenshots \
  --out /tmp/figma-adversarial-review-smoke-final.json \
  --md /tmp/figma-adversarial-review-smoke-final.md
```

## Notes

- These smoke runs used deterministic fallback agents because no `--model-command` or `adversarialReviewCommand` config was provided.
- The screenshot PNGs were exported from the same Figma node IDs and are included as visual evidence for future review comparison.
- A model-backed backtest should preserve the same node IDs, role configuration, criteria and juror panel, then write results into a new dated audit folder.
