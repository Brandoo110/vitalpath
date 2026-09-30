# VitalPath wellness-v2

VitalPath uses a small, auditable server-side model for this demonstration. It is not a medical device, a diagnosis, or a guarantee of weight change.

## Supported inputs

The submit gate supports adults aged 20 through 78, height 130 through 220 cm, and current and target BMI from 18.5 inclusive to below 40. The goal must agree with the target direction:

- `lose_weight`: target below current weight
- `gain_muscle`: target above current weight; the projection is weight, not muscle mass
- `keep_fit`: target equal to current weight
- `get_toned`: target equal to or below current weight

The user must explicitly set `wellnessEligible=true`, confirming that they are not pregnant or breastfeeding and do not need medical supervision for the diet plan. Technical draft validation is broader so a user can save and recover a draft; unsupported drafts receive `422 assessment_invalid` at submit and do not create or replace a result.

## Calculation

The source boundary is explicit: [Mifflin et al. (1990)](https://pubmed.ncbi.nlm.nih.gov/2305711/) supports the resting-energy equation used here; [CDC adult BMI categories](https://www.cdc.gov/bmi/adult-calculator/bmi-categories.html) support the product's BMI category labels; and the [NIDDK Body Weight Planner](https://www.niddk.nih.gov/bwp) is a reference for why body-weight change is dynamic. These sources inform the implementation boundary and do not validate this product's simplified projection.

Resting energy expenditure uses the Mifflin–St Jeor equation:

```text
REE = 10 × weightKg + 6.25 × heightCm − 5 × age + sex constant
male: +5; female: −161
```

TDEE is `REE × activity multiplier`, using the existing product multipliers (`1.2`, `1.375`, `1.55`, `1.725`). Calorie guidance uses TDEE as its base:

- weight loss and a declining `get_toned` target: gentle `min(250, 15% TDEE)`; standard/aggressive `min(500, 20% TDEE)`
- gain muscle: gentle `min(150, 10% TDEE)`; standard/aggressive `min(300, 15% TDEE)`
- maintenance or equal-weight toning: no adjustment

The output floor is 1,200 kcal for women and 1,500 kcal for men. A TDEE below that product threshold, or an output at or above 5,000 kcal, is unsupported. These are product policy gates, not universal safety claims.

## Projection

The date is explicitly labelled `simplified_energy_balance_v1`. For up to 365 days, each step recalculates REE and TDEE at the simulated weight while keeping the calculated intake and activity assumption fixed:

```text
weight += (intake − expenditure) / 7700
```

`7700 kcal/kg` is a simplified energy conversion assumption. It does not implement the [Hall dynamic body-weight model](https://pmc.ncbi.nlm.nih.gov/articles/PMC3880593/) and is not presented as clinically validated. If the target is not reached within 365 days, the result has `targetDate=null` and `projectionStatus=not_projected`; equal weight uses `maintenance`. A successful date is a scenario estimate that should be reviewed as real measurements change.

`Result.calculationDetails` stores the method, policy version, REE, TDEE, actual energy difference, projection status and assumptions for paid reports. Free responses expose only general method/range information and never expose exact calories, dates or calculation details.

The model keeps Mifflin and the conservative product support domain because they are explainable and testable. Clinical guidance such as the [AHA/ACC/TOS obesity guideline](https://pmc.ncbi.nlm.nih.gov/articles/PMC5819889/) and the [NHLBI evidence review](https://www.nhlbi.nih.gov/sites/default/files/media/docs/obesity-evidence-review.pdf) (pp. 70–71, examples of individualized calorie ranges and adjustment by weight/activity) is context for the product's safety boundary, not evidence that this demo's 1,200/1,500 kcal floors are safe for every person or that it gives medical advice. A complete Hall implementation would require additional calibration and independent validation; an unlicensed public rewrite was reviewed but not copied or treated as validation evidence.

## Focused verification

The product-domain regression in `tests/health-domain.test.ts` runs 3,240 deterministic scenarios: 2 genders × 4 activity levels × 3 paces × 5 goal categories (loss, gain, maintenance, declining toning, and equal-weight toning) × 3 ages × 3 heights × 3 current BMI values. Unsupported scenarios are executed and counted as explicit threshold or calorie-range rejections; the latest run accepted 2,707 and rejected 533, with every category containing both outcomes.

The test oracle is test-only and independent of `lib/health.ts`: it uses its own activity and policy tables, the algebraic fixed point `W* = (intake / m − C) / 10`, `q = 1 − 10m / 7700`, and `W(n) = W* + (W0 − W*)qⁿ`. It solves the first qualifying integer day with logarithms and checks the adjacent days directly; it does not call production helpers or reproduce the production daily loop. Targets for the 364/365/366-day cutoff use midpoints between adjacent analytical weights so the comparison is away from a floating-point threshold.

The same focused suite checks missing and non-finite numbers, integer/range edges, BMI boundaries, enum and eligibility failures, every goal direction, UTC date rollover across a leap day, policy direction, deterministic non-mutation, the 5,000 kcal upper gate, and finite/integer result invariants. These are representative points in the supported numeric domain, not an exhaustive proof over every real-valued input and not clinical validation.

Run the one-key algorithm check with:

```sh
npm test -- --maxWorkers=1 lib/health.test.ts tests/health-v2.test.ts tests/health-domain.test.ts
```
