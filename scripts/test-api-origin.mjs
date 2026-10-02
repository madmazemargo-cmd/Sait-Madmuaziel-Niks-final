import assert from "node:assert/strict";
import test from "node:test";
import { apiEndpoint } from "../artifacts/api-server/src/config.ts";

function withApiOrigin(value, run) {
  const previous = process.env.API_ORIGIN;
  if (value === undefined) delete process.env.API_ORIGIN;
  else process.env.API_ORIGIN = value;

  try {
    run();
  } finally {
    if (previous === undefined) delete process.env.API_ORIGIN;
    else process.env.API_ORIGIN = previous;
  }
}

test("builds API endpoints from the configured HTTPS origin", () => {
  withApiOrigin("https://api.example.test", () => {
    assert.equal(
      apiEndpoint("/calendar"),
      "https://api.example.test/api/calendar",
    );
  });
});

test("allows localhost HTTP and rejects insecure remote origins", () => {
  withApiOrigin("http://localhost:8787", () => {
    assert.equal(apiEndpoint("calendar"), "http://localhost:8787/api/calendar");
  });
  withApiOrigin("http://api.example.test", () => {
    assert.throws(() => apiEndpoint("calendar"), /must be HTTPS/);
  });
});

test("rejects API_ORIGIN values containing paths or credentials", () => {
  for (const value of [
    "https://api.example.test/api",
    "https://user:password@api.example.test",
    "https://api.example.test?debug=1",
  ]) {
    withApiOrigin(value, () => {
      assert.throws(() => apiEndpoint("calendar"), /only an origin/);
    });
  }
});

test("requires an explicit origin in production", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";

  try {
    withApiOrigin(undefined, () => {
      assert.throws(() => apiEndpoint("calendar"), /configured in production/);
    });
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});
