# 3/1/0 Trading Decision Rules

- `3`: home team wins in 90 minutes including stoppage time.
- `1`: draw after 90 minutes including stoppage time.
- `0`: home team loses after 90 minutes including stoppage time.
- Never substitute knockout advancement probability for a 90-minute probability.

The bundled generator supports conservative, balanced, and aggressive list organization, budget trimming, stake count estimation, and an optional 9-match subset. Treat the output as a 3/1/0 decision board:

- **Banker**: single-selection match with low risk and high confidence score.
- **Cover**: double/triple-selection match used to reduce one-match variance.
- **Cut**: match removed because probability separation is weak or budget efficiency is poor.
- **No-play**: match where expected value, confidence, or information quality is not enough.

For final reports, convert the generated JSON into a trading plan: banker picks, cover picks, cuts, total stake count, budget usage, worst-case loss, and review triggers.
