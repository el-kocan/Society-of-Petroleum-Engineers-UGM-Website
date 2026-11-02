/* eslint-disable @typescript-eslint/no-require-imports -- Node test runner */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const Module = require("node:module");
const ts = require("typescript");

const root = path.resolve(__dirname, "../../");

let mockSupabaseBehavior = {
  data: { id: "87e7c760-1fb2-4e61-a803-b82a41b7847c" },
  error: null,
  returnErrorObject: null,
};

let mockUpstashBehavior = {
  pingResult: "PONG",
  error: null,
};

const mockSupabase = {
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: (_field, val) => ({
          maybeSingle: async () => {
            if (mockSupabaseBehavior.error) {
              throw mockSupabaseBehavior.error;
            }
            if (mockSupabaseBehavior.returnErrorObject) {
              return { data: null, error: mockSupabaseBehavior.returnErrorObject };
            }
            if (mockSupabaseBehavior.data && mockSupabaseBehavior.data.id === val) {
              return { data: mockSupabaseBehavior.data, error: null };
            }
            return { data: null, error: null };
          },
        }),
      }),
    }),
  }),
};

class MockRedis {
  constructor(opts) {
    this.opts = opts;
  }
  async ping() {
    if (mockUpstashBehavior.error) {
      throw mockUpstashBehavior.error;
    }
    return mockUpstashBehavior.pingResult;
  }
}

// Setup module interception before loading route
const originalLoad = Module._load;
Module._load = function (id, parent, main) {
  if (id === "server-only") return {};
  if (id.startsWith("@/")) id = path.join(root, "src", id.slice(2));
  if (id === "@supabase/supabase-js") return mockSupabase;
  if (id === "@upstash/redis") return { Redis: MockRedis };
  return originalLoad.call(this, id, parent, main);
};

require.extensions[".ts"] = (module, filename) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    filename,
  );

const route = require("../../app/api/internal/staging-connectivity/route.ts");

// Exactly 64-character hexadecimal token (representing 32 cryptographically random bytes)
const TEST_CONNECTIVITY_TOKEN = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
const TEST_PROJECT_ID = "prj_Hj8Qjg7x5yWZvUnO8PxYG9wYJKgs";
const EXACT_STAGING_URL = "https://lavxddhrrwsjcshmnwvu.supabase.co";
const TEST_PERIOD_ID = "87e7c760-1fb2-4e61-a803-b82a41b7847c";
const TEST_SECRET_KEY = "sb_secret_staging_service_role_key_value_mock";
const TEST_REDIS_TOKEN = "upstash_secret_token_value_mock_123456";

function cleanEnv() {
  delete process.env.STAGING_CONNECTIVITY_TOKEN;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  delete process.env.VERCEL_PROJECT_ID;
  delete process.env.VERCEL_STAGING_PROJECT_ID;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.RECRUITMENT_STAGING_SECRET_KEY;
  delete process.env.RECRUITMENT_PERIOD_ID;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.RECRUITMENT_ENABLED;
  delete process.env.RECRUITMENT_STAGING_ENABLED;

  mockSupabaseBehavior = {
    data: { id: TEST_PERIOD_ID },
    error: null,
    returnErrorObject: null,
  };
  mockUpstashBehavior = {
    pingResult: "PONG",
    error: null,
  };
}

function setValidEnv() {
  cleanEnv();
  process.env.STAGING_CONNECTIVITY_TOKEN = TEST_CONNECTIVITY_TOKEN;
  process.env.VERCEL = "1";
  process.env.VERCEL_ENV = "production";
  process.env.VERCEL_PROJECT_ID = TEST_PROJECT_ID;
  process.env.VERCEL_STAGING_PROJECT_ID = TEST_PROJECT_ID;
  process.env.NEXT_PUBLIC_SUPABASE_URL = EXACT_STAGING_URL;
  process.env.SUPABASE_SECRET_KEY = TEST_SECRET_KEY;
  process.env.RECRUITMENT_PERIOD_ID = TEST_PERIOD_ID;
  process.env.UPSTASH_REDIS_REST_URL = "https://mock-staging-redis.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = TEST_REDIS_TOKEN;
}

test("Staging Connectivity: Bounded 64-Hex Token Authentication", async (t) => {
  cleanEnv();

  await t.test("denies with 404 when STAGING_CONNECTIVITY_TOKEN is not configured on server", async () => {
    setValidEnv();
    delete process.env.STAGING_CONNECTIVITY_TOKEN;

    const req = new Request("https://staging.speugmsc.org/api/internal/staging-connectivity", {
      headers: { "x-staging-connectivity-token": TEST_CONNECTIVITY_TOKEN },
    });
    const res = await route.GET(req);
    assert.equal(res.status, 404);
  });

  await t.test("denies with 404 when server token is not a valid 64-character hex string", async () => {
    setValidEnv();
    process.env.STAGING_CONNECTIVITY_TOKEN = "not-64-hex-chars-too-short";

    const req = new Request("https://staging.speugmsc.org/api/internal/staging-connectivity", {
      headers: { "x-staging-connectivity-token": "not-64-hex-chars-too-short" },
    });
    const res = await route.GET(req);
    assert.equal(res.status, 404);
  });

  await t.test("denies with 404 when server token contains non-hex characters", async () => {
    setValidEnv();
    // 64 chars but contains 'z'
    process.env.STAGING_CONNECTIVITY_TOKEN = "z1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

    const req = new Request("https://staging.speugmsc.org/api/internal/staging-connectivity", {
      headers: { "x-staging-connectivity-token": "z1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90" },
    });
    const res = await route.GET(req);
    assert.equal(res.status, 404);
  });

  await t.test("denies with 404 when request is missing connectivity token header", async () => {
    setValidEnv();

    const req = new Request("https://staging.speugmsc.org/api/internal/staging-connectivity");
    const res = await route.GET(req);
    assert.equal(res.status, 404);
  });

  await t.test("denies with 404 when client token is not 64 hex characters (bounded validation)", async () => {
    setValidEnv();

    const req = new Request("https://staging.speugmsc.org/api/internal/staging-connectivity", {
      headers: { "x-staging-connectivity-token": "abc123short" },
    });
    const res = await route.GET(req);
    assert.equal(res.status, 404);
  });

  await t.test("denies with 404 when client token has 64 chars but contains non-hex characters", async () => {
    setValidEnv();
    const nonHexToken = "x".repeat(64);

    const req = new Request("https://staging.speugmsc.org/api/internal/staging-connectivity", {
      headers: { "x-staging-connectivity-token": nonHexToken },
    });
    const res = await route.GET(req);
    assert.equal(res.status, 404);
  });

  await t.test("denies with 404 when supplied 64-hex token does not match server token", async () => {
    setValidEnv();
    const mismatchedToken = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    const req = new Request("https://staging.speugmsc.org/api/internal/staging-connectivity", {
      headers: { "x-staging-connectivity-token": mismatchedToken },
    });
    const res = await route.GET(req);
    assert.equal(res.status, 404);
  });

  await t.test("accepts matching 64-hex token case-insensitively", async () => {
    setValidEnv();
    const uppercaseToken = TEST_CONNECTIVITY_TOKEN.toUpperCase();

    const req = new Request("https://staging.speugmsc.org/api/internal/staging-connectivity", {
      headers: { "x-staging-connectivity-token": uppercaseToken },
    });
    const res = await route.GET(req);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.deepEqual(json, { supabase: "ok", upstash: "ok" });
  });
});

test("Staging Connectivity: VERCEL=1 and VERCEL_ENV=production Runtime Guards", async (t) => {
  cleanEnv();

  await t.test("denies with 404 when VERCEL is not '1'", async () => {
    setValidEnv();
    delete process.env.VERCEL;

    const req = new Request("https://staging.speugmsc.org/api/internal/staging-connectivity", {
      headers: { "x-staging-connectivity-token": TEST_CONNECTIVITY_TOKEN },
    });
    const res = await route.GET(req);
    assert.equal(res.status, 404);
  });

  await t.test("denies with 404 when VERCEL_ENV is not 'production' (e.g. preview)", async () => {
    setValidEnv();
    process.env.VERCEL_ENV = "preview";

    const req = new Request("https://staging.speugmsc.org/api/internal/staging-connectivity", {
      headers: { "x-staging-connectivity-token": TEST_CONNECTIVITY_TOKEN },
    });
    const res = await route.GET(req);
    assert.equal(res.status, 404);
  });

  await t.test("denies with 404 when VERCEL_ENV is unset", async () => {
    setValidEnv();
    delete process.env.VERCEL_ENV;

    const req = new Request("https://staging.speugmsc.org/api/internal/staging-connectivity", {
      headers: { "x-staging-connectivity-token": TEST_CONNECTIVITY_TOKEN },
    });
    const res = await route.GET(req);
    assert.equal(res.status, 404);
  });

  await t.test("denies with 404 when VERCEL_PROJECT_ID is absent", async () => {
    setValidEnv();
    delete process.env.VERCEL_PROJECT_ID;

    const req = new Request("https://staging.speugmsc.org/api/internal/staging-connectivity", {
      headers: { "x-staging-connectivity-token": TEST_CONNECTIVITY_TOKEN },
    });
    const res = await route.GET(req);
    assert.equal(res.status, 404);
  });

  await t.test("denies with 404 when VERCEL_STAGING_PROJECT_ID is absent", async () => {
    setValidEnv();
    delete process.env.VERCEL_STAGING_PROJECT_ID;

    const req = new Request("https://staging.speugmsc.org/api/internal/staging-connectivity", {
      headers: { "x-staging-connectivity-token": TEST_CONNECTIVITY_TOKEN },
    });
    const res = await route.GET(req);
    assert.equal(res.status, 404);
  });

  await t.test("denies with 404 when VERCEL_PROJECT_ID does not match expected ID", async () => {
    setValidEnv();
    process.env.VERCEL_PROJECT_ID = "prj_mismatched_unauthorized_prod";

    const req = new Request("https://staging.speugmsc.org/api/internal/staging-connectivity", {
      headers: { "x-staging-connectivity-token": TEST_CONNECTIVITY_TOKEN },
    });
    const res = await route.GET(req);
    assert.equal(res.status, 404);
  });
});

test("Staging Connectivity: Exact NEXT_PUBLIC_SUPABASE_URL Enforcement", async (t) => {
  cleanEnv();

  await t.test("returns supabase: error when URL has trailing slash", async () => {
    setValidEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = `${EXACT_STAGING_URL}/`;

    const req = new Request("https://staging.speugmsc.org/api/internal/staging-connectivity", {
      headers: { "x-staging-connectivity-token": TEST_CONNECTIVITY_TOKEN },
    });
    const res = await route.GET(req);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.deepEqual(json, { supabase: "error", upstash: "ok" });
  });

  await t.test("returns supabase: error when URL has port", async () => {
    setValidEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://lavxddhrrwsjcshmnwvu.supabase.co:443";

    const req = new Request("https://staging.speugmsc.org/api/internal/staging-connectivity", {
      headers: { "x-staging-connectivity-token": TEST_CONNECTIVITY_TOKEN },
    });
    const res = await route.GET(req);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.supabase, "error");
  });

  await t.test("returns supabase: error when URL has path", async () => {
    setValidEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = `${EXACT_STAGING_URL}/rest/v1`;

    const req = new Request("https://staging.speugmsc.org/api/internal/staging-connectivity", {
      headers: { "x-staging-connectivity-token": TEST_CONNECTIVITY_TOKEN },
    });
    const res = await route.GET(req);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.supabase, "error");
  });

  await t.test("returns supabase: error when URL has query string", async () => {
    setValidEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = `${EXACT_STAGING_URL}?apikey=123`;

    const req = new Request("https://staging.speugmsc.org/api/internal/staging-connectivity", {
      headers: { "x-staging-connectivity-token": TEST_CONNECTIVITY_TOKEN },
    });
    const res = await route.GET(req);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.supabase, "error");
  });

  await t.test("returns supabase: error when URL protocol is http", async () => {
    setValidEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://lavxddhrrwsjcshmnwvu.supabase.co";

    const req = new Request("https://staging.speugmsc.org/api/internal/staging-connectivity", {
      headers: { "x-staging-connectivity-token": TEST_CONNECTIVITY_TOKEN },
    });
    const res = await route.GET(req);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.supabase, "error");
  });

  await t.test("returns supabase: error when URL is a different project", async () => {
    setValidEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://prod-spe-ugm.supabase.co";

    const req = new Request("https://staging.speugmsc.org/api/internal/staging-connectivity", {
      headers: { "x-staging-connectivity-token": TEST_CONNECTIVITY_TOKEN },
    });
    const res = await route.GET(req);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.supabase, "error");
  });

  await t.test("returns supabase: error when URL is unset", async () => {
    setValidEnv();
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    const req = new Request("https://staging.speugmsc.org/api/internal/staging-connectivity", {
      headers: { "x-staging-connectivity-token": TEST_CONNECTIVITY_TOKEN },
    });
    const res = await route.GET(req);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.supabase, "error");
  });
});

test("Staging Connectivity: Strict SUPABASE_SECRET_KEY Requirement (No Fallback)", async (t) => {
  cleanEnv();

  await t.test("returns supabase: error when SUPABASE_SECRET_KEY is missing even if RECRUITMENT_STAGING_SECRET_KEY is set", async () => {
    setValidEnv();
    delete process.env.SUPABASE_SECRET_KEY;
    process.env.RECRUITMENT_STAGING_SECRET_KEY = TEST_SECRET_KEY; // Should NOT be used as fallback!

    const req = new Request("https://staging.speugmsc.org/api/internal/staging-connectivity", {
      headers: { "x-staging-connectivity-token": TEST_CONNECTIVITY_TOKEN },
    });
    const res = await route.GET(req);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.deepEqual(json, { supabase: "error", upstash: "ok" });
  });

  await t.test("succeeds when SUPABASE_SECRET_KEY is set", async () => {
    setValidEnv();
    delete process.env.RECRUITMENT_STAGING_SECRET_KEY; // Ensure clean state

    const req = new Request("https://staging.speugmsc.org/api/internal/staging-connectivity", {
      headers: { "x-staging-connectivity-token": TEST_CONNECTIVITY_TOKEN },
    });
    const res = await route.GET(req);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.deepEqual(json, { supabase: "ok", upstash: "ok" });
  });
});

test("Staging Connectivity: Upstash Credential & Connection Failures", async (t) => {
  cleanEnv();

  await t.test("returns upstash: error when UPSTASH_REDIS_REST_URL is missing", async () => {
    setValidEnv();
    delete process.env.UPSTASH_REDIS_REST_URL;

    const req = new Request("https://staging.speugmsc.org/api/internal/staging-connectivity", {
      headers: { "x-staging-connectivity-token": TEST_CONNECTIVITY_TOKEN },
    });
    const res = await route.GET(req);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.deepEqual(json, { supabase: "ok", upstash: "error" });
  });

  await t.test("returns upstash: error when UPSTASH_REDIS_REST_TOKEN is missing", async () => {
    setValidEnv();
    delete process.env.UPSTASH_REDIS_REST_TOKEN;

    const req = new Request("https://staging.speugmsc.org/api/internal/staging-connectivity", {
      headers: { "x-staging-connectivity-token": TEST_CONNECTIVITY_TOKEN },
    });
    const res = await route.GET(req);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.deepEqual(json, { supabase: "ok", upstash: "error" });
  });

  await t.test("returns upstash: error when Redis ping throws exception", async () => {
    setValidEnv();
    mockUpstashBehavior.error = new Error("Redis connection refused");

    const req = new Request("https://staging.speugmsc.org/api/internal/staging-connectivity", {
      headers: { "x-staging-connectivity-token": TEST_CONNECTIVITY_TOKEN },
    });
    const res = await route.GET(req);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.deepEqual(json, { supabase: "ok", upstash: "error" });
  });

  await t.test("returns upstash: error when Redis ping returns non-PONG string", async () => {
    setValidEnv();
    mockUpstashBehavior.pingResult = "ERROR";

    const req = new Request("https://staging.speugmsc.org/api/internal/staging-connectivity", {
      headers: { "x-staging-connectivity-token": TEST_CONNECTIVITY_TOKEN },
    });
    const res = await route.GET(req);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.deepEqual(json, { supabase: "ok", upstash: "error" });
  });
});

test("Staging Connectivity: Information Isolation & Recruitment Invariance", async (t) => {
  cleanEnv();

  await t.test("strictly leaks no credentials, tokens, URLs, or internal error traces", async () => {
    setValidEnv();
    mockSupabaseBehavior.error = new Error("Database password wrong: super_secret_db_password_123");
    mockUpstashBehavior.error = new Error("Redis token invalid: super_secret_redis_token_456");

    const req = new Request("https://staging.speugmsc.org/api/internal/staging-connectivity", {
      headers: { "x-staging-connectivity-token": TEST_CONNECTIVITY_TOKEN },
    });
    const res = await route.GET(req);
    const text = await res.text();

    assert.ok(!text.includes(TEST_PROJECT_ID), "Response must not contain project ID");
    assert.ok(!text.includes(TEST_CONNECTIVITY_TOKEN), "Response must not contain connectivity token");
    assert.ok(!text.includes(TEST_SECRET_KEY), "Response must not contain Supabase secret key");
    assert.ok(!text.includes(TEST_REDIS_TOKEN), "Response must not contain Redis token");
    assert.ok(!text.includes("super_secret"), "Response must not contain error message strings");
    assert.ok(!text.includes("supabase.co"), "Response must not contain Supabase domain");

    const parsed = JSON.parse(text);
    const keys = Object.keys(parsed).sort();
    assert.deepEqual(keys, ["supabase", "upstash"]);
    assert.deepEqual(parsed, { supabase: "error", upstash: "error" });
  });

  await t.test("operates safely while recruitment remains completely disabled", async () => {
    setValidEnv();
    delete process.env.RECRUITMENT_ENABLED;
    delete process.env.RECRUITMENT_STAGING_ENABLED;

    const req = new Request("https://staging.speugmsc.org/api/internal/staging-connectivity", {
      headers: { "x-staging-connectivity-token": TEST_CONNECTIVITY_TOKEN },
    });
    const res = await route.GET(req);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.deepEqual(json, { supabase: "ok", upstash: "ok" });
  });
});
