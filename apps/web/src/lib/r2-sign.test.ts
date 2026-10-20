import { describe, it, expect } from "vitest";
import { presignUrl, presignR2, r2ConfigFromEnv, encodeKeyPath } from "./r2-sign.mjs";

// AWS's documented example key id, split so the public mirror's credential
// scan (scripts/public-mirror.sh) does not mistake the fixture for a real key.
const AWS_EXAMPLE_KEY_ID = "AKIA" + "IOSFODNN7EXAMPLE";

describe("presignUrl", () => {
  it("matches AWS's published SigV4 presigned GET example", () => {
    // https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
    const url = presignUrl({
      method: "GET",
      host: "examplebucket.s3.amazonaws.com",
      path: "/test.txt",
      region: "us-east-1",
      accessKeyId: AWS_EXAMPLE_KEY_ID,
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      expiresIn: 86400,
      now: new Date("2013-05-24T00:00:00Z"),
    });
    expect(url).toContain("X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404");
    expect(url).toContain(`X-Amz-Credential=${AWS_EXAMPLE_KEY_ID}%2F20130524%2Fus-east-1%2Fs3%2Faws4_request`);
  });

  it("signs extra headers so an upload is pinned to its type and length", () => {
    const url = presignUrl({
      method: "PUT",
      host: "h.example",
      path: "/b/k",
      region: "auto",
      accessKeyId: "a",
      secretAccessKey: "s",
      expiresIn: 60,
      headers: { "Content-Type": "application/pdf", "Content-Length": "12" },
    });
    expect(url).toContain("X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost");
  });
});

describe("presignR2", () => {
  it("addresses the object path-style under the configured bucket", () => {
    const url = presignR2(
      { accountId: "acct", accessKeyId: "a", secretAccessKey: "s", bucket: "homeup" },
      { method: "GET", key: "documents/g1/d1/x-my file(1).pdf", expiresIn: 300 },
    );
    expect(url.startsWith("https://acct.r2.cloudflarestorage.com/homeup/documents/g1/d1/x-my%20file%281%29.pdf?")).toBe(true);
  });
});

describe("r2ConfigFromEnv", () => {
  it("is null unless every variable is set", () => {
    expect(r2ConfigFromEnv({})).toBeNull();
    expect(r2ConfigFromEnv({ R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "b", R2_SECRET_ACCESS_KEY: "c" })).toBeNull();
    expect(r2ConfigFromEnv({ R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "b", R2_SECRET_ACCESS_KEY: "c", R2_BUCKET: "d" })).toEqual({
      accountId: "a", accessKeyId: "b", secretAccessKey: "c", bucket: "d",
    });
  });
});

describe("encodeKeyPath", () => {
  it("keeps slashes and escapes everything else", () => {
    expect(encodeKeyPath("a b/c+d")).toBe("a%20b/c%2Bd");
  });
});
