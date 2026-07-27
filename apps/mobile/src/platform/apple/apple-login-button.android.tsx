export function AppleLoginButton(_props: {
  disabled: boolean;
  onCredential(payload: {
    identityToken: string;
    authorizationCode: string;
    nonce: string;
    displayName: string | null;
  }): void;
  onError(): void;
}) {
  return null;
}
