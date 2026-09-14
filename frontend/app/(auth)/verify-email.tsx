import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "../../src/api";
import { colors, spacing } from "../../src/theme";

export default function VerifyEmail() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(typeof params.email === "string" ? params.email : "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [err, setErr] = useState("");

  const submit = async () => {
    setErr("");
    setMessage("");
    setBusy(true);
    try {
      await api<{ verified: boolean }>("/auth/verify-email", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), code: code.trim() }),
      });
      setMessage("EMAIL VERIFIED. YOU CAN NOW SIGN IN.");
      setTimeout(() => router.replace("/(auth)/sign-in"), 700);
    } catch (e: any) {
      setErr(e?.message ?? "Verification failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView contentContainerStyle={[styles.form, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>VERIFY{"\n"}EMAIL</Text>
        <Text style={styles.subtitle}>CHECK YOUR INBOX</Text>
        <Text style={styles.copy}>We sent a 6-digit verification code to your email. The code expires in 15 minutes.</Text>

        <Text style={styles.label}>EMAIL</Text>
        <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" style={styles.input} placeholder="you@example.com" placeholderTextColor={colors.muted} />

        <Text style={styles.label}>6-DIGIT CODE</Text>
        <TextInput value={code} onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" maxLength={6} style={[styles.input, styles.code]} placeholder="000000" placeholderTextColor={colors.muted} />

        {!!err && <Text style={styles.err}>{err.toUpperCase()}</Text>}
        {!!message && <Text style={styles.success}>{message}</Text>}

        <Pressable onPress={submit} disabled={busy || !email.trim() || code.length !== 6} style={[styles.cta, (busy || !email.trim() || code.length !== 6) && styles.disabled]}>
          <Text style={styles.ctaText}>{busy ? "VERIFYING..." : "VERIFY EMAIL"}</Text>
        </Pressable>

        <Pressable onPress={() => router.replace("/(auth)/sign-in")} style={styles.secondary}>
          <Text style={styles.secondaryText}>← BACK TO SIGN IN</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  form: { padding: spacing.lg, gap: spacing.md },
  title: { color: colors.onSurface, fontSize: 48, fontWeight: "900", letterSpacing: 2, lineHeight: 50 },
  subtitle: { color: colors.brand, fontSize: 12, fontWeight: "800", letterSpacing: 3, marginBottom: spacing.lg },
  copy: { color: colors.muted, fontSize: 16, lineHeight: 24, marginBottom: spacing.md },
  label: { color: colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 2, marginTop: spacing.sm },
  input: { backgroundColor: colors.surfaceSecondary, borderWidth: 2, borderColor: colors.border, color: colors.onSurface, paddingVertical: 14, paddingHorizontal: spacing.md, fontSize: 16 },
  code: { letterSpacing: 8, fontSize: 24, fontWeight: "800", textAlign: "center" },
  err: { color: colors.error, fontSize: 12, fontWeight: "800", letterSpacing: 1.5 },
  success: { color: colors.brand, fontSize: 12, fontWeight: "900", letterSpacing: 1.5 },
  cta: { backgroundColor: colors.brand, paddingVertical: 18, alignItems: "center", marginTop: spacing.lg, borderWidth: 2, borderColor: colors.brand },
  disabled: { opacity: 0.5 },
  ctaText: { color: colors.onBrand, fontSize: 16, fontWeight: "900", letterSpacing: 2 },
  secondary: { paddingVertical: spacing.md, alignItems: "center", borderWidth: 2, borderColor: colors.borderStrong, marginTop: spacing.sm },
  secondaryText: { color: colors.onSurface, fontSize: 13, fontWeight: "800", letterSpacing: 2 },
});
