import test from "node:test";
import assert from "node:assert/strict";

const baseUrl = "https://phishtopia.com";

async function request(path, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
        ...options
    });
    console.log(`LIVE_CHECK path=${path} status=${response.status} type=${response.headers.get("content-type") || ""} location=${response.headers.get("location") || ""}`);
    return response;
}

test("live production satisfies issue 56 verification", async () => {
    const health = await request("/health");
    assert.equal(health.status, 200);
    assert.match(health.headers.get("content-type") || "", /application\/json/);
    const healthBody = await health.json();
    assert.equal(healthBody.status, "ok");
    assert.equal(healthBody.service, "phishtopia");

    const ready = await request("/ready");
    assert.equal(ready.status, 200);
    assert.match(ready.headers.get("content-type") || "", /application\/json/);

    for (const path of [
        "/",
        "/contact",
        "/auth/login",
        "/auth/register",
        "/auth/resend-verification",
        "/echotrace",
        "/storecalc"
    ]) {
        const response = await request(path);
        assert.equal(response.status, 200, `${path} should render`);
        assert.match(response.headers.get("content-type") || "", /text\/html/);
        const html = await response.text();
        assert.doesNotMatch(
            html,
            /(?:href|src|action)=["']\/(?:static|projects|project\d[\w-]*|player-int)(?:\/|["'])/,
            `${path} emitted a retired local URL`
        );
    }

    const youlist = await request("/youlist");
    assert.equal(youlist.status, 302);
    assert.equal(youlist.headers.get("location"), "/auth/login");

    for (const [path, type] of [
        ["/styles/echotrace.css", /text\/css/],
        ["/js/echotrace.js", /javascript/],
        ["/js/echotrace-logo.js", /javascript/],
        ["/fonts/evealpha-bold.ttf", /(?:font\/ttf|application\/(?:octet-stream|x-font-ttf))/]
    ]) {
        const response = await request(path);
        assert.equal(response.status, 200, `${path} should be served`);
        assert.match(response.headers.get("content-type") || "", type, `${path} content type`);
    }

    for (const path of [
        "/styles/evealpha_bold.ttf",
        "/styles/player-int.css",
        "/js/player-int.js",
        "/js/little-logo.js",
        "/project34/images/placeholder.png",
        "/project29/images/preview.png",
        "/static/20-Simon/",
        "/projects/assets"
    ]) {
        const response = await request(path);
        assert.equal(response.status, 404, `${path} should remain retired`);
    }
});
