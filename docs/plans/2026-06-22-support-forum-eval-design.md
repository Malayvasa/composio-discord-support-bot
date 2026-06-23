# Support Forum Eval Design

## Goal

Evaluate how the Discord support bot would have answered recent support forum posts without posting in Discord, then compare those answers against the actual forum replies and resolutions.

## Source Data

- Pull Discord forum posts from `SUPPORT_CHANNEL_IDS`.
- Group by Discord thread ID.
- Use threads whose first message is within the last `EVAL_DAYS_BACK` days.
- Treat the first non-bot message as the customer query.
- Treat later human and bot replies as actual resolution evidence.

## Replay

- Run the support agent offline in public mode.
- Do not use private diagnostics tools during the replay.
- Use `EVAL_OPENAI_MODEL`, defaulting to `gpt-5.5`, so evals can use a stronger model without changing the live bot.
- Save each replayed answer locally.

## Judging

Use a model judge to compare the replayed answer with the actual forum resolution evidence. Score:

- Correctness
- Helpfulness
- Missing diagnostic questions
- Safety and privacy
- Time-to-resolution impact
- Hallucination risk

The judge should also extract recurring improvement themes for prompts, runbooks, routing, and product fixes.

## Output

Write artifacts under `eval/support-forum-YYYY-MM-DD/`:

- `raw-threads.json`
- `bot-answers.json`
- `judgements.json`
- `report.md`

The script must not post back to Discord.
