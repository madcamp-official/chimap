import { login } from "@react-native-seoul/kakao-login";

export async function requestKakaoAccessToken(): Promise<string> {
  return (await login()).accessToken;
}
