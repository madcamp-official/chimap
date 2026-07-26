import { colors, radii, spacing } from "@chimap/design-tokens";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useMobileConfig } from "../features/api/mobile-config";
import { apiBaseUrl } from "../features/api/runtime-config";
import { useMobileSession } from "../features/auth/mobile-session";
import { AuthenticatedDataBoundary } from "../features/routes/authenticated-data-boundary";
import { PlannerScreen } from "../features/routes/planner-screen";
import { AppleLoginButton } from "../platform/apple/apple-login-button";
import { requestKakaoAccessToken } from "../platform/kakao/kakao-login";

export default function HomeScreen() {
  const mobileConfig = useMobileConfig();
  const {
    state,
    completeAppleLogin,
    completeKakaoLogin,
    deleteAccount,
    logout,
  } = useMobileSession();
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (state.status === "booting") {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator accessibilityLabel="세션 복원 중" />
      </SafeAreaView>
    );
  }

  const kakaoLogin = async () => {
    setWorking(true);
    setMessage(null);
    try {
      await completeKakaoLogin(await requestKakaoAccessToken());
    } catch {
      setMessage("카카오 로그인을 완료하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setWorking(false);
    }
  };

  const accountPanel =
    state.status === "authenticated" ? (
      <View style={styles.accountCard}>
        <View style={styles.accountCopy}>
          <Text style={styles.accountTitle}>
            {state.pair.user.displayName ?? "사용자"}님
          </Text>
          <Text style={styles.accountBody}>
            {state.pair.user.provider === "APPLE" ? "Apple" : "카카오"} 계정으로 로그인했습니다.
          </Text>
        </View>
        <View style={styles.actionRow}>
          <Pressable accessibilityRole="button" onPress={() => void logout()} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>로그아웃</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              Alert.alert(
                "계정을 삭제할까요?",
                "서버 계정, 로그인 세션과 이 기기의 저장된 경로가 영구 삭제됩니다.",
                [
                  { text: "취소", style: "cancel" },
                  {
                    text: "계정 삭제",
                    style: "destructive",
                    onPress: () => {
                      setWorking(true);
                      setMessage(null);
                      void deleteAccount()
                        .catch(() => setMessage("계정을 삭제하지 못했습니다. 다시 시도해 주세요."))
                        .finally(() => setWorking(false));
                    },
                  },
                ],
              )
            }
            style={styles.secondaryButton}
          >
            <Text style={styles.deleteText}>계정 삭제</Text>
          </Pressable>
        </View>
        {working ? <ActivityIndicator accessibilityLabel="계정 처리 중" /> : null}
        {message === null ? null : <Text style={styles.error}>{message}</Text>}
      </View>
    ) : (
      <View style={styles.accountCard}>
        <View style={styles.accountCopy}>
          <Text style={styles.accountTitle}>게스트로 이용 중</Text>
          <Text style={styles.accountBody}>
            로그인 없이 추천을 사용할 수 있습니다. 로그인하면 계정 기반 기능을 확장할 수 있습니다.
          </Text>
        </View>
        {state.message === null ? null : <Text style={styles.error}>{state.message}</Text>}
        {message === null ? null : <Text style={styles.error}>{message}</Text>}
        {working ? (
          <ActivityIndicator accessibilityLabel="로그인 중" />
        ) : (
          <View style={styles.loginActions}>
            {mobileConfig?.authentication.appleEnabled === true ? (
              <AppleLoginButton
                disabled={working}
                onCredential={(payload) => {
                  setWorking(true);
                  setMessage(null);
                  void completeAppleLogin(payload)
                    .catch(() => setMessage("Apple 로그인을 완료하지 못했습니다."))
                    .finally(() => setWorking(false));
                }}
                onError={() => setMessage("Apple 로그인을 완료하지 못했습니다.")}
              />
            ) : null}
            {mobileConfig?.authentication.kakaoEnabled === true ? (
              <Pressable accessibilityRole="button" onPress={() => void kakaoLogin()} style={styles.kakaoButton}>
                <Text style={styles.kakaoText}>카카오로 로그인</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </View>
    );

  const ownerId = state.status === "authenticated" ? state.pair.user.id : "guest-local";
  const token = state.status === "authenticated" ? state.pair.accessToken : "";
  return (
    <AuthenticatedDataBoundary ownerId={ownerId}>
      <PlannerScreen
        accessToken={token}
        accountPanel={accountPanel}
        apiBaseUrl={apiBaseUrl()}
      />
    </AuthenticatedDataBoundary>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  accountCard: {
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
  },
  accountCopy: { gap: spacing.xs },
  accountTitle: { color: colors.text, fontSize: 16, fontWeight: "800" },
  accountBody: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  actionRow: { flexDirection: "row", gap: spacing.sm },
  loginActions: { gap: spacing.sm },
  secondaryButton: {
    flex: 1,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
  },
  secondaryText: { color: colors.text, fontWeight: "700" },
  deleteText: { color: colors.danger, fontWeight: "700" },
  kakaoButton: {
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.sm,
    backgroundColor: "#FEE500",
  },
  kakaoText: { color: "#191919", fontWeight: "800" },
  error: { color: colors.danger, fontSize: 13, lineHeight: 19 },
});
