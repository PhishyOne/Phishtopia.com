import test from 'node:test';
import assert from 'node:assert/strict';

const URL = 'https://api.github.com/repos/PhishyOne/Phishtopia.com/actions/workflows/phishtopia-ops-controller.yml/runs?per_page=20&event=issue_comment';

test('report recent Phishtopia Ops controller workflow runs', async () => {
  const response = await fetch(URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'phishtopia-ops-diagnostic/1',
    },
  });
  assert.equal(response.ok, true, `GitHub Actions request failed with ${response.status}`);
  const payload = await response.json();
  assert.ok(Array.isArray(payload.workflow_runs));
  const runs = payload.workflow_runs.slice(0, 10).map((run) => ({
    id: run.id,
    run_number: run.run_number,
    event: run.event,
    status: run.status,
    conclusion: run.conclusion,
    head_sha: run.head_sha,
    created_at: run.created_at,
    updated_at: run.updated_at,
  }));
  console.log(`PHISHTOPIA_OPS_CONTROLLER_RUNS=${JSON.stringify(runs)}`);
});
