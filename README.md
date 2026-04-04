# PR Guardian

**Multi-repo, multi-provider Pull Request Review Intelligence Platform**

PR Guardian analyzes pull requests using a seven-layer hybrid pipeline: classical ML risk prediction, rule-based checks, dependency vulnerability scanning (OSV), static analysis (flake8/ESLint), AST knowledge graph impact analysis (code-review-graph), semantic duplicate detection (ChromaDB), and LLM code review (OpenAI GPT-4.1). It ships with a dark GitHub-style web UI including a diff viewer, inline comments, and a source browser.

---

## How It All Works

### Big Picture

```
Git Provider (Bitbucket / GitHub / GitLab / any HTTPS git)
        │
        │  Add Repo URL
        ▼
┌─────────────────────────────────────────────────────┐
│                  PR Guardian Backend                │
│                                                     │
│  1. Repo Store (SQLite)  ← metadata, job status    │
│  2. Sparse Clone         ← git clone --depth 1     │
│  3. AST Graph (crg)      ← call graph, impacts     │
│  4. ChromaDB Index       ← semantic embeddings     │
│  5. Hybrid Analysis      ← 7-layer pipeline        │
└─────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────┐
│                  React Web UI                       │
│                                                     │
│  Sidebar → Repos → Source Browser / PR List        │
│  PR Detail → Diff Viewer → AI Review Tab           │
└─────────────────────────────────────────────────────┘
```

---

## Setup

### 1. Install Python dependencies

```bash
cd pr-guardian
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure credentials

```bash
cp .env.example .env
# Fill in your credentials
```

**`.env` variables:**

| Variable | Required | Description |
|---|---|---|
| `BITBUCKET_USERNAME` | Yes* | Bitbucket username |
| `BITBUCKET_APP_PASSWORD` | Yes* | App password with repo + PR read access |
| `BITBUCKET_REPOSITORIES` | No | Comma-separated `workspace/repo` for CLI tools |
| `OPENAI_API_KEY` | Yes (LLM layer) | OpenAI key for GPT-4.1 code review |
| `OPENAI_MODEL` | No | Model name, default `gpt-4.1` |
| `RISK_HIGH_THRESHOLD` | No | Score ≥ this → HIGH risk, default `0.7` |
| `RISK_MEDIUM_THRESHOLD` | No | Score ≥ this → MEDIUM risk, default `0.4` |

> \* Required only if analyzing Bitbucket PRs. GitHub/GitLab repos can be added by git URL and analyzed via their respective PR URLs once provider support is extended.

### 3. (Optional) Install graph CLI

The AST graph layer requires the `code-review-graph` CLI. Without it all other layers still work.

```bash
pip install code-review-graph[embeddings]
# Verify:
crg --version
```

### 4. Install static analysis tools

```bash
pip install flake8          # Python static analysis
npm install -g eslint       # JS/TS static analysis
```

### 5. Run the backend

```bash
uvicorn api.server:app --reload
# API available at http://localhost:8000
# Swagger docs at http://localhost:8000/docs
```

### 6. Run the frontend

```bash
cd ui
npm install
npm run dev
# UI available at http://localhost:5173
```

---

## Repo Lifecycle

When you add a repository, PR Guardian runs a **three-step background pipeline** that enriches every subsequent PR review.

### Step 1 — Sparse Shallow Clone

```
git clone --depth 1 --no-tags --filter=blob:none --sparse <git_url>
```

- Downloads only the file tree at HEAD, not the full history.
- Excludes `node_modules/`, `vendor/`, `dist/`, `build/`, `*.min.js`, binaries, etc.
- Result: typically **~80% smaller** than a full clone.
- Stored at `data/clones/<workspace>_<repo>/`.
- Progress is streamed to the UI (`clone_status`, `clone_progress`).

### Step 2 — AST Knowledge Graph

Uses the [`code-review-graph`](https://pypi.org/project/code-review-graph/) CLI (`crg`):

```
crg build <clone_path>   # Parse AST → nodes + edges (Files, Classes, Functions)
crg embed <clone_path>   # Compute local embeddings (no API key needed)
```

The graph lives at `~/.code-review-graph/<repo_hash>/graph.db`.

**What the graph tracks:**
- Every function and class across all languages
- Call edges (who calls what)
- Import/dependency edges
- Module community clusters (related groups of files)

This enables **impact radius analysis** at PR review time: given a set of changed files, find every downstream function and execution flow that could be affected.

### Step 3 — ChromaDB Semantic Index

Every source file in the clone is chunked by function/class (Python AST, JS/TS regex, or sliding-window fallback) and embedded using OpenAI `text-embedding-3-small`. Chunks are stored in a local ChromaDB collection at `data/chroma/<workspace>_<repo>/`.

This enables **semantic duplicate detection** at PR review time: new code in a PR is compared against the entire existing codebase to flag re-implementations of existing functions.

---

## PR Analysis Pipeline (7 Layers)

When you click **AI Review** on a PR, all seven layers run in sequence:

```
PR URL
  │
  ├─ 1. ML + Rules ──────────── Risk score, rule violations, hotspot files
  │
  ├─ 2. Dependency Security ─── OSV.dev scan of changed lock/manifest files
  │
  ├─ 3. Static Analysis ──────── flake8 (Python) / ESLint (JS/TS) on changed files
  │
  ├─ 4. Graph Impact Analysis ── crg impact: affected functions, flows, modules
  │
  ├─ 5. LLM Code Review ──────── GPT-4.1 on the diff + graph context injected
  │
  ├─ 6. Semantic Duplicate Detection ── ChromaDB cosine similarity ≥ 0.92
  │
  └─ 7. Report Assembly ──────── Aggregate, boost risk score, build recommendations
```

### Layer 1 — ML + Rule Engine

- **ML model**: Logistic Regression or Random Forest trained on historical PR data.
- Features: TF-IDF on title/description, normalized numeric metrics (files changed, lines added/deleted, commits, comments, approvals).
- **Rules** (independent of ML): missing tests, sensitive module changes (auth/, payment/, config/), dependency file changes, oversized diffs.
- **Auto-training**: after Fetch PRs completes, PRs are auto-labeled (by comment count, commit count, merge duration, decline status) and the model is retrained in the background. The hot-reloaded model is used for the next analysis.

### Layer 2 — Dependency Vulnerability Scanner

- Parses: `package.json`, `requirements.txt`, `composer.json`, `pom.xml`, `Gemfile`, `go.mod`, `Cargo.toml` from the diff.
- Queries [OSV.dev](https://osv.dev) API for every package+version found.
- Returns: vuln ID, summary, severity (CRITICAL/HIGH/MEDIUM/LOW), fixed version.
- Risk boost: +10% per CRITICAL/HIGH vuln, +3% per others.

### Layer 3 — Static Analysis

- Writes changed files to a temp directory and runs available tools.
- **Python**: flake8 (preferred) or pylint.
- **JS/TS**: ESLint.
- Gracefully skips if tools are not installed.
- Risk boost: +2% per static error.

### Layer 4 — Graph Impact Analysis

- Calls `crg impact <clone_path> --files <changed_files> --depth 2 --json`.
- Returns: affected functions, execution flows with depth and criticality, module communities.
- Risk boost: +5% per critical flow (criticality > 0.7), capped at +15%.
- The full graph context (impact summary, affected functions, flows, modules) is:
  - Injected into the LLM prompt as a structured markdown block so GPT-4.1 knows what downstream code is at risk.
  - Returned in the API response as `graph_context` and rendered in the "Impact Analysis" section of the AI Review tab.

### Layer 5 — LLM Code Review

- Sends the PR diff to GPT-4.1 with the graph context prepended.
- Large diffs are split by file boundary and reviewed in chunks; results are merged.
- Returns structured JSON: `issues`, `security_concerns`, `performance_concerns`, `code_smells`, `suggested_improvements`, `summary`.
- Risk boost: +5% per high-severity issue, +8% per security concern.

### Layer 6 — Semantic Duplicate Detection

- Each function/class chunk in the PR's changed files is embedded and queried against the ChromaDB collection.
- Matches with cosine similarity ≥ 0.92 from a different file are flagged as potential re-implementations.
- Shown in the "Code Reuse Opportunities" section of the UI.

### Layer 7 — Report Assembly

- Combines all findings into a single `HybridReport`.
- Final risk score = ML score + all boosts, capped at 1.0.
- Risk level recalculated from final score against configured thresholds.
- Recommendations and review focus list built from all layers.

---

## Web UI

### Sidebar

- Lists all tracked repositories with a status dot (index status).
- **Add Repo** (`+`): accepts any git URL (`https://github.com/org/repo`) or `workspace/repo` shorthand for Bitbucket.
- Expanding a repo shows:
  - **Source** — opens the source browser for that repo.
  - **Pull Requests** — opens the PR list with badge showing PR count.
  - **Build Index** — runs the 3-step clone → graph → ChromaDB pipeline.
  - **↻ Sync** — pulls latest changes and rebuilds the graph incrementally.
  - **Fetch PRs** — downloads up to 500 MERGED + 500 DECLINED PRs, saves them, and triggers auto-training.
  - **Remove** — deletes clone, ChromaDB index, training CSV, and SQLite row.
- While jobs run, a progress bar and percentage are shown inline.

### Source Browser

- Browse the cloned repository's file tree.
- Switch branches via the dropdown (branches come from the local clone).
- Click a directory to navigate in; click a file to view its contents with line numbers.
- Breadcrumb navigation to go back up the tree.
- **↻ Sync** button in the toolbar triggers a sync for the current branch.

### PR List

- Shows OPEN / MERGED / DECLINED tabs with live search filter.
- Each row shows: PR number, title, author avatar, state badge, created date.
- "Review PR →" button navigates to PR Detail (only shown for OPEN PRs).

### PR Detail

**Changes tab**
- Unified diff viewer with per-file collapse/expand.
- Files with AI issues show a warning badge with issue count.
- Hover any diff line to reveal a **+ Comment** button; posting sends an inline comment to the Bitbucket API immediately.
- Posted comments appear inline below the line.

**AI Review tab**
- Click **AI Review** to run the full 7-layer hybrid analysis.
- Results are shown in collapsible sections:
  - Risk Score (visual bar)
  - ML & Rule Analysis
  - **Impact Analysis** — affected functions, execution flows, modules, risk boost (from graph layer)
  - AI Code Review (LLM issues, security/performance concerns, code smells, improvements)
  - Dependency Security (vulnerability table)
  - Static Analysis
  - Code Reuse Opportunities (duplicate warnings)
  - Recommendations
  - Metrics

---

## Architecture

```
pr-guardian/
├── config/              # Settings from .env
├── bitbucket/           # Bitbucket REST API client
├── repos/
│   ├── cloner.py        # Sparse shallow clone (any git provider)
│   └── store.py         # SQLite repo metadata + job status
├── embeddings/
│   ├── chunker.py       # Python AST + JS/TS regex + sliding-window chunker
│   ├── indexer.py       # Upserts chunks into ChromaDB (OpenAI embeddings)
│   └── graph_indexer.py # Wraps crg CLI (build, embed, impact, search)
├── analysis/
│   ├── analyzer.py      # ML + rules PR analyzer
│   ├── duplicate_detector.py  # ChromaDB cosine similarity duplicate detection
│   └── graph_reviewer.py      # AST impact analysis + graph duplicate search
├── llm/
│   └── openai_reviewer.py     # GPT-4.1 code review with graph context injection
├── security/
│   └── dependency_scanner.py  # OSV.dev vulnerability scanning
├── static_analysis/
│   └── analyzer.py      # flake8 / ESLint wrapper
├── hybrid/
│   └── report_builder.py      # Orchestrates all 7 layers → HybridReport
├── api/
│   ├── server.py         # FastAPI routes
│   ├── schemas.py        # Pydantic request/response models
│   └── service.py        # Business logic, background jobs
├── features/             # TF-IDF + numeric feature engineering
├── models/               # Model training, evaluation, persistence
├── rules/                # Rule engine + hotspot detection
├── dataset/              # Auto-labeling logic
├── data_collection/      # Multi-repo PR data collector
├── ui/                   # React + Vite frontend
│   └── src/
│       ├── api/client.js        # All API calls
│       ├── components/
│       │   ├── Sidebar.jsx      # Repo nav, job controls, progress
│       │   └── HybridResultCard.jsx  # Full analysis result renderer
│       └── pages/
│           ├── PRList.jsx       # PR table with state tabs + search
│           ├── PRDetail.jsx     # Diff viewer + inline comments + AI review
│           └── SourceBrowser.jsx  # File tree browser + sync
├── data/
│   ├── repos.db          # SQLite repo store
│   ├── clones/           # Sparse shallow clones (gitignored)
│   ├── chroma/           # ChromaDB vector indexes (gitignored)
│   └── training/         # Generated PR datasets (gitignored)
├── models/               # Trained ML models (gitignored)
├── collect_data.py       # CLI: collect PR data
├── train_model.py        # CLI: train model
└── analyze_pr.py         # CLI: analyze a PR by URL
```

---

## Data Flow: Adding a New Repo

```
User clicks "Add Repo" → POST /repos
          │
          ▼
   Store workspace/repo_slug in SQLite
   Extract git clone URL (bitbucket.org HTTPS or raw git URL)
          │
User clicks "Build Index" → POST /repos/{id}/index
          │
          ▼  [background thread]
   ┌──────────────────────────────────────┐
   │ 1. git clone --depth 1 --sparse …   │  clone_status: cloning → done
   │ 2. crg build + crg embed            │  graph_status: building → done
   │ 3. Chunk files → upsert ChromaDB    │  index_status: indexing → indexed
   └──────────────────────────────────────┘
          │
          ▼
   UI polls /repos/{id} every 2.5s while any job is active
   Progress bars update in the sidebar in real time
```

## Data Flow: Analyzing a PR

```
User clicks "AI Review" → POST /analyze-hybrid { pr_url }
          │
          ▼
   Parse workspace/repo/pr_id from URL
   Fetch PR metadata + diff from Bitbucket API
          │
   ┌──── 7-Layer Pipeline ───────────────────┐
   │ 1. ML predict + rule engine             │
   │ 2. OSV dependency scan                  │
   │ 3. Static analysis (flake8/ESLint)      │
   │ 4. crg impact analysis (if clone ready) │
   │ 5. GPT-4.1 review (+ graph context)     │
   │ 6. ChromaDB duplicate detection         │
   │ 7. Assemble report + boost risk score   │
   └─────────────────────────────────────────┘
          │
          ▼
   HybridAnalyzeResponse → UI renders all sections
```

## Data Flow: Fetch PRs + Auto-Train

```
User clicks "Fetch PRs" → POST /repos/{id}/fetch-prs
          │
          ▼  [background thread]
   Fetch up to 500 MERGED + 500 DECLINED PRs from Bitbucket
   Save to data/training/<workspace>_<repo>_prs.csv
          │
          ▼  [auto-training]
   Label PRs (comment count, commit count, merge time, declined)
   Extract features (TF-IDF + numeric)
   Train Logistic Regression + Random Forest
   If data sufficient (≥10 PRs, both classes present):
     Save best model to models/pr_risk_model.pkl
     Hot-reload model in the running service
```

---

## API Reference

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `POST` | `/analyze` | ML + rules analysis (fast) |
| `POST` | `/analyze-hybrid` | Full 7-layer hybrid analysis |
| `POST` | `/feedback` | Submit risk correction for future training |
| `POST` | `/retrain` | Manually trigger model retraining |
| `GET` | `/repos` | List all tracked repositories |
| `POST` | `/repos` | Add a repository |
| `GET` | `/repos/{id}` | Get repo details + job status |
| `DELETE` | `/repos/{id}` | Remove repo (clone + index + data) |
| `POST` | `/repos/{id}/index` | Start clone → graph → index pipeline |
| `POST` | `/repos/{id}/sync` | Pull latest + rebuild graph |
| `POST` | `/repos/{id}/fetch-prs` | Fetch historical PRs + auto-train |
| `GET` | `/repos/{id}/prs` | List PRs (`?state=OPEN\|MERGED\|DECLINED`) |
| `GET` | `/repos/{id}/branches` | List branches from local clone |
| `GET` | `/repos/{id}/source` | Browse source tree (`?path=src/`) |
| `GET` | `/repos/{id}/source/file` | Read a file (`?path=src/main.py`) |
| `GET` | `/repos/{id}/prs/{pr_id}/diff` | Get unified diff for a PR |
| `POST` | `/repos/{id}/prs/{pr_id}/comments` | Post inline comment to Bitbucket |

Interactive docs: `http://localhost:8000/docs`

---

## Requirements

- Python 3.10+
- Node.js 18+ (frontend)
- Bitbucket Cloud account with API access (for Bitbucket repos)
- OpenAI API key (LLM layer)
- Optional: `pip install code-review-graph[embeddings]` (graph layer)
- Optional: `pip install flake8` and/or `npm install -g eslint` (static analysis)
