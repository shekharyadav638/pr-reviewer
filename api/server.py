import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from pydantic import BaseModel

from api.schemas import (
    AddRepoRequest,
    AnalyzeRequest,
    PostReviewCommentsRequest,
    AnalyzeResponse,
    ErrorResponse,
    FeedbackRequest,
    HybridAnalyzeResponse,
    PRListItem,
    RepoResponse,
    SourceEntry,
    SourceFileResponse,
)
from api.service import AnalysisService

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

app = FastAPI(
    title="PR Guardian API",
    description="ML-based Pull Request Risk & Review Intelligence",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

service = AnalysisService()


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.post(
    "/analyze",
    response_model=AnalyzeResponse,
    responses={
        400: {"model": ErrorResponse},
        500: {"model": ErrorResponse},
    },
)
def analyze_pr(request: AnalyzeRequest):
    try:
        return service.analyze(request.pr_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logging.exception("Analysis failed for %s", request.pr_url)
        raise HTTPException(
            status_code=500,
            detail=f"Analysis failed: {e}",
        )

@app.post(
    "/feedback",
    responses={
        400: {"model": ErrorResponse},
        500: {"model": ErrorResponse},
    },
)
def submit_feedback(request: FeedbackRequest):
    try:
        return service.record_feedback(request.pr_url, request.user_corrected_risk)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logging.exception("Feedback submission failed for %s", request.pr_url)
        raise HTTPException(
            status_code=500,
            detail=f"Feedback submission failed: {e}",
        )

@app.post(
    "/retrain",
    responses={
        400: {"model": ErrorResponse},
        500: {"model": ErrorResponse},
    },
)
def retrain_models():
    """Triggers a background model retraining including new user feedback."""
    try:
        return service.trigger_retraining()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logging.exception("Retraining failed")
        raise HTTPException(
            status_code=500,
            detail=f"Retraining failed: {e}",
        )


@app.post(
    "/analyze-hybrid",
    response_model=HybridAnalyzeResponse,
    responses={
        400: {"model": ErrorResponse},
        500: {"model": ErrorResponse},
    },
)
def analyze_pr_hybrid(request: AnalyzeRequest):
    try:
        return service.analyze_hybrid(request.pr_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logging.exception("Hybrid analysis failed for %s", request.pr_url)
        raise HTTPException(
            status_code=500,
            detail=f"Hybrid analysis failed: {e}",
        )


# ------------------------------------------------------------------ #
# Repo management endpoints                                            #
# ------------------------------------------------------------------ #

@app.get("/repos", response_model=list[RepoResponse])
def list_repos():
    return service.list_repos()


@app.post(
    "/repos",
    response_model=RepoResponse,
    responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
)
def add_repo(request: AddRepoRequest):
    try:
        return service.add_repo(request.repo_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete(
    "/repos/{repo_id}",
    responses={404: {"model": ErrorResponse}},
)
def delete_repo(repo_id: int):
    try:
        return service.delete_repo(repo_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.post(
    "/repos/{repo_id}/index",
    responses={404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
)
def index_repo(repo_id: int):
    """Start building the semantic vector index for this repo."""
    try:
        return service.start_index_repo(repo_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get(
    "/repos/{repo_id}",
    response_model=RepoResponse,
    responses={404: {"model": ErrorResponse}},
)
def get_repo(repo_id: int):
    store_record = service._repo_store().get_repo(repo_id)
    if not store_record:
        raise HTTPException(status_code=404, detail=f"Repo {repo_id} not found")
    return service._repo_to_response(store_record)


@app.get(
    "/repos/{repo_id}/prs",
    response_model=list[PRListItem],
    responses={404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
)
def get_repo_prs(repo_id: int, state: str = "OPEN"):
    try:
        return service.get_repo_prs(repo_id, state=state)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logging.exception("Failed to fetch PRs for repo %d", repo_id)
        raise HTTPException(status_code=500, detail=str(e))


@app.post(
    "/repos/{repo_id}/fetch-prs",
    responses={404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
)
def fetch_repo_prs(repo_id: int):
    """Trigger background fetch of historical PRs for this repo."""
    try:
        return service.start_fetch_repo_prs(repo_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post(
    "/repos/{repo_id}/sync",
    responses={404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
)
def sync_repo(repo_id: int):
    """Pull latest code for all indexed branches and rebuild graphs."""
    try:
        return service.sync_repo(repo_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get(
    "/repos/{repo_id}/branches",
    responses={404: {"model": ErrorResponse}},
)
def list_branches(repo_id: int):
    """List git branches available in the local clone."""
    try:
        return {"branches": service.list_branches(repo_id)}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.post(
    "/repos/{repo_id}/checkout",
    responses={404: {"model": ErrorResponse}},
)
def checkout_branch(repo_id: int, branch: str):
    """Fetch and checkout a branch in the local clone."""
    try:
        return service.checkout_branch(repo_id, branch)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get(
    "/repos/{repo_id}/source",
    response_model=list[SourceEntry],
    responses={404: {"model": ErrorResponse}},
)
def browse_source(repo_id: int, path: str = "", branch: str = ""):
    """Browse the source tree of a cloned repo at the given path and branch."""
    try:
        return service.browse_source(repo_id, path, branch)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.get(
    "/repos/{repo_id}/source/file",
    response_model=SourceFileResponse,
    responses={404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
)
def read_source_file(repo_id: int, path: str, branch: str = ""):
    """Return the contents of a single source file from the clone."""
    try:
        return service.read_source_file(repo_id, path, branch)
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ------------------------------------------------------------------ #
# PR detail: diff + inline comments                                    #
# ------------------------------------------------------------------ #

@app.get(
    "/repos/{repo_id}/prs/{pr_id}/diff",
    responses={404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
)
def get_pr_diff(repo_id: int, pr_id: int):
    """Return the raw unified diff for a PR."""
    try:
        return service.get_pr_diff(repo_id, pr_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logging.exception("Failed to fetch diff for PR %d", pr_id)
        raise HTTPException(status_code=500, detail=str(e))


@app.post(
    "/repos/{repo_id}/prs/{pr_id}/post-review-comments",
    responses={404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
)
def post_review_comments(repo_id: int, pr_id: int, request: PostReviewCommentsRequest):
    """Post all AI-detected issues as inline Bitbucket PR comments."""
    try:
        return service.post_review_comments(repo_id, pr_id, request.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logging.exception("Failed to post review comments on PR %d", pr_id)
        raise HTTPException(status_code=500, detail=str(e))


class InlineCommentRequest(BaseModel):
    text: str
    filepath: str
    line: int


@app.post(
    "/repos/{repo_id}/prs/{pr_id}/comments",
    responses={404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
)
def post_pr_comment(repo_id: int, pr_id: int, request: InlineCommentRequest):
    """Post an inline review comment on a PR file+line via Bitbucket API."""
    try:
        return service.post_pr_comment(
            repo_id, pr_id, request.text, request.filepath, request.line
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logging.exception("Failed to post comment on PR %d", pr_id)
        raise HTTPException(status_code=500, detail=str(e))


# ------------------------------------------------------------------ #
# Bitbucket repo discovery                                             #
# ------------------------------------------------------------------ #

@app.post(
    "/repos/{repo_id}/webhook",
    responses={404: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
)
def register_webhook(repo_id: int):
    """Register a PR-created webhook on the Bitbucket repo."""
    import os
    host = os.getenv("WEBHOOK_BASE_URL", "").rstrip("/") or "http://localhost:8000"
    callback_url = f"{host}/webhook/bitbucket"
    try:
        return service.register_webhook(repo_id, callback_url)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logging.warning("Webhook registration failed for repo %d: %s", repo_id, e)
        return {"status": "error", "message": str(e)}


@app.get("/bitbucket/repos")
def list_bitbucket_repos():
    """Return cached Bitbucket repo listing (instant after first refresh)."""
    try:
        return service.list_bitbucket_repos()
    except Exception as e:
        logging.exception("Failed to list Bitbucket repos")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/bitbucket/repos/refresh")
def refresh_bitbucket_repos():
    """Fetch fresh repo list from Bitbucket API and update the local cache."""
    try:
        return service.refresh_bitbucket_repos()
    except Exception as e:
        logging.exception("Failed to refresh Bitbucket repos")
        raise HTTPException(status_code=500, detail=str(e))


# ------------------------------------------------------------------ #
# Bitbucket webhook — auto-review on PR creation                       #
# ------------------------------------------------------------------ #

@app.post("/webhook/bitbucket")
async def bitbucket_webhook(request: Request):
    """
    Receives Bitbucket webhook events.
    On pullrequest:created, triggers hybrid analysis and posts review comments.
    """
    event = request.headers.get("X-Event-Key", "")
    if event != "pullrequest:created":
        return {"status": "ignored", "event": event}
    try:
        payload = await request.json()
        return service.handle_pr_created_webhook(payload)
    except Exception as e:
        logging.exception("Webhook handling failed")
        raise HTTPException(status_code=500, detail=str(e))
