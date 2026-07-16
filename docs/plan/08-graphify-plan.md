# 08 — Graphify Plan

## Purpose

Generate a real, code-derived architecture graph for ONEComputer and its adjacent repos, so the "one-page architecture diagram" needed for [`07-investor-readiness-plan.md`](./07-investor-readiness-plan.md) is grounded in actual code, not hand-drawn boxes that drift from reality.

## Tool

Graphify, cloned at `/Users/ttwj/Project OneComputer/graphify`. **Must be run from inside that directory** — running `python3 -m graphify` from elsewhere causes it to fail to locate the package correctly.

```bash
cd /Users/ttwj/Project\ OneComputer/graphify
.venv/bin/python3 -m graphify update "<target-repo-path>" --no-cluster
```

**Use the repo's own `.venv/bin/python3`, not system `python3`.** The system Python (3.9, `/usr/bin/python3`) lacks `networkx` and fails with `No module named 'networkx'`. The graphify repo's `.venv` (Python 3.13) has all deps installed.

`--no-cluster` skips LLM-based community naming/clustering — use this first pass for speed, then optionally re-run `cluster-only` later for a labeled graph if the raw extraction is useful enough to invest in.

## Status: done (verified 2026-07-04)

All four repos extracted and merged. See `/Users/ttwj/Project OneComputer/graph-output/README.md` for full numbers. Summary:

| Repo                    |      Nodes |       Edges |
| ----------------------- | ---------: | ----------: |
| ONEComputer main        |      5,243 |      12,290 |
| Daytona OSS             |     75,673 |     196,095 |
| TGW reference           |        488 |         764 |
| Affinidi TDK (Rust)     |     10,857 |      26,454 |
| **Merged system graph** | **97,977** | **231,426** |

`graphify diagnose multigraph` on the merged graph: 0 missing-endpoint edges, 0 dangling edges, 0 same-endpoint collapsed edges — the merge is structurally sound. 268 self-loops (expected, recursive/self-referential calls).

Affinidi TDK, expected to be the slowest, completed in ~70 seconds — did not need to be timeboxed or skipped as originally planned.

## Sequencing (slowest repo last, per known runtime constraint)

Run in this order — `affinidi-tdk-rs` is known to be slow, so it goes last:

1. **ONEComputer main repo** (highest priority — this is the product)
   ```bash
   cd /Users/ttwj/Project\ OneComputer/graphify
   python3 -m graphify update "/Users/ttwj/Project OneComputer/implementation/onecomputer" --no-cluster
   ```
2. **Daytona OSS**
   ```bash
   python3 -m graphify update "/Users/ttwj/Project OneComputer/daytona-oss" --no-cluster
   ```
3. **TGW reference**
   ```bash
   python3 -m graphify update "/Users/ttwj/Project OneComputer/tgw-reference" --no-cluster
   ```
4. **Affinidi TDK (Rust)** — run last; if it times out or is too slow, skip and document the gap rather than blocking the other three.
   ```bash
   python3 -m graphify update "/Users/ttwj/Project OneComputer/affinidi-tdk-rs" --no-cluster
   ```

Each `update` writes into that target repo's own `graphify-out/` by default — confirm output location after each run before assuming where `graph.json` landed.

## Merge step

Once at least the ONEComputer + Daytona graphs exist, merge them into a cross-repo graph:

```bash
python3 -m graphify merge-graphs \
  "/Users/ttwj/Project OneComputer/implementation/onecomputer/graphify-out/graph.json" \
  "/Users/ttwj/Project OneComputer/daytona-oss/graphify-out/graph.json" \
  --out "/Users/ttwj/Project OneComputer/graph-output/onecomputer-system-graph.json"
```

Add `tgw-reference` and `affinidi-tdk-rs` graphs to the merge as they become available — `merge-graphs` accepts more than two inputs.

## Expected outputs

```
graph-output/
├── README.md                          — how this graph was generated, from what repos, when
└── onecomputer-system-graph.json       — merged cross-repo graph
```

Plus, per-repo, inside each repo's own `graphify-out/`:

```
graphify-out/
├── graph.json
├── graph.html      — open directly in a browser for the investor one-pager
└── GRAPH_REPORT.md — key concepts + suggested questions
```

For the investor architecture page specifically, also run:

```bash
graphify export callflow-html
```

inside the ONEComputer repo after its graph exists — this produces a readable Mermaid call-flow diagram, which is a better fit for a one-page architecture doc than the raw interactive `graph.html`.

## Verification

After each `update` run, confirm — don't assume:

```bash
ls -la "<target-repo>/graphify-out/graph.json"
python3 -m graphify diagnose multigraph --graph "<target-repo>/graphify-out/graph.json"
```

The `diagnose multigraph` command reports same-endpoint edge collapse risk — run it before trusting the graph's edge count.

## Not yet done

- No `graph.html` visualization exists for any repo yet (`--no-cluster` skips it) — run `cluster-only` when a labeled/visual graph is needed, e.g. for the investor one-pager.
- `graphify export callflow-html` (Mermaid call-flow diagram) has not been run yet — do this before using the graph in investor materials ([`07-investor-readiness-plan.md`](./07-investor-readiness-plan.md)).
