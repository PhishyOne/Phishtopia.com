import test from 'node:test';
import assert from 'node:assert/strict';

test('report latest Phishtopia Ops controller workflow runs after activation retry', async () => {
  const response = await fetch(
    'https://api.github.com/repos/PhishyOne/Phishtopia.com/actions/workflows/phishtopia-ops-controller.yml/runs?event=issue_comment&per_page=5',
    {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'phishtopia-ops-controller-retry-probe',
      },
    },
  );

  assert.equal(response.ok, true, `GitHub API returned ${response.status}`);
  const payload = await response.json();
  assert.equal(Array.isArray(payload.workflow_runs), true);
  console.log(`PHISHTOPIA_OPS_RETRY_RUNS=${JSON.stringify(payload.workflow_runs.map((run) => ({
    id: run.id,
    run_number: run.run_number,
    event: run.event,
    status: run.status,
    conclusion: run.conclusion,
    head_sha: run.head_sha,
    created_at: run.created_at,
    updated_at: run.updated_at,
  })))}`);
});
