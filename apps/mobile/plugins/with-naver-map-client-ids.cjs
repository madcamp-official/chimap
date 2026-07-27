const {
  AndroidConfig,
  withAndroidManifest,
  withInfoPlist,
} = require("expo/config-plugins");

const ANDROID_CLIENT_ID_KEY = "com.naver.maps.map.NCP_KEY_ID";

function withNaverMapClientIds(config, props) {
  const { iosClientId, androidClientId } = props;
  config = withInfoPlist(config, (iosConfig) => {
    iosConfig.modResults.NMFNcpKeyId = iosClientId;
    return iosConfig;
  });
  return withAndroidManifest(config, (androidConfig) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(
      androidConfig.modResults,
    );
    application["meta-data"] = application["meta-data"] ?? [];
    application["meta-data"] = application["meta-data"].filter(
      (item) => item.$?.["android:name"] !== ANDROID_CLIENT_ID_KEY,
    );
    application["meta-data"].push({
      $: {
        "android:name": ANDROID_CLIENT_ID_KEY,
        "android:value": androidClientId,
      },
    });
    return androidConfig;
  });
}

module.exports = withNaverMapClientIds;
