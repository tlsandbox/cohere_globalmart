# Check Your Match Scoring

## Purpose

`Check Your Match` explains why a recommended product is or is not aligned with the active user intent from search text or image analysis.

## Signal Model

The heuristic engine evaluates these signals:

- Gender (weight 0.22)
- Article Type (weight 0.28)
- Color (weight 0.15)
- Occasion / Usage (weight 0.10)
- Style Keyword motif (weight 0.25)

Only specified signals are active. Unspecified signals are excluded from scoring.

## Scoring

1. Each active signal is scored:
   - `1.0` for match
   - `0.6` or `0.5` for partial (signal-dependent)
   - `0.0` for miss
2. Weighted score is computed across active signals.
3. Confidence is derived from weighted score and capped:
   - `confidence = clamp(0.2 + 0.7 * weighted_score, 0.2, 0.9)`
4. Verdict thresholds:
   - `Strong match` if score >= 0.78
   - `Good match` if score >= 0.62
   - `Possible match` if score >= 0.45
   - `Weak match` otherwise

## Detailed Explanation Payload

`/api/check-match` returns `judgement_details.details[]` entries with:

- `attribute`
- `status` (`Match`, `Partial`, `Missing`, `Not specified`)
- `expected`
- `actual`
- `score`
- `weight`
- `reason` (plain-language judgement)
- `matched_values` (which intent cues matched)
- `missing_values` (which cues are not satisfied)
- `note` (why this signal matters)

## Example

For query: `my wife wants a sakura shirt`

Possible output:

- Gender: `Match` (expected Women, product Women)
- Article Type: `Partial` (requested Shirts, product Tshirts)
- Style Keyword: `Missing` (motif keyword `sakura` not found)

This becomes a clear explanation such as:

- `Article Type partial because Shirts is related to Tshirts`
- `Style Keyword missing because sakura was not found in product metadata`

## UI Presentation

The frontend renders this detail in two places:

- Inline card section under the checked product
- Modal popup for expanded readability on smaller cards

Both views show:

- Signal score percentage
- Matched cues
- Missing cues
- Judgement sentence
