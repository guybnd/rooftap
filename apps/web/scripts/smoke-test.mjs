import { spawn, execSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";

const PORT = 3434;

// Kill any stale process on our port
try {
  if (process.platform === "win32") {
    const out = execSync(`netstat -ano | findstr ":${PORT}" | findstr LISTENING`, { encoding: "utf8" });
    const pid = out.trim().split(/\s+/).pop();
    if (pid) execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
  } else {
    execSync(`lsof -ti:${PORT} | xargs kill -9`, { stdio: "ignore" });
  }
} catch {
  // nothing on that port — fine
}
const BASE = `http://localhost:${PORT}`;
const ROUTES = [
  { path: "/login", expect: 200 },
  { path: "/dashboard", expect: 308, expectLocation: "/homesearch" }, // permanent redirect (next.config.ts)
  { path: "/api/auth/bypass", expect: 405 }, // GET not allowed, but route exists
  { path: "/api/setup/first-user", expect: 405 }, // GET not allowed, but route exists
  { path: "/map", expect: 307 },
  // Section routes are auth-protected (redirect to /login when unauthenticated)
  { path: "/setup", expect: 307 },
  { path: "/costs", expect: 307 },
  { path: "/tasks", expect: 307 },
  { path: "/warranties", expect: 307 },
  // AI endpoints are auth-protected: middleware redirects an unauthenticated
  // request to /login (307) before it reaches the route's own 401 guard (FLUX-89).
  { path: "/api/parse-receipt", method: "POST", body: {}, expect: 307 },
];

let server;
let exitCode = 0;

function log(msg) {
  console.log(`[smoke] ${msg}`);
}

function fail(msg) {
  console.error(`[smoke] FAIL: ${msg}`);
  exitCode = 1;
}

async function startServer() {
  return new Promise((resolve, reject) => {
    // --turbopack panics on a junction-style node_modules (EH agent worktrees), so
    // allow falling back to the webpack dev server via SMOKE_NO_TURBOPACK=1.
    const args = ["next", "dev", "--port", String(PORT)];
    if (!process.env.SMOKE_NO_TURBOPACK) args.splice(2, 0, "--turbopack");
    server = spawn("npx", args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
      env: { ...process.env, NODE_ENV: "development" },
    });

    let output = "";
    const onData = (chunk) => {
      output += chunk.toString();
      if (output.includes("Ready in")) {
        resolve();
      }
    };

    server.stdout.on("data", onData);
    server.stderr.on("data", onData);

    server.on("error", reject);

    setTimeout(30000).then(() => reject(new Error(`Server didn't start in 30s.\nOutput: ${output}`)));
  });
}

async function checkRoute({ path, expect, expectLocation, method = "GET", body }) {
  try {
    const init = { redirect: "manual", method };
    if (body !== undefined) {
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(body);
    }
    const res = await fetch(BASE + path, init);
    if (res.status !== expect) {
      fail(`${method} ${path} → ${res.status} (expected ${expect})`);
      return;
    }
    if (expectLocation) {
      const location = res.headers.get("location");
      if (!location || !location.includes(expectLocation)) {
        fail(`${method} ${path} → Location ${location} (expected to include ${expectLocation})`);
        return;
      }
    }
    log(`✓ ${method} ${path} → ${res.status}`);
  } catch (e) {
    fail(`${method} ${path} → ${e.message}`);
  }
}

try {
  log("Starting dev server...");
  await startServer();
  log(`Server ready on port ${PORT}`);

  for (const route of ROUTES) {
    await checkRoute(route);
  }
} catch (e) {
  fail(e.message);
} finally {
  if (server) {
    server.kill("SIGTERM");
    await setTimeout(1000);
    if (!server.killed) server.kill("SIGKILL");
  }
}

if (exitCode === 0) {
  log("All routes OK ✓");
} else {
  log("Some checks failed — see above");
}

process.exit(exitCode);
