// Signs release builds with a private upload key instead of the public
// React Native debug key that the prebuild template uses.
//
// The key never enters the repo. Gradle reads four project properties, from
// ~/.gradle/gradle.properties or from ORG_GRADLE_PROJECT_<name> env vars:
//   ROOFTAP_UPLOAD_STORE_FILE      absolute path to the keystore (.p12/.jks)
//   ROOFTAP_UPLOAD_STORE_PASSWORD
//   ROOFTAP_UPLOAD_KEY_ALIAS
//   ROOFTAP_UPLOAD_KEY_PASSWORD
// Without them a release build falls back to the debug key, so a self-hoster
// can still build an APK. Such an APK cannot update one signed with the
// official key.
//
// Lives in a plugin because prebuild regenerates android/ on every build.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// rooftap-release-signing';

const SIGNING_CONFIG = `
        ${MARKER}
        if (findProperty('ROOFTAP_UPLOAD_STORE_FILE')) {
            release {
                storeFile file(findProperty('ROOFTAP_UPLOAD_STORE_FILE'))
                storePassword findProperty('ROOFTAP_UPLOAD_STORE_PASSWORD')
                keyAlias findProperty('ROOFTAP_UPLOAD_KEY_ALIAS')
                keyPassword findProperty('ROOFTAP_UPLOAD_KEY_PASSWORD')
            }
        }`;

const RELEASE_SIGNING =
  "signingConfig findProperty('ROOFTAP_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug";

/** Pure transform of android/app/build.gradle, exported for tests. */
function applyReleaseSigning(gradle) {
  if (gradle.includes(MARKER)) return gradle;

  const signingConfigs = /signingConfigs\s*\{/;
  if (!signingConfigs.test(gradle)) {
    throw new Error('release-signing: no signingConfigs block in app/build.gradle');
  }
  let out = gradle.replace(signingConfigs, (m) => m + SIGNING_CONFIG);

  // Only the release build type changes. The debug build type keeps the
  // debug key.
  const releaseType = /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/;
  if (!releaseType.test(out)) {
    throw new Error('release-signing: no release build type using signingConfigs.debug');
  }
  out = out.replace(releaseType, (_m, head) => head + RELEASE_SIGNING);
  return out;
}

function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('release-signing: expected a Groovy app/build.gradle');
    }
    cfg.modResults.contents = applyReleaseSigning(cfg.modResults.contents);
    return cfg;
  });
}

module.exports = withReleaseSigning;
module.exports.applyReleaseSigning = applyReleaseSigning;
