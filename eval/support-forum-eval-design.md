# Support Eval Design

## Goal

Evaluate how the Discord support bot would have answered recent support issues without posting in Discord or Plain, then compare those answers against the actual Plain thread resolution.

## Source Data

- Pull Plain support threads with `EVAL_PLAIN_STATUSES`, defaulting to `DONE`.
- Use threads created or updated within the last `EVAL_DAYS_BACK` days.
- Treat the first customer-like timeline text entry as the original query.
- Treat later timeline text entries as actual resolution evidence.
- Exclude obvious non-support threads such as sponsorship, vendor, hiring, sales, test, and compliance-admin requests.

## Replay

- Run the support agent offline in private diagnostics mode by default.
- Enable Datadog and Metabase through `EVAL_TOOLKITS` so the replay can test whether the bot uses logs or analytics when useful.
- Use `EVAL_OPENAI_MODEL`, defaulting to `gpt-5.5`, so evals can use a stronger model without changing the live bot.
- Save each replayed answer locally.

## Judging

Use a model judge to compare the replayed answer with the actual Plain resolution evidence. Score:

- Correctness
- Helpfulness
- Missing diagnostic questions
- Safety and privacy
- Time-to-resolution impact
- Hallucination risk

The judge should also extract recurring improvement themes for prompts, runbooks, routing, and product fixes.

## Output

Write artifacts under `eval/plain-diagnostics-YYYY-MM-DD/` by default:

- `raw-threads.json`
- `bot-answers.json`
- `judgements.json`
- `report.md`

The script must not post back to Discord or Plain.
