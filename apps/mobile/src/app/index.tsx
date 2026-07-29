import { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppIcon } from "../components/app-icon";
import { useMobileConfig } from "../features/api/mobile-config";
import {
  apiBaseUrl,
  runtimeAppEnvironment,
  runtimeApplicationId,
} from "../features/api/runtime-config";
import {
  kakaoLoginErrorCode,
  kakaoLoginErrorMessage,
} from "../features/auth/kakao-login-error";
import { MobileApiError } from "../features/auth/mobile-api-error";
import { useMobileSession } from "../features/auth/mobile-session";
import { WalkingProfileScreen } from "../features/profile/walking-profile-screen";
import { useWalkingProfile } from "../features/profile/walking-profile";
import { AuthenticatedDataBoundary } from "../features/routes/authenticated-data-boundary";
import { PlannerScreen } from "../features/routes/planner-screen";
import { requestKakaoAccessToken } from "../platform/kakao/kakao-login";
import { chimapTheme } from "../theme/chimap-theme";
import {
  androidRippleOnKakao,
  platformText,
} from "../theme/platform-ui";

function FullScreenLoader({ label }: { label: string }) {
  return (
    <SafeAreaView style={styles.center}>
      <ActivityIndicator color={chimapTheme.teal} />
      <Text style={styles.loadingText}>{label}</Text>
    </SafeAreaView>
  );
}

function KakaoLoginScreen({ message }: { message: string | null }) {
  const { height, fontScale } = useWindowDimensions();
  const mobileConfig = useMobileConfig();
  const { completeKakaoLogin, prepareKakaoLogin } = useMobileSession();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kakaoDisabled = mobileConfig?.authentication.kakaoEnabled === false;
  const compactHero = height < 720 || fontScale >= 1.3;

  const login = async () => {
    setWorking(true);
    setError(null);
    prepareKakaoLogin();

    let accessToken: string;
    const platform = Platform.OS === "android" ? "android" : "ios";
    const errorContext = {
      platform,
      environment: runtimeAppEnvironment(),
      applicationId: runtimeApplicationId(platform),
    } as const;
    try {
      accessToken = await requestKakaoAccessToken();
    } catch (caught) {
      console.error(`[CHIMap Kakao] code=${kakaoLoginErrorCode(caught)}`);
      setError(kakaoLoginErrorMessage(caught, errorContext));
      setWorking(false);
      return;
    }

    try {
      await completeKakaoLogin(accessToken);
    } catch (caught) {
      if (caught instanceof MobileApiError) {
        console.error(
          `[CHIMap auth] code=${caught.code} requestId=${caught.requestId ?? "unknown"}`,
        );
        setError(kakaoLoginErrorMessage(caught, errorContext));
      } else {
        console.error(
          "[CHIMap auth] code=SESSION_COMPLETION_FAILED requestId=unknown",
        );
        setError(
          "카카오 인증은 완료했지만 앱 세션을 저장하지 못했습니다. 앱을 다시 열어 시도해 주세요.",
        );
      }
    } finally {
      setWorking(false);
    }
  };

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.loginSafeArea}>
      <StatusBar style="dark" />
      <ScrollView
        bounces={false}
        contentContainerStyle={styles.loginContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.loginHero, compactHero && styles.loginHeroCompact]}>
          <View style={styles.orbitLarge} />
          <View style={styles.orbitSmall} />
          <View style={styles.loginBrandMark}>
            <AppIcon color={chimapTheme.navyStrong} name="arrowUpRight" size={34} />
          </View>
          <Text style={styles.loginBrand}>CHIMap</Text>
          <Text style={styles.loginTagline}>가는 길을 더 건강하게</Text>
        </View>

        <View style={styles.loginSheet}>
          <Text style={styles.loginEyebrow}>지금 출발 기준 건강 경로</Text>
          <Text style={styles.loginTitle}>카카오로 시작하세요</Text>
          <Text style={styles.loginDescription}>
            로그인하면 개인 보폭과 오늘의 걸음을 안전하게 구분해 나에게 맞는
            경로를 추천합니다.
          </Text>
          {message === null ? null : <Text style={styles.loginError}>{message}</Text>}
          {error === null ? null : <Text style={styles.loginError}>{error}</Text>}
          {kakaoDisabled ? (
            <Text style={styles.loginError}>
              현재 카카오 로그인을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            android_ripple={androidRippleOnKakao}
            disabled={working || kakaoDisabled}
            onPress={() => void login()}
            style={[
              styles.kakaoButton,
              (working || kakaoDisabled) && styles.disabled,
            ]}
          >
            {working ? (
              <ActivityIndicator color="#191919" />
            ) : (
              <Text style={styles.kakaoText}>카카오로 계속하기</Text>
            )}
          </Pressable>
          <Text style={styles.loginFootnote}>
            CHIMap 앱은 카카오 로그인이 필요합니다.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function AuthenticatedExperience({
  displayName,
  accessToken,
}: {
  displayName: string | null;
  accessToken: string;
}) {
  const { logout, deleteAccount } = useMobileSession();
  const profile = useWalkingProfile();
  const [editingProfile, setEditingProfile] = useState(false);

  if (profile.loading) {
    return <FullScreenLoader label="개인화 설정을 불러오는 중" />;
  }
  if (profile.value === null || editingProfile) {
    return (
      <WalkingProfileScreen
        {...(profile.value === null
          ? {}
          : {
              initialProfile: profile.value.walkingProfile,
              initialDailyGoalSteps: profile.value.dailyGoalSteps,
              onCancel: () => setEditingProfile(false),
            })}
        onSave={async (walkingProfile, dailyGoalSteps) => {
          await profile.save(walkingProfile, dailyGoalSteps);
          setEditingProfile(false);
        }}
      />
    );
  }
  return (
    <PlannerScreen
      accessToken={accessToken}
      apiBaseUrl={apiBaseUrl()}
      displayName={displayName ?? "CHIMap 사용자"}
      onDeleteAccount={deleteAccount}
      onEditProfile={() => setEditingProfile(true)}
      onLogout={logout}
      profile={profile.value}
    />
  );
}

export default function HomeScreen() {
  const { state } = useMobileSession();
  if (state.status === "booting") {
    return <FullScreenLoader label="로그인 정보를 확인하는 중" />;
  }
  if (state.status === "guest") {
    return <KakaoLoginScreen message={state.message} />;
  }
  return (
    <AuthenticatedDataBoundary ownerId={state.pair.user.id}>
      <AuthenticatedExperience
        accessToken={state.pair.accessToken}
        displayName={state.pair.user.displayName}
      />
    </AuthenticatedDataBoundary>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: chimapTheme.canvas,
  },
  loadingText: { ...platformText, color: chimapTheme.muted, fontSize: 13, fontWeight: "700" },
  loginSafeArea: { flex: 1, backgroundColor: chimapTheme.orange },
  loginContent: { flexGrow: 1 },
  loginHero: {
    minHeight: 330,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  loginHeroCompact: { minHeight: 245 },
  orbitLarge: {
    position: "absolute",
    top: -100,
    left: -130,
    width: 330,
    height: 330,
    borderWidth: 1,
    borderColor: "rgba(8,45,55,0.18)",
    borderRadius: 165,
  },
  orbitSmall: {
    position: "absolute",
    right: -90,
    bottom: -80,
    width: 240,
    height: 240,
    borderWidth: 1,
    borderColor: "rgba(8,45,55,0.18)",
    borderRadius: 120,
  },
  loginBrandMark: {
    width: 62,
    height: 62,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 17,
    borderWidth: 1,
    borderColor: "rgba(8,45,55,0.28)",
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  loginBrand: { ...platformText, color: chimapTheme.navyStrong, fontSize: 54, fontWeight: "900", letterSpacing: -2 },
  loginTagline: { ...platformText, marginTop: 8, color: chimapTheme.navyStrong, fontSize: 14, fontWeight: "800" },
  loginSheet: {
    gap: 12,
    paddingHorizontal: 24,
    paddingTop: 27,
    paddingBottom: 24,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: chimapTheme.paper,
  },
  loginEyebrow: { ...platformText, color: chimapTheme.teal, fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  loginTitle: { ...platformText, color: chimapTheme.ink, fontSize: 27, fontWeight: "900" },
  loginDescription: { ...platformText, color: chimapTheme.muted, fontSize: 14, lineHeight: 21 },
  loginError: { ...platformText, color: chimapTheme.danger, fontSize: 12, lineHeight: 18 },
  kakaoButton: {
    overflow: "hidden",
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 3,
    borderRadius: 14,
    backgroundColor: "#FEE500",
  },
  kakaoText: { ...platformText, color: "#191919", fontSize: 16, fontWeight: "900" },
  disabled: { opacity: 0.5 },
  loginFootnote: { ...platformText, color: chimapTheme.muted, fontSize: 11, textAlign: "center" },
});
