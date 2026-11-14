# AfterQuery · Renaissance Runbook

Renaissance Runbook is a proposed Junction 2026 agent evaluation and training platform. It runs agents through changing Renaissance operations, verifies outcomes from a simulation ledger, and uses verified corrections to train and evaluate a small Gemma policy.

[Read the engineering blueprint](docs/BLUEPRINT.md)

The blueprint specifies the Python architecture, three world designs, Harbor/OpenCode evaluation, the training and retrieval pipeline, terminal UI, and the build and judging plan. The application and commands described in the specification are pending implementation.

## Break-the-agent harness (Harbor fixture)

A runnable slice of the blueprint: the Appendix G Harbor Master fixture, an independent verifier, and Nemotron and Gemini adapters. It uses only the Python standard library.

```bash
export PYTHONPATH=src
python -m unittest discover -s tests     # engine, verifier, agent loop (offline)
python -m runbook controls               # scripted control traces; the demonstration scores 5953/7000
python -m runbook models                 # list reachable Nemotron/Gemini model ids (needs keys)
python -m runbook play nemotron gemini --trials 3
```

Keys: `NVIDIA_API_KEY` and `GEMINI_API_KEY`. Override model ids with `NEMOTRON_MODEL` and `GEMINI_MODEL`, or `--model` for a single target. Run `models` first to confirm the exact ids. Each run writes a trace (transcript and ledger) under `artifacts/runs/`. A provider failure is reported as an infrastructure error, never as a score of zero.
