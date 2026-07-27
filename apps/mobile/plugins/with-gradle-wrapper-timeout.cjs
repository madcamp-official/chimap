const { withDangerousMod } = require("expo/config-plugins");
const { readFile, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

const NETWORK_TIMEOUT_MS = 60_000;

function withGradleWrapperTimeout(config) {
  return withDangerousMod(config, [
    "android",
    async (androidConfig) => {
      const propertiesPath = join(
        androidConfig.modRequest.platformProjectRoot,
        "gradle",
        "wrapper",
        "gradle-wrapper.properties",
      );
      const properties = await readFile(propertiesPath, "utf8");
      const timeout = `networkTimeout=${NETWORK_TIMEOUT_MS}`;
      const updated = /^networkTimeout=.*$/mu.test(properties)
        ? properties.replace(/^networkTimeout=.*$/mu, timeout)
        : `${properties.trimEnd()}\n${timeout}\n`;
      await writeFile(propertiesPath, updated, "utf8");
      return androidConfig;
    },
  ]);
}

module.exports = withGradleWrapperTimeout;
