import test from 'node:test';
import assert from 'node:assert/strict';

test('report latest Phishtopia Ops controller runs after sidecar activation', async () => {
  const response = await fetch('https://api.github.com/repos/PhishyOne/Phishtopia.com/actions/runs?event=issue_comment&per_page=5', {
    headers: { 'User-Agent': 'phishtopia-ci-probe', Accept: 'application/vnd.github+json' },
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  const runs = payload.workflow_runs
    .filter((run) => run.name === 'Phishtopia Ops Controller')
    .map((run) => ({
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
