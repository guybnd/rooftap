import { describe, expect, it, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { scanDir } from "./check-import-boundary.mjs";

// HOUP-67 "Recommended Tests": the import-boundary lint must fail on a
// deliberately-added next/* (or @/*) import — verified here against a
// throwaway fixture dir, never against real packages/core/src files.

let tmpDir: string | undefined;

afterEach(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  tmpDir = undefined;
});

describe("check-import-boundary", () => {
  it("flags a clean fixture with no violations", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-boundary-clean-"));
    fs.writeFileSync(path.join(tmpDir, "ok.ts"), `import type { SupabaseClient } from '@supabase/supabase-js';\nexport const x = 1;\n`);
    expect(scanDir(tmpDir)).toEqual([]);
  });

  it("flags a deliberately-added next/navigation import", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-boundary-next-"));
    fs.writeFileSync(path.join(tmpDir, "bad.ts"), `import { useRouter } from 'next/navigation';\n`);
    const violations = scanDir(tmpDir);
    expect(violations).toHaveLength(1);
    expect(violations[0].name).toBe("next/*");
  });

  it("flags a deliberately-added @/* web-alias import", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-boundary-alias-"));
    fs.writeFileSync(path.join(tmpDir, "bad.ts"), `import { cn } from '@/lib/utils';\n`);
    const violations = scanDir(tmpDir);
    expect(violations).toHaveLength(1);
    expect(violations[0].name).toBe("@/* (apps/web path alias)");
  });

  it("flags react-dom", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-boundary-reactdom-"));
    fs.writeFileSync(path.join(tmpDir, "bad.ts"), `import { createPortal } from 'react-dom';\n`);
    const violations = scanDir(tmpDir);
    expect(violations).toHaveLength(1);
    expect(violations[0].name).toBe("react-dom");
  });
});
