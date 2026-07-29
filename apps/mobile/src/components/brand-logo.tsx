import { Image, type ImageStyle, type StyleProp } from "react-native";

const brandLogoSource = require("./images/logo.png");

export function BrandLogo({
  size,
  style,
}: {
  size: number;
  style?: StyleProp<ImageStyle>;
}) {
  return (
    <Image
      accessibilityIgnoresInvertColors
      resizeMode="contain"
      source={brandLogoSource}
      style={[{ width: size, height: size, borderRadius: size * 0.16 }, style]}
    />
  );
}
