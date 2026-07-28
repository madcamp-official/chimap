/// <reference types="expo/types" />

declare namespace NodeJS {
  interface ProcessEnv {
    APP_ENV?: "development" | "staging" | "production";
    EXPO_PUBLIC_API_BASE_URL?: string;
    IOS_APPLE_SIGN_IN_CAPABILITY_ENABLED?: "true" | "false";
    KAKAO_NATIVE_IOS_APP_KEY?: string;
    KAKAO_NATIVE_ANDROID_APP_KEY?: string;
    NAVER_MAP_CLIENT_ID_IOS?: string;
    NAVER_MAP_CLIENT_ID_ANDROID?: string;
    VITE_NAVER_MAP_NCP_KEY_ID?: string;
  }
}
