import test from 'node:test';
import assert from 'node:assert/strict';

const workflow = 'phishtopia-ops-controller.yml';
const url = `https://api.github.com/repos/PhishyOne/Phishtopia.com/actions/workflows/${workflow}/runs?event=issue_comment&per_page=5`;

test('report latest Phishtopia Ops controller runs after sidecar activation', async () => {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'phishtopia-ci-probe', Accept: 'application/vnd.github+json' },
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  const runs = payload.workflow_runs.map((run) => ({
    id: run.id,
    run_number: run.run_number,
    status: run.status,
    conclusion: run.conclusion,
    head_sha: run.head_sha,
    created_at: run.created_at,
    updated_at: run.updated_at,
  }));
  console.log(`PHISHTOPIA_SIDECAR_RESULT_RUNS=${JSON.stringify(runs)}`);
});
