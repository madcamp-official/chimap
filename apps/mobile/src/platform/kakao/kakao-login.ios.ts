import {
  login,
  loginWithKakaoAccount,
} from "@react-native-seoul/kakao-login";

import { requestKakaoAccessTokenWithFallback } from "../../features/auth/kakao-native-login-flow";

export async function requestKakaoAccessToken(): Promise<string> {
  return requestKakaoAccessTokenWithFallback({
    preferredLogin: login,
    accountLogin: loginWithKakaoAccount,
  });
}
