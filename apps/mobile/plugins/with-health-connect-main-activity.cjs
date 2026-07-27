const { withMainActivity } = require("expo/config-plugins");

const permissionDelegateImport =
  "import dev.matinzd.healthconnect.permissions.HealthConnectPermissionDelegate";
const permissionDelegateSetup =
  "    HealthConnectPermissionDelegate.setPermissionDelegate(this)";

function withHealthConnectMainActivity(config) {
  return withMainActivity(config, (activityConfig) => {
    if (activityConfig.modResults.language !== "kt") {
      throw new Error("Health Connect MainActivity plugin requires Kotlin.");
    }
    let source = activityConfig.modResults.contents;
    if (!source.includes(permissionDelegateImport)) {
      source = source.replace(
        "import com.facebook.react.ReactActivity",
        `${permissionDelegateImport}\n\nimport com.facebook.react.ReactActivity`,
      );
    }
    if (!source.includes(permissionDelegateSetup.trim())) {
      const superCall = /^(\s*)super\.onCreate\((?:null|savedInstanceState)\)$/mu;
      if (!superCall.test(source)) {
        throw new Error("MainActivity onCreate super call was not found.");
      }
      source = source.replace(
        superCall,
        (match, indentation) => `${match}\n${indentation}HealthConnectPermissionDelegate.setPermissionDelegate(this)`,
      );
    }
    activityConfig.modResults.contents = source;
    return activityConfig;
  });
}

module.exports = withHealthConnectMainActivity;
