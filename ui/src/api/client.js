const API_BASE = "http://localhost:8000";

async function apiRequest(method, endpoint, body) {
  const options = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) options.body = JSON.stringify(body);

  const response = await fetch(`${API_BASE}${endpoint}`, options);

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `Request failed (${response.status})`);
  }

  return response.json();
}

// ─── Analysis ──────────────────────────────────────
export async function analyzePR(prUrl) {
  return apiRequest("POST", "/analyze", { pr_url: prUrl });
}

export async function analyzeHybrid(prUrl) {
  return apiRequest("POST", "/analyze-hybrid", { pr_url: prUrl });
}

// ─── Repo management ───────────────────────────────
export async function listRepos() {
  return apiRequest("GET", "/repos");
}

export async function addRepo(repoUrl) {
  return apiRequest("POST", "/repos", { repo_url: repoUrl });
}

export async function deleteRepo(repoId) {
  return apiRequest("DELETE", `/repos/${repoId}`);
}

export async function getRepo(repoId) {
  return apiRequest("GET", `/repos/${repoId}`);
}

export async function indexRepo(repoId) {
  return apiRequest("POST", `/repos/${repoId}/index`);
}

export async function fetchRepoPRs(repoId) {
  return apiRequest("POST", `/repos/${repoId}/fetch-prs`);
}

export async function syncRepo(repoId) {
  return apiRequest("POST", `/repos/${repoId}/sync`);
}

export async function registerWebhook(repoId) {
  return apiRequest("POST", `/repos/${repoId}/webhook`);
}

// ─── PR management ─────────────────────────────────
export async function getRepoPRs(repoId, state = "OPEN") {
  return apiRequest("GET", `/repos/${repoId}/prs?state=${state}`);
}

export async function getPRDiff(repoId, prId) {
  return apiRequest("GET", `/repos/${repoId}/prs/${prId}/diff`);
}

export async function postPRComment(repoId, prId, text, filepath, line) {
  return apiRequest("POST", `/repos/${repoId}/prs/${prId}/comments`, { text, filepath, line });
}

export async function postReviewComments(repoId, prId, reviewData) {
  return apiRequest("POST", `/repos/${repoId}/prs/${prId}/post-review-comments`, {
    llm_detected_issues:       reviewData.llm_detected_issues       || [],
    llm_security_concerns:     reviewData.llm_security_concerns     || [],
    llm_performance_concerns:  reviewData.llm_performance_concerns  || [],
    llm_code_smells:           reviewData.llm_code_smells           || [],
    llm_improvements:          reviewData.llm_improvements          || [],
    static_analysis_issues:    reviewData.static_analysis_issues    || [],
  });
}

// ─── Source browser ────────────────────────────────
export async function listBranches(repoId) {
  return apiRequest("GET", `/repos/${repoId}/branches`);
}

export async function checkoutBranch(repoId, branch) {
  return apiRequest("POST", `/repos/${repoId}/checkout?branch=${encodeURIComponent(branch)}`);
}

export async function browseSource(repoId, path = "", branch = "") {
  const params = new URLSearchParams({ path });
  if (branch) params.set("branch", branch);
  return apiRequest("GET", `/repos/${repoId}/source?${params}`);
}

export async function readSourceFile(repoId, path, branch = "") {
  const params = new URLSearchParams({ path });
  if (branch) params.set("branch", branch);
  return apiRequest("GET", `/repos/${repoId}/source/file?${params}`);
}

// ─── Bitbucket discovery ───────────────────────────
export async function listBitbucketRepos() {
  return apiRequest("GET", "/bitbucket/repos");
}

export async function refreshBitbucketRepos() {
  return apiRequest("POST", "/bitbucket/repos/refresh");
}

export async function listBitbucketWorkspaces() {
  return apiRequest("GET", "/bitbucket/workspaces");
}
