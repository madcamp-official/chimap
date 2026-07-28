import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";

type AppleLoginPayload = {
  identityToken: string;
  authorizationCode: string;
  nonce: string;
  displayName: string | null;
};

export function AppleLoginButton({
  disabled,
  onCredential,
  onError,
}: {
  disabled: boolean;
  onCredential(payload: AppleLoginPayload): void;
  onError(): void;
}) {
  return (
    <AppleAuthentication.AppleAuthenticationButton
      buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
      buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
      cornerRadius={8}
      style={{ height: 48, width: "100%", opacity: disabled ? 0.5 : 1 }}
      onPress={() => {
        if (disabled) {
          return;
        }
        void (async () => {
          const nonce = `${Crypto.randomUUID()}${Crypto.randomUUID()}`;
          const credential = await AppleAuthentication.signInAsync({
            nonce,
            requestedScopes: [
              AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
            ],
          });
          if (
            credential.identityToken === null ||
            credential.authorizationCode === null
          ) {
            throw new Error("Apple credential에 필수 token이 없습니다.");
          }
          const displayName = [
            credential.fullName?.familyName,
            credential.fullName?.givenName,
          ]
            .filter((part): part is string => typeof part === "string")
            .join("")
            .trim();
          onCredential({
            identityToken: credential.identityToken,
            authorizationCode: credential.authorizationCode,
            nonce,
            displayName: displayName.length === 0 ? null : displayName,
          });
        })().catch(() => onError());
      }}
    />
  );
}
