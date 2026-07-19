# PR Guardian: Architecture & Data Flow

This document outlines the end-to-end lifecycle of how PR Guardian processes your code — from connecting a repository, to indexing it, to producing a full AI-assisted PR review.

---

## 1. Repository Connection & Branch Selection

When you connect a repository (via **Browse Repositories** in the UI):

1. **API Call:** The backend records the Bitbucket workspace/repo and its git URL in SQLite (`data/repos.db`).
2. **Branch discovery:** It calls the Bitbucket API for the *full* branch list (paginated to completion — repos with 500+ ticket branches are common, so a low page cap could silently cut off the real main branch), then filters it down to **long-lived environment branches only** — see `_is_main_branch()` in `api/service.py`. It matches by keyword, not a fixed exact-name list, so naming variations across teams are all caught without hand-listing every convention:
   - `master`, `main`, `qa`, `uat`, `release` match as a whole token only (too common as substrings of unrelated words — e.g. "maintenance", "domain" — to match as a prefix).
   - `dev`, `stag`, `prod` match as a token *prefix*, so `develop`, `development`, `stage`, `staging`, `production`, `pre-prod`, `prod_copy`, `production_vienna`, `release-production` all count.
   - Anything containing a `/` is rejected (covers `DF-754/phase-2-development`, `feature/x`, `hotfix/x`).
   - Anything shaped like a bare ticket ID (`DF-754-...`) is rejected.
3. **Why:** Feature/ticket branches are always cut from one of the branches above, so they contain no code that isn't already covered by indexing the parent branch. Indexing every branch a team creates would duplicate the same codebase dozens of times over and burn disk + embedding cost for zero benefit.
4. Each matching branch gets its own **sparse shallow clone** (`git clone --depth 1 --filter=blob:none --sparse`) into `data/clones/<workspace>_<repo>__<branch>/`, so `develop` and `stage` never share files on disk.
5. Binaries, `node_modules`, `dist`, lockfiles, etc. are excluded from the sparse checkout — only source files are pulled down.
6. **Pruning:** every re-index run deletes any previously cloned/indexed branch's clone + ChromaDB directory that no longer matches the filter above — this cleans up ticket-branch clutter left behind by earlier runs (e.g. before this filter existed) instead of letting it accumulate on disk forever.

---

## 2. Indexing Phase (RAG Preparation)

For **each main branch** cloned in step 1, the system builds its "memory" of that branch's codebase independently.

### A. Semantic Embeddings (ChromaDB)
1. **Chunking:** Every source file is split into logical chunks (functions, classes, or fallback blocks).
2. **Vectorization:** Each chunk is sent to the configured **Embedding Provider** (OpenAI, OpenRouter, Ollama, or a custom OpenAI-compatible endpoint).
3. **Storage:** Vectors are stored in a **branch-scoped ChromaDB collection** (`data/chroma/<workspace>_<repo>__<branch>/`) — so a semantic search against `stage` never returns matches from `develop`.

### B. Graph Indexing (AST)
1. **AST Parsing:** Each branch's clone is parsed into an Abstract Syntax Tree.
2. **Relationship Mapping:** Function calls, imports, and module dependencies are mapped.
3. **Graph DB:** Stored as a per-branch knowledge graph, providing structural context (the "blast radius" of a change) used later during review.

Progress for both steps is tracked per-branch in SQLite (`indexed_branches`, `current_branch`, `total_branches`) so the UI can show live progress across all branches being indexed.

---

## 3. Webhook Trigger (The PR Event)

1. A developer creates a Pull Request in Bitbucket (typically from a ticket branch like `DF-754/phase-2-development`) targeting one of the indexed main branches (e.g. `develop`).
2. Bitbucket fires a `pullrequest:created` webhook to `POST /webhook/bitbucket`.
3. The server matches the payload's workspace/repo against connected repos. If matched, it resolves the PR's **target branch** — this is the branch whose ChromaDB collection and AST graph will be used as ground truth for comparison (a PR into `develop` is checked against `develop`'s index; a PR into `stage` is checked against `stage`'s).
4. A background thread runs the full hybrid review (Section 4) and posts the results as comments back on the PR.

The same pipeline also runs on-demand from the UI ("Re-analyze" button) via `POST /analyze-hybrid`, without needing a webhook.

---

## 4. The Review Phase — How PR Review Actually Works

This is the core of PR Guardian. A single PR is scored by **six independent subsystems**, each contributing findings and a risk adjustment. Their combined output is what the UI shows as the four cards: **ML Risk**, **Security**, **Static Analysis**, and **AI Suggestions**.

```
                         ┌─────────────────────────┐
                         │   PR opened / re-analyze  │
                         └────────────┬─────────────┘
                                      ▼
                     Fetch PR diff, metadata, changed files,
                     and file contents from Bitbucket API
                                      │
        ┌───────────┬────────────┬───┴────────┬─────────────┬──────────────┐
        ▼           ▼            ▼             ▼             ▼              ▼
   1. ML Risk   2. Rule      3. Security   4. Static     5. Graph       6. LLM Review
     Model       Engine        Scan         Analysis      Impact +       (RAG over
   (trained    (heuristics   (dependency   (pyflakes/     Duplicate      ChromaDB +
    classifier)  on diff)    CVEs via OSV)  eslint etc.)   Detection      Graph context)
        │           │            │             │             │              │
        └───────────┴────────────┴──────┬──────┴─────────────┴──────────────┘
                                         ▼
                     HybridReportBuilder._assemble()
                 merges findings, boosts risk_score, recomputes
                    risk_level, builds recommendations
                                         │
                                         ▼
                        HybridReport → saved to SQLite,
                        returned to UI / posted as PR comments
```

### 1. ML Risk Model
- A classifier (`models/pr_risk_model.pkl`, trained by `models/trainer.py` on historical PR outcomes) predicts the probability that a PR `needs_major_changes`, using features like files changed, lines added/deleted, commit count, comment count, and approval count (`features/engineering.py`).
- This produces the baseline `risk_score` (0–1) and initial `risk_level` (`LOW`/`MEDIUM`/`HIGH`) against `settings.risk_high_threshold` / `risk_medium_threshold`.
- **Hotspot detection:** files that were historically reworked/reverted a lot (`rules/hotspot.py`, learned from the training dataset) are flagged if touched again.
- This is the source of the **"ML Risk"** card and its flags (e.g. "ML model predicts high risk", "3 files are historical hotspots").

### 2. Rule Engine (`rules/engine.py`)
Cheap, deterministic heuristics that run instantly, no model needed:
- Backend files changed with no corresponding test file touched.
- Changes in sensitive directories (`auth/`, `payment/`, `config/`, `database/`, `middleware/`, `security/`, `migrations/`).
- Dependency manifests changed (`package.json`, `requirements.txt`, `go.mod`, etc.).
- Large diffs (>15 files or >500 lines).
Each hit adds a weighted boost to `risk_score` (high severity +0.15, medium +0.05).

### 3. Security Scan (`security/dependency_scanner.py`)
- Detects changed dependency manifests (`package.json`, `requirements.txt`, `Gemfile`, `go.mod`, `Cargo.toml`, `pom.xml`, etc.).
- Queries the **OSV.dev** vulnerability database for each package/version pair.
- Findings become the **"Security"** card (vulnerability count + severity). Critical/high findings boost `risk_score` by +0.10 each; lower severity by +0.03 each.

### 4. Static Analysis (`static_analysis/analyzer.py`)
- Runs language-appropriate linters against changed files' actual content (fetched from the PR's source commit): Python and JS/TS today, extensible via the `ANALYZERS` map.
- Reports errors/warnings with file, line, column, rule ID. Errors boost `risk_score` by +0.02 each.
- This is the **"Static Analysis"** card.

### 5. Graph Impact & Duplicate Detection
- **Graph Reviewer** (`analysis/graph_reviewer.py`): queries the target branch's AST graph (built in Section 2B) to find what else is affected by the changed files — call-graph impact, execution flows, and which architectural "communities" (modules) are touched. Critical execution-flow hits boost `risk_score` directly.
- **Duplicate Detector** (`analysis/duplicate_detector.py`): chunks the new/changed code the same way indexing does, then queries the **target branch's ChromaDB collection** for near-duplicate existing code (cosine similarity ≥ 0.92). Flags reinvented logic that already exists elsewhere in the codebase.
- Both feed into `review_focus` and `recommendations`, and the graph can add its own `risk_score_boost`.

### 6. LLM Code Review (RAG) — the **"AI Suggestions"** card
The LLM never sees only the raw diff — it's given retrieved context so it can reason about the surrounding codebase:
1. The full PR diff is fetched and chunked if it exceeds ~80k characters (reviewed chunk-by-chunk, then merged).
2. The Graph Reviewer's impact summary (`to_llm_context()`) — affected functions, flows, and modules — is injected into the prompt as extra context.
3. The assembled prompt (PR title, description, diff, graph context) is sent to the configured **LLM Provider** (OpenAI, OpenRouter, Ollama, or custom endpoint — see `llm/openai_reviewer.py`).
4. The model is instructed to return **strict JSON only**: `issues`, `security_concerns`, `performance_concerns`, `code_smells`, `suggested_improvements`, `summary`.
5. High-severity LLM issues (+0.05 each) and LLM-flagged security concerns (+0.08 each) further boost `risk_score`.

### Final assembly
`HybridReportBuilder._assemble()` combines all six subsystems' outputs into one `HybridReport`:
- Sums every boost onto the ML model's base `risk_score`, clamps to `[0, 1]`, and recomputes the final `risk_level`.
- Builds a flat `recommendations` list (e.g. "Fix 2 vulnerable dependencies before merging", "Resolve 3 static analysis errors", "Review 1 potential code reuse opportunity").
- Builds a `review_focus` list summarizing what a human reviewer should look at first.

---

## 5. Result Delivery

1. The assembled `HybridReport` is serialized to JSON and cached in SQLite (`pr_reviews` table, keyed by repo + PR id) — so re-opening a PR shows the last computed result instantly instead of re-running the whole pipeline.
2. If triggered by a webhook, `post_review_comments()` posts the findings directly as comments on the Bitbucket PR.
3. The React frontend fetches the cached/live result and renders it as the PR Details page: an overall risk badge, and the four expandable cards — **ML Risk** (flags from the model + rule engine + hotspots), **Security** (dependency vulnerabilities), **Static Analysis** (linter issues), and **AI Suggestions** (LLM issues/security/performance/code smells/improvements + summary).
4. A "Re-analyze" action re-runs the full pipeline on demand and overwrites the cached result.

---

## Summary of External APIs Used

| Task | Provider Configured | Model/Endpoint | Notes |
| :--- | :--- | :--- | :--- |
| **Embeddings** (Indexing) | OpenAI / OpenRouter / Ollama / custom | e.g. `text-embedding-3-small` | Configurable per `EMBEDDING_*` settings |
| **Generative AI** (LLM Review) | OpenAI / OpenRouter / Ollama / custom | e.g. `qwen/qwen-2.5-coder-32b-instruct` | Configurable per `LLM_*` settings |
| **Dependency vulnerabilities** | OSV.dev | `api.osv.dev/v1/query` | Free, no API key required |
| **Source control** | Bitbucket Cloud API | — | PR metadata, diffs, file contents, webhooks |

---

## Branch & Data Isolation Model

Everything in the pipeline is scoped **per branch**, not just per repo:

| Concern | Isolation key |
| :--- | :--- |
| Clone directory | `data/clones/<workspace>_<repo>__<branch>/` |
| ChromaDB collection | `<workspace>_<repo>__<branch>` |
| AST graph | Built fresh per branch's clone |
| Duplicate detection / graph impact | Queried against the **PR's target branch**, never a hardcoded default |

This is what lets a PR from `feature-x` → `develop` be compared against `develop`'s code, while a PR from `feature-y` → `stage` is compared against `stage`'s code, with no cross-contamination — while keeping disk/embedding cost bounded to the small set of real environment branches instead of every ticket branch ever created.
