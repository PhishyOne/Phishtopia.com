import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requireTurnstile } from '../src/middleware/requireTurnstile.js';
import { verifyTurnstileToken } from '../src/services/turnstile.service.js';

const base = {
    token: 'a-fresh-token',
    expectedAction: 'signup',
    remoteIp: '203.0.113.5',
    secret: 'test-only-secret',
    allowedHostnames: 'phishtopia.com'
};

function fakeSiteverify(verdict, status = 200) {
    return async (url, init) => {
        assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
        assert.equal(init.method, 'POST');
        assert.equal(init.headers['Content-Type'], 'application/x-www-form-urlencoded');
        assert.equal(init.body.get('secret'), base.secret);
        assert.equal(init.body.get('response'), base.token);
        assert.equal(init.body.get('remoteip'), base.remoteIp);
        assert.ok(init.signal);
        return { ok: status >= 200 && status < 300, json: async () => verdict };
    };
}

test('accepts matching success, action, and exact production hostname', async () => {
    const ok = await verifyTurnstileToken({
        ...base,
        fetchImpl: fakeSiteverify({ success: true, action: 'signup', hostname: 'phishtopia.com' })
    });
    assert.equal(ok, true);
});

test('rejects failed, wrong-action, and wrong-hostname verdicts', async () => {
    for (const verdict of [
        { success: false, action: 'signup', hostname: 'phishtopia.com' },
        { success: true, action: 'resend_verification', hostname: 'phishtopia.com' },
        { success: true, action: 'signup', hostname: 'evil.phishtopia.com' },
        { success: true, action: 'signup', hostname: 'localhost' },
        null
    ]) {
        assert.equal(await verifyTurnstileToken({
            ...base,
            fetchImpl: fakeSiteverify(verdict)
        }), false);
    }
});

test('does not contact Siteverify for a missing token, secret, or allowlist', async () => {
    const fetchImpl = () => { throw Error('should not be called'); };
    for (const overrides of [
        { token: '' },
        { token: undefined },
        { token: ['unexpected'] },
        { token: 'x'.repeat(2049) },
        { secret: undefined },
        { secret: '' },
        { secret: '   ' },
        { allowedHostnames: '' },
        { allowedHostnames: undefined },
        { expectedAction: '' }
    ]) {
        assert.equal(await verifyTurnstileToken({
            ...base, ...overrides, fetchImpl
        }), false);
    }
});

test('fails closed for Siteverify network errors, HTTP errors, and invalid JSON', async () => {
    const providers = [
        async () => { throw new Error('network down'); },
        fakeSiteverify(null, 503),
        async () => ({ ok: true, json: async () => { throw new SyntaxError('invalid JSON'); } })
    ];
    for (const fetchImpl of providers) {
        assert.equal(await verifyTurnstileToken({ ...base, fetchImpl }), false);
    }
});

test('allows multiple explicitly approved hostnames', async () => {
    const ok = await verifyTurnstileToken({
        ...base,
        allowedHostnames: 'other.example, phishtopia.com',
        fetchImpl: fakeSiteverify({ success: true, action: 'signup', hostname: 'phishtopia.com' })
    });
    assert.equal(ok, true);
});

function fakeResponse() {
    return {
        statusCode: null,
        typeName: null,
        message: null,
        status(code) { this.statusCode = code; return this; },
        type(type) { this.typeName = type; return this; },
        send(message) { this.message = message; return this; }
    };
}

test('middleware gates the handler and passes the action and client IP', async () => {
    const req = { body: { 'cf-turnstile-response': 'abc' }, ip: '203.0.113.8' };
    const res = fakeResponse();
    let entered = false;
    const gate = requireTurnstile('resend_verification', async values => {
        assert.deepEqual(values, {
            token: 'abc', expectedAction: 'resend_verification', remoteIp: '203.0.113.8'
        });
        return true;
    });
    await gate(req, res, () => { entered = true; });
    assert.equal(entered, true);
    assert.equal(res.statusCode, null);
});

test('middleware rejects absent, invalid, or unexpectedly throwing verification', async () => {
    for (const verify of [async () => false, async () => { throw Error('failed'); }]) {
        const res = fakeResponse();
        let entered = false;
        await requireTurnstile('signup', verify)({ body: {}, ip: '203.0.113.8' }, res, () => { entered = true; });
        assert.equal(entered, false);
        assert.equal(res.statusCode, 403);
        assert.equal(res.typeName, 'text/plain');
        assert.match(res.message, /Verification failed/);
    }
});

test('signup and resend routes are gated before their existing handlers', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(new URL('../src/routes/auth.routes.js', import.meta.url), 'utf8');
    assert.match(source, /router\.post\("\/register", registerLimiter, requireTurnstile\("signup"\), register\)/);
    assert.match(source, /router\.post\("\/resend-verification", resendVerificationLimiter, requireTurnstile\("resend_verification"\), resendVerification\)/);
});

test('both EJS forms submit a distinct Turnstile action with the supplied public site key', async () => {
    const { readFile } = await import('node:fs/promises');
    const key = '0x4AAAAAAFSrqWf6L8k8gYxz';
    for (const [path, action] of [
        ['../views/register.ejs', 'signup'],
        ['../views/resend-verification.ejs', 'resend_verification']
    ]) {
        const html = await readFile(new URL(path, import.meta.url), 'utf8');
        assert.match(html, /https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/);
        assert.ok(html.includes('data-sitekey="' + key + '"'));
        assert.ok(html.includes('data-action="' + action + '"'));
        assert.doesNotMatch(html, /TURNSTILE_SECRET/);
    }
});
