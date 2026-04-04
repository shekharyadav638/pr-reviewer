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

// PR analysis
export async function analyzePR(prUrl) {
  return apiRequest("POST", "/analyze", { pr_url: prUrl });
}

export async function analyzeHybrid(prUrl) {
  return apiRequest("POST", "/analyze-hybrid", { pr_url: prUrl });
}

// Repo management
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

export async function getRepoPRs(repoId, state = "OPEN") {
  return apiRequest("GET", `/repos/${repoId}/prs?state=${state}`);
}

export async function getPRDiff(repoId, prId) {
  return apiRequest("GET", `/repos/${repoId}/prs/${prId}/diff`);
}

export async function postPRComment(repoId, prId, text, filepath, line) {
  return apiRequest("POST", `/repos/${repoId}/prs/${prId}/comments`, {
    text,
    filepath,
    line,
  });
}

// Source browser
export async function listBranches(repoId) {
  return apiRequest("GET", `/repos/${repoId}/branches`);
}

export async function browseSource(repoId, path = "") {
  return apiRequest("GET", `/repos/${repoId}/source?path=${encodeURIComponent(path)}`);
}

export async function readSourceFile(repoId, path) {
  return apiRequest("GET", `/repos/${repoId}/source/file?path=${encodeURIComponent(path)}`);
}

export async function syncRepo(repoId, branch = "") {
  const qs = branch ? `?branch=${encodeURIComponent(branch)}` : "";
  return apiRequest("POST", `/repos/${repoId}/sync${qs}`);
}
