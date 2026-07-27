const { withEntitlementsPlist } = require("expo/config-plugins");

const appleSignInEntitlement = "com.apple.developer.applesignin";

module.exports = function withPersonalTeamAppleSignIn(config) {
  return withEntitlementsPlist(config, (nextConfig) => {
    delete nextConfig.modResults[appleSignInEntitlement];
    return nextConfig;
  });
};
