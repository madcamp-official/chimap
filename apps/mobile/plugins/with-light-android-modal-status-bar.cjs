const { AndroidConfig, withAndroidStyles } = require("expo/config-plugins");

const dialogThemeName = "Theme.FullScreenDialog";
const dialogThemeItems = {
  "android:windowNoTitle": "true",
  "android:windowIsFloating": "false",
  "android:windowBackground": "@android:color/transparent",
  "android:windowDrawsSystemBarBackgrounds": "true",
  "android:statusBarColor": "@android:color/transparent",
  "android:windowLightStatusBar": "true",
};

function withLightAndroidModalStatusBar(config) {
  return withAndroidStyles(config, (stylesConfig) => {
    const styles = AndroidConfig.Resources.ensureDefaultResourceXML(
      stylesConfig.modResults,
    );
    styles.resources.style ??= [];

    let dialogTheme = AndroidConfig.Resources.findResourceGroup(
      styles.resources.style,
      { name: dialogThemeName },
    );
    if (dialogTheme === null) {
      dialogTheme = {
        $: { name: dialogThemeName },
        item: [],
      };
      styles.resources.style.push(dialogTheme);
    }

    for (const [name, value] of Object.entries(dialogThemeItems)) {
      const nextItem = AndroidConfig.Resources.buildResourceItem({ name, value });
      const currentItem = dialogTheme.item.find((item) => item.$.name === name);
      if (currentItem === undefined) {
        dialogTheme.item.push(nextItem);
      } else {
        currentItem._ = nextItem._;
        currentItem.$ = nextItem.$;
      }
    }

    stylesConfig.modResults = styles;
    return stylesConfig;
  });
}

module.exports = withLightAndroidModalStatusBar;
