import {
  estimatePersonalizedStepLengthMeters,
  walkingProfileSchema,
  type BiologicalSex,
  type WalkingProfile,
} from "@chimap/contracts";
import { useMemo, useState } from "react";
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
import { SafeAreaView } from "react-native-safe-area-context";

import { chimapTheme } from "../../theme/chimap-theme";

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
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.brandRow}>
            <View style={styles.brandMark}>
              <Text style={styles.brandMarkText}>↗</Text>
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
                onChange={setDailyGoalSteps}
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

            <Text style={styles.privacy}>
              🔒 신체정보는 이 기기에만 저장되며 서버에는 계산된 한 걸음 길이와
              걸음 수만 전송됩니다.
            </Text>
          </View>

          {message === null ? null : (
            <Text accessibilityRole="alert" style={styles.error}>
              {message}
            </Text>
          )}
          <Pressable
            accessibilityRole="button"
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
  content: { gap: 20, padding: 20, paddingBottom: 36 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandMark: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 13,
    backgroundColor: chimapTheme.orange,
  },
  brandMarkText: { color: chimapTheme.navyStrong, fontSize: 25, fontWeight: "900" },
  brand: { color: chimapTheme.navyStrong, fontSize: 22, fontWeight: "900" },
  brandTagline: { color: chimapTheme.muted, fontSize: 12 },
  heading: { gap: 7, marginTop: 8 },
  eyebrow: {
    color: chimapTheme.teal,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  title: { color: chimapTheme.ink, fontSize: 28, fontWeight: "900", lineHeight: 35 },
  description: { color: chimapTheme.muted, fontSize: 15, lineHeight: 23 },
  card: {
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
  fieldLabel: { color: chimapTheme.muted, fontSize: 12, fontWeight: "800" },
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
    minWidth: 0,
    flex: 1,
    paddingHorizontal: 12,
    color: chimapTheme.ink,
    fontSize: 16,
    fontWeight: "800",
  },
  unit: { paddingRight: 12, color: chimapTheme.muted, fontSize: 11, fontWeight: "700" },
  sexRow: { flexDirection: "row", gap: 8 },
  sexButton: {
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
  sexText: { color: chimapTheme.ink, fontWeight: "800" },
  sexTextSelected: { color: chimapTheme.white },
  estimate: {
    gap: 5,
    padding: 16,
    borderRadius: 16,
    backgroundColor: "#EAF4EF",
  },
  estimateLabel: { color: chimapTheme.teal, fontSize: 12, fontWeight: "800" },
  estimateValue: { color: chimapTheme.navyStrong, fontSize: 26, fontWeight: "900" },
  estimateNote: { color: chimapTheme.muted, fontSize: 11, lineHeight: 16 },
  privacy: { color: chimapTheme.muted, fontSize: 11, lineHeight: 17 },
  error: { color: chimapTheme.danger, fontSize: 13, lineHeight: 19 },
  primaryButton: {
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: chimapTheme.navy,
  },
  disabled: { opacity: 0.55 },
  primaryButtonText: { color: chimapTheme.white, fontSize: 16, fontWeight: "900" },
  cancelButton: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  cancelText: { color: chimapTheme.muted, fontWeight: "800" },
  inputAccessory: {
    minHeight: 44,
    alignItems: "flex-end",
    justifyContent: "center",
    paddingHorizontal: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: chimapTheme.line,
    backgroundColor: "#F1F2F3",
  },
  inputAccessoryDone: { color: chimapTheme.teal, fontSize: 16, fontWeight: "800" },
});
