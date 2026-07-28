const { createRunOncePlugin } = require("expo/config-plugins");
const {
  withAndroidKakaoLogin,
} = require("@react-native-seoul/kakao-login/plugins/android/withAndroidKakaoLogin");
const {
  withIosKakaoLogin,
} = require("@react-native-seoul/kakao-login/plugins/ios/withIosKakaoLogin");
const kakaoPackage = require("@react-native-seoul/kakao-login/package.json");

function withPlatformKakaoLogin(config, props) {
  const { iosAppKey, androidAppKey, kotlinVersion } = props;

  config = withIosKakaoLogin(config, {
    kakaoAppKey: iosAppKey,
  });
  return withAndroidKakaoLogin(config, {
    kakaoAppKey: androidAppKey,
    kotlinVersion,
  });
}

module.exports = createRunOncePlugin(
  withPlatformKakaoLogin,
  `${kakaoPackage.name}-platform-keys`,
  kakaoPackage.version,
);
