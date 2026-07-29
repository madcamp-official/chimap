import {
  estimatePersonalizedStepLengthMeters,
  recommendPersonalizedDailyGoal,
  walkingProfileSchema,
  type BiologicalSex,
  type WalkingProfile,
} from "@chimap/contracts";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  InputAccessoryView,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppIcon } from "../../components/app-icon";
import { BrandLogo } from "../../components/brand-logo";
import { chimapTheme } from "../../theme/chimap-theme";
import {
  androidCardSurface,
  androidRipple,
  androidRippleOnDark,
  platformText,
} from "../../theme/platform-ui";

const numberInputAccessoryId = "chimap-profile-number-inputs";

function numberValue(value: string): number {
  return Number(value.trim());
}

function ProfileNumberField({
  label,
  unit,
  value,
  onChange,
  decimal = false,
}: {
  label: string;
  unit: string;
  value: string;
  onChange(value: string): void;
  decimal?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.numberInputWrap}>
        <TextInput
          accessibilityLabel={label}
          {...(Platform.OS === "ios"
            ? { inputAccessoryViewID: numberInputAccessoryId }
            : {})}
          keyboardType={decimal ? "decimal-pad" : "number-pad"}
          onChangeText={onChange}
          selectTextOnFocus
          style={styles.numberInput}
          value={value}
        />
        <Text style={styles.unit}>{unit}</Text>
      </View>
    </View>
  );
}

export function WalkingProfileScreen({
  initialProfile,
  initialDailyGoalSteps = 8000,
  onSave,
  onCancel,
}: {
  initialProfile?: WalkingProfile;
  initialDailyGoalSteps?: number;
  onSave(profile: WalkingProfile, dailyGoalSteps: number): Promise<void>;
  onCancel?: () => void;
}) {
  const currentYear = new Date().getFullYear();
  const { width, fontScale } = useWindowDimensions();
  const stackFields = width < 390 || fontScale >= 1.3;
  const [age, setAge] = useState(
    String(
      initialProfile === undefined
        ? 25
        : currentYear - initialProfile.birthYear,
    ),
  );
  const [heightCm, setHeightCm] = useState(
    String(initialProfile?.heightCm ?? 170),
  );
  const [weightKg, setWeightKg] = useState(
    String(initialProfile?.weightKg ?? 65),
  );
  const [dailyGoalSteps, setDailyGoalSteps] = useState(
    String(initialDailyGoalSteps),
  );
  const [goalManuallyEdited, setGoalManuallyEdited] = useState(
    initialProfile !== undefined,
  );
  const [biologicalSex, setBiologicalSex] = useState<
    BiologicalSex | undefined
  >(initialProfile?.biologicalSex);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const profile = useMemo(() => {
    const parsedAge = numberValue(age);
    const parsed = walkingProfileSchema.safeParse({
      birthYear: currentYear - parsedAge,
      heightCm: numberValue(heightCm),
      weightKg: numberValue(weightKg),
      biologicalSex,
    });
    return parsed.success && parsedAge >= 18 && parsedAge <= 90
      ? parsed.data
      : null;
  }, [age, biologicalSex, currentYear, heightCm, weightKg]);
  const parsedGoal = numberValue(dailyGoalSteps);
  const goalValid =
    Number.isInteger(parsedGoal) && parsedGoal >= 1 && parsedGoal <= 100_000;
  const stepLength =
    profile === null
      ? null
      : estimatePersonalizedStepLengthMeters(profile, currentYear);
  const goalRecommendation = useMemo(
    () =>
      profile === null
        ? null
        : recommendPersonalizedDailyGoal(profile, currentYear),
    [currentYear, profile],
  );
  const bodyMassIndex =
    profile === null
      ? null
      : profile.weightKg / Math.pow(profile.heightCm / 100, 2);

  useEffect(() => {
    if (goalRecommendation !== null && !goalManuallyEdited) {
      setDailyGoalSteps(String(goalRecommendation.dailyGoalSteps));
    }
  }, [goalManuallyEdited, goalRecommendation]);

  const save = async () => {
    if (profile === null || !goalValid) {
      setMessage("만 18~90세의 신체정보와 하루 목표 걸음을 확인해 주세요.");
      return;
    }
    Keyboard.dismiss();
    setSaving(true);
    setMessage(null);
    try {
      await onSave(profile, parsedGoal);
    } catch {
      setMessage("개인화 설정을 저장하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.brandRow}>
            <View style={styles.brandMark}>
              <BrandLogo size={42} />
            </View>
            <View>
              <Text style={styles.brand}>CHIMap</Text>
              <Text style={styles.brandTagline}>가는 길을 더 건강하게</Text>
            </View>
          </View>

          <View style={styles.heading}>
            <Text style={styles.eyebrow}>개인화 걸음 설정</Text>
            <Text style={styles.title}>처음 한 번만 설정해 주세요</Text>
            <Text style={styles.description}>
              한 걸음 길이와 하루 목표를 저장해 다음부터는 바로 길을 찾습니다.
              언제든 상단의 내 정보에서 수정할 수 있어요.
            </Text>
          </View>

          <View style={styles.card}>
            <View style={[styles.fieldRow, stackFields && styles.fieldColumn]}>
              <ProfileNumberField
                label="만 나이"
                onChange={setAge}
                unit="세"
                value={age}
              />
              <ProfileNumberField
                decimal
                label="신장"
                onChange={setHeightCm}
                unit="cm"
                value={heightCm}
              />
            </View>
            <View style={[styles.fieldRow, stackFields && styles.fieldColumn]}>
              <ProfileNumberField
                decimal
                label="체중"
                onChange={setWeightKg}
                unit="kg"
                value={weightKg}
              />
              <ProfileNumberField
                label="하루 목표"
                onChange={(value) => {
                  setGoalManuallyEdited(true);
                  setDailyGoalSteps(value);
                }}
                unit="걸음"
                value={dailyGoalSteps}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>생물학적 성별</Text>
              <View style={styles.sexRow}>
                {(["MALE", "FEMALE"] as const).map((sex) => {
                  const selected = biologicalSex === sex;
                  return (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      android_ripple={androidRipple}
                      key={sex}
                      onPress={() => setBiologicalSex(sex)}
                      style={[
                        styles.sexButton,
                        selected && styles.sexButtonSelected,
                      ]}
                    >
                      <Text
                        style={[
                          styles.sexText,
                          selected && styles.sexTextSelected,
                        ]}
                      >
                        {sex === "MALE" ? "남성" : "여성"}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {goalRecommendation === null ? null : (
              <View
                accessibilityLiveRegion="polite"
                style={styles.goalRecommendation}
              >
                <View style={styles.goalRecommendationHeading}>
                  <Text style={styles.goalRecommendationLabel}>
                    논문 근거 기반 첫 목표
                  </Text>
                  <Text style={styles.goalRecommendationValue}>
                    {goalRecommendation.dailyGoalSteps.toLocaleString()}걸음
                  </Text>
                </View>
                <Text style={styles.goalRecommendationBody}>
                  만 {goalRecommendation.age}세 연구 범위는 {" "}
                  {goalRecommendation.evidenceRange.minSteps.toLocaleString()}~
                  {goalRecommendation.evidenceRange.maxSteps.toLocaleString()}
                  걸음이며, 현재 신체정보로 환산하면 약 {" "}
                  {(goalRecommendation.estimatedDistanceMeters / 1_000).toFixed(1)}
                  km입니다.
                </Text>
                <Text style={styles.goalRecommendationNote}>
                  나이는 걸음 목표 범위를 정하고 신장·체중·성별은 예상 보폭과
                  거리 환산에만 사용합니다.
                </Text>
                {parsedGoal === goalRecommendation.dailyGoalSteps ? (
                  <Text style={styles.goalRecommendationApplied}>
                    추천값 적용 중
                  </Text>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    android_ripple={androidRipple}
                    onPress={() => {
                      setGoalManuallyEdited(true);
                      setDailyGoalSteps(
                        String(goalRecommendation.dailyGoalSteps),
                      );
                    }}
                    style={styles.goalRecommendationButton}
                  >
                    <Text style={styles.goalRecommendationButtonText}>
                      추천값 적용
                    </Text>
                  </Pressable>
                )}
              </View>
            )}

            <View style={styles.estimate}>
              <Text style={styles.estimateLabel}>연구 기반 예상 한 걸음 길이</Text>
              <Text style={styles.estimateValue}>
                {stepLength === null
                  ? "입력값 확인 필요"
                  : `${(stepLength * 100).toFixed(1)}cm`}
              </Text>
              <Text style={styles.estimateNote}>
                실제 보폭은 걷는 속도와 지형에 따라 달라질 수 있습니다.
              </Text>
            </View>

            {bodyMassIndex !== null && bodyMassIndex >= 30 ? (
              <Text accessibilityRole="alert" style={styles.scopeWarning}>
                적용 연구는 BMI 30 미만의 건강한 성인을 대상으로 했으므로 현재
                추정값의 오차가 더 클 수 있습니다.
              </Text>
            ) : null}

            <View style={styles.privacyRow}>
              <AppIcon color={chimapTheme.teal} name="shield" size={16} />
              <Text style={styles.privacy}>
                신체정보는 이 기기에만 저장되며 서버에는 계산된 한 걸음 길이와
                현재·목표 걸음만 전송됩니다.
              </Text>
            </View>
          </View>

          {message === null ? null : (
            <Text accessibilityRole="alert" style={styles.error}>
              {message}
            </Text>
          )}
          <Pressable
            accessibilityRole="button"
            android_ripple={androidRippleOnDark}
            disabled={saving}
            onPress={() => void save()}
            style={[styles.primaryButton, saving && styles.disabled]}
          >
            {saving ? (
              <ActivityIndicator color={chimapTheme.white} />
            ) : (
              <Text style={styles.primaryButtonText}>이 값으로 시작</Text>
            )}
          </Pressable>
          {onCancel === undefined ? null : (
            <Pressable
              accessibilityRole="button"
              android_ripple={androidRipple}
              onPress={onCancel}
              style={styles.cancelButton}
            >
              <Text style={styles.cancelText}>취소</Text>
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      {Platform.OS === "ios" ? (
        <InputAccessoryView nativeID={numberInputAccessoryId}>
          <View style={styles.inputAccessory}>
            <Pressable accessibilityRole="button" onPress={Keyboard.dismiss}>
              <Text style={styles.inputAccessoryDone}>완료</Text>
            </Pressable>
          </View>
        </InputAccessoryView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: chimapTheme.canvas },
  content: { width: "100%", maxWidth: 560, alignSelf: "center", gap: 20, padding: 20, paddingBottom: 36 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandMark: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 13,
    overflow: "hidden",
  },
  brand: { ...platformText, color: chimapTheme.navyStrong, fontSize: 22, fontWeight: "900" },
  brandTagline: { ...platformText, color: chimapTheme.muted, fontSize: 12 },
  heading: { gap: 7, marginTop: 8 },
  eyebrow: {
    ...platformText,
    color: chimapTheme.teal,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  title: { ...platformText, color: chimapTheme.ink, fontSize: 28, fontWeight: "900", lineHeight: 35 },
  description: { ...platformText, color: chimapTheme.muted, fontSize: 15, lineHeight: 23 },
  card: {
    ...androidCardSurface,
    gap: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: chimapTheme.line,
    borderRadius: 22,
    backgroundColor: chimapTheme.paper,
  },
  fieldRow: { flexDirection: "row", gap: 12 },
  fieldColumn: { flexDirection: "column" },
  field: { flex: 1, gap: 7 },
  fieldLabel: { ...platformText, color: chimapTheme.muted, fontSize: 12, fontWeight: "800" },
  numberInputWrap: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: chimapTheme.line,
    borderRadius: 12,
    backgroundColor: chimapTheme.white,
  },
  numberInput: {
    ...platformText,
    minWidth: 0,
    flex: 1,
    paddingHorizontal: 12,
    color: chimapTheme.ink,
    fontSize: 16,
    fontWeight: "800",
  },
  unit: { ...platformText, paddingRight: 12, color: chimapTheme.muted, fontSize: 11, fontWeight: "700" },
  sexRow: { flexDirection: "row", gap: 8 },
  sexButton: {
    overflow: "hidden",
    minHeight: 48,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: chimapTheme.line,
    borderRadius: 12,
    backgroundColor: chimapTheme.white,
  },
  sexButtonSelected: { borderColor: chimapTheme.teal, backgroundColor: chimapTheme.teal },
  sexText: { ...platformText, color: chimapTheme.ink, fontWeight: "800" },
  sexTextSelected: { color: chimapTheme.white },
  estimate: {
    gap: 5,
    padding: 16,
    borderRadius: 16,
    backgroundColor: chimapTheme.personalizationSurface,
  },
  goalRecommendation: {
    gap: 7,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(99, 183, 70, 0.34)",
    borderRadius: 16,
    backgroundColor: "#F2F8E9",
  },
  goalRecommendationHeading: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 10,
  },
  goalRecommendationLabel: {
    ...platformText,
    flex: 1,
    color: "#58705D",
    fontSize: 12,
    fontWeight: "800",
  },
  goalRecommendationValue: {
    ...platformText,
    color: "#377B2E",
    fontSize: 20,
    fontWeight: "900",
  },
  goalRecommendationBody: {
    ...platformText,
    color: "#405A4A",
    fontSize: 12,
    lineHeight: 18,
  },
  goalRecommendationNote: {
    ...platformText,
    color: "#58705D",
    fontSize: 11,
    lineHeight: 17,
  },
  goalRecommendationApplied: {
    ...platformText,
    color: "#377B2E",
    fontSize: 11,
    fontWeight: "800",
  },
  goalRecommendationButton: {
    minHeight: 48,
    overflow: "hidden",
    alignSelf: "flex-start",
    justifyContent: "center",
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "rgba(55, 123, 46, 0.35)",
    borderRadius: 11,
    backgroundColor: chimapTheme.white,
  },
  goalRecommendationButtonText: {
    ...platformText,
    color: "#2F6D28",
    fontSize: 12,
    fontWeight: "800",
  },
  estimateLabel: { ...platformText, color: chimapTheme.teal, fontSize: 12, fontWeight: "800" },
  estimateValue: { ...platformText, color: chimapTheme.navyStrong, fontSize: 26, fontWeight: "900" },
  estimateNote: { ...platformText, color: chimapTheme.muted, fontSize: 11, lineHeight: 16 },
  scopeWarning: { ...platformText, padding: 12, borderRadius: 12, color: chimapTheme.estimatedText, backgroundColor: chimapTheme.estimatedSurface, fontSize: 11, lineHeight: 17 },
  privacyRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  privacy: { ...platformText, minWidth: 0, flex: 1, color: chimapTheme.muted, fontSize: 11, lineHeight: 17 },
  error: { ...platformText, color: chimapTheme.danger, fontSize: 13, lineHeight: 19 },
  primaryButton: {
    overflow: "hidden",
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: chimapTheme.navy,
  },
  disabled: { opacity: 0.55 },
  primaryButtonText: { ...platformText, color: chimapTheme.white, fontSize: 16, fontWeight: "900" },
  cancelButton: { minHeight: 48, overflow: "hidden", alignItems: "center", justifyContent: "center", borderRadius: 14 },
  cancelText: { ...platformText, color: chimapTheme.muted, fontWeight: "800" },
  inputAccessory: {
    minHeight: 48,
    alignItems: "flex-end",
    justifyContent: "center",
    paddingHorizontal: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: chimapTheme.line,
    backgroundColor: chimapTheme.keyboardSurface,
  },
  inputAccessoryDone: { ...platformText, color: chimapTheme.teal, fontSize: 16, fontWeight: "800" },
});
