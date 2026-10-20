import { execSync } from "node:child_process";

const port = process.argv[2] || "3000";

try {
  if (process.platform === "win32") {
    const out = execSync(`netstat -ano | findstr ":${port}" | findstr LISTENING`, { encoding: "utf8" });
    const pids = [...new Set(out.trim().split("\n").map(l => l.trim().split(/\s+/).pop()))];
    for (const pid of pids) {
      if (pid && pid !== "0") {
        execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
      }
    }
  } else {
    execSync(`lsof -ti:${port} | xargs kill -9`, { stdio: "ignore" });
  }
} catch {
  // nothing on that port
}
