import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { Stack, useRouter } from "expo-router";
import Icon from "@react-native-vector-icons/feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing } from "../src/theme";

const RULES: { icon: any; title: string; body: string; tone: "good" | "warn" | "bad" }[] = [
  {
    icon: "check-circle",
    tone: "good",
    title: "MORE THAN 48H BEFORE",
    body: "Full refund of your ₱2,900 deposit, back to your original payment method within 5–10 business days. Cancel anytime from the Bookings tab.",
  },
  {
    icon: "clock",
    tone: "warn",
    title: "24–48H BEFORE",
    body: "Deposit is retained by the artist to cover reserved chair time. You can reschedule with the same artist at no extra cost by messaging them directly.",
  },
  {
    icon: "x-circle",
    tone: "bad",
    title: "LESS THAN 24H OR NO-SHOW",
    body: "Deposit is forfeited and a re-book will require a new deposit. Please respect the artist's time — they've likely turned away other clients for your slot.",
  },
];

export default function CancellationPolicy() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View style={styles.root} testID="cancellation-policy-screen">
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="policy-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Icon name="arrow-left" size={20} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>DEPOSIT — ₱2,900</Text>
          <Text style={styles.title}>CANCELLATION{"\n"}POLICY</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl, gap: spacing.md }}>
        <View style={styles.intro}>
          <Icon name="shield" size={16} color={colors.brand} />
          <Text style={styles.introText}>
            We hold a ₱2,900 deposit to secure the artist{"'"}s time. The rules below apply from the moment your booking is confirmed.
          </Text>
        </View>

        {RULES.map((r) => (
          <View key={r.title} style={[styles.rule, r.tone === "good" && styles.ruleGood, r.tone === "warn" && styles.ruleWarn, r.tone === "bad" && styles.ruleBad]}>
            <View style={styles.ruleHead}>
              <Icon name={r.icon} size={18} color={r.tone === "good" ? colors.success : r.tone === "warn" ? colors.warning : colors.error} />
              <Text style={styles.ruleTitle}>{r.title}</Text>
            </View>
            <Text style={styles.ruleBody}>{r.body}</Text>
          </View>
        ))}

        <View style={styles.footNote}>
          <Text style={styles.footNoteTitle}>HOW TO CANCEL</Text>
          <Text style={styles.footNoteText}>
            Open the <Text style={styles.footBold}>BOOKINGS</Text> tab, find your session in the Upcoming list, and tap <Text style={styles.footBold}>CANCEL</Text>. Refunds are issued automatically when eligible; you{"'"}ll see the status change to REFUNDED on the card once Stripe confirms.
          </Text>
        </View>

        <Text style={styles.legal}>
          Deposits are non-transferable between artists. Force majeure (illness, emergencies) — reach out via Messages, and the artist can override the policy at their discretion.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, paddingBottom: spacing.md, borderBottomWidth: 2, borderBottomColor: colors.borderStrong },
  iconBtn: { width: 40, height: 40, borderWidth: 2, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  eyebrow: { color: colors.brand, fontSize: 11, fontWeight: "900", letterSpacing: 2 },
  title: { color: colors.onSurface, fontSize: 28, fontWeight: "900", letterSpacing: 1, lineHeight: 30, marginTop: 2 },
  intro: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderWidth: 2, borderColor: colors.borderStrong },
  introText: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 20 },
  rule: { borderWidth: 2, padding: spacing.md, gap: spacing.sm },
  ruleGood: { borderColor: colors.success },
  ruleWarn: { borderColor: colors.warning },
  ruleBad: { borderColor: colors.error },
  ruleHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  ruleTitle: { color: colors.onSurface, fontSize: 13, fontWeight: "900", letterSpacing: 2 },
  ruleBody: { color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 20 },
  footNote: { padding: spacing.md, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, gap: spacing.sm, marginTop: spacing.md },
  footNoteTitle: { color: colors.brand, fontSize: 12, fontWeight: "900", letterSpacing: 3 },
  footNoteText: { color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 20 },
  footBold: { fontWeight: "900", color: colors.onSurface },
  legal: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: spacing.sm },
});
