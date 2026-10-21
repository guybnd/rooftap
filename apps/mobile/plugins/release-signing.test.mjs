import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { applyReleaseSigning } = require('./release-signing.js');

// The signing part of the Expo SDK 57 prebuild template's app/build.gradle.
const TEMPLATE = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            signingConfig signingConfigs.debug
            minifyEnabled enableMinifyInReleaseBuilds
        }
    }
}
`;

describe('applyReleaseSigning', () => {
  const out = applyReleaseSigning(TEMPLATE);

  it('adds a release signing config read from Gradle properties', () => {
    expect(out).toContain("storeFile file(findProperty('ROOFTAP_UPLOAD_STORE_FILE'))");
    expect(out).toContain("keyAlias findProperty('ROOFTAP_UPLOAD_KEY_ALIAS')");
    expect(out).not.toMatch(/storePassword '(?!android)/);
  });

  it('signs the release build type with it, and leaves debug alone', () => {
    const buildTypes = out.slice(out.indexOf('buildTypes'));
    const debugType = buildTypes.slice(0, buildTypes.indexOf('release {'));
    const releaseType = buildTypes.slice(buildTypes.indexOf('release {'));
    expect(debugType).toContain('signingConfig signingConfigs.debug');
    expect(releaseType).toContain(
      "signingConfig findProperty('ROOFTAP_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug",
    );
    expect(releaseType).not.toContain('signingConfig signingConfigs.debug\n');
  });

  it('is idempotent', () => {
    expect(applyReleaseSigning(out)).toBe(out);
  });

  it('fails loudly when the template changes shape', () => {
    expect(() => applyReleaseSigning('android {}')).toThrow(/signingConfigs/);
  });
});
