import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { Link, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "../../src/api";
import { colors, spacing } from "../../src/theme";

export default function SignUp() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [verification, setVerification] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [verified, setVerified] = useState(false);

  const submit = async () => {
    setErr("");
    setBusy(true);
    try {
      await api<any>("/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, password, name }),
      });
      setVerification(true);
    } catch (e: any) {
      setErr(e?.message ?? "Sign up failed");
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setErr("");
    setBusy(true);
    try {
      await api<any>("/auth/verify-email", {
        method: "POST",
        body: JSON.stringify({ email, code }),
      });
      setVerified(true);
    } catch (e: any) {
      setErr(e?.message ?? "Verification failed");
    } finally {
      setBusy(false);
    }
  };

  if (verified) {
    return (
      <View style={[styles.root, styles.success, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <Text style={styles.title}>EMAIL{"\n"}VERIFIED</Text>
        <Text style={styles.subtitle}>WELCOME TO TINTA</Text>
        <Text style={styles.successText}>Your email is verified. Sign in to continue as a customer or apply to become an artist.</Text>
        <Pressable style={styles.cta} onPress={() => router.replace("/(auth)/sign-in")}>
          <Text style={styles.ctaText}>SIGN IN TO TINTA</Text>
        </Pressable>
      </View>
    );
  }

  if (verification) {
    return (
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView contentContainerStyle={[styles.form, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>VERIFY{"\n"}EMAIL</Text>
          <Text style={styles.subtitle}>CHECK YOUR INBOX</Text>
          <Text style={styles.successText}>We sent a 6-digit verification code to {email}. Enter it below. The code expires in 15 minutes.</Text>
          <Text style={styles.label}>VERIFICATION CODE</Text>
          <TextInput testID="verification-code-input" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" placeholder="123456" placeholderTextColor={colors.muted} style={styles.input} maxLength={6} />
          {!!err && <Text style={styles.err} testID="signup-error">{err.toUpperCase()}</Text>}
          <Pressable testID="verify-email-button" onPress={verify} disabled={busy || code.length !== 6} style={({ pressed }) => [styles.cta, (busy || code.length !== 6) && styles.ctaDisabled, pressed && styles.ctaPressed]}>
            <Text style={styles.ctaText}>{busy ? "VERIFYING..." : "VERIFY EMAIL"}</Text>
          </Pressable>
          <Pressable style={styles.secondaryBtn} onPress={() => { setVerification(false); setCode(""); setErr(""); }}>
            <Text style={styles.secondaryText}>← BACK</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  const disabled = busy || !email || password.length < 6 || !name;

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView contentContainerStyle={[styles.form, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>CREATE{"\n"}ACCOUNT</Text>
        <Text style={styles.subtitle}>JOIN THE STUDIO</Text>
        <Text style={styles.label}>NAME</Text>
        <TextInput testID="signup-name-input" value={name} onChangeText={setName} placeholder="Your name" placeholderTextColor={colors.muted} style={styles.input} />
        <Text style={styles.label}>EMAIL</Text>
        <TextInput testID="signup-email-input" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="you@ink.com" placeholderTextColor={colors.muted} style={styles.input} />
        <Text style={styles.label}>PASSWORD (MIN 6)</Text>
        <TextInput testID="signup-password-input" value={password} onChangeText={setPassword} secureTextEntry placeholder="••••••••" placeholderTextColor={colors.muted} style={styles.input} />
        {!!err && <Text style={styles.err} testID="signup-error">{err.toUpperCase()}</Text>}
        <Pressable testID="signup-submit-button" onPress={submit} disabled={disabled} style={({ pressed }) => [styles.cta, disabled && styles.ctaDisabled, pressed && styles.ctaPressed]}>
          <Text style={styles.ctaText}>{busy ? "CREATING..." : "CREATE ACCOUNT"}</Text>
        </Pressable>
        <Link href="/artist/apply" asChild>
          <Pressable style={styles.artistBtn}><Text style={styles.artistText}>ARE YOU AN ARTIST? APPLY HERE →</Text></Pressable>
        </Link>
        <View style={styles.divider} />
        <Link href="/(auth)/sign-in" asChild>
          <Pressable testID="go-to-signin-button" style={styles.secondaryBtn}><Text style={styles.secondaryText}>← BACK TO SIGN IN</Text></Pressable>
        </Link>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  form: { padding: spacing.lg, gap: spacing.md },
  success: { alignItems: "stretch", justifyContent: "center", paddingHorizontal: spacing.lg, gap: spacing.md },
  title: { color: colors.onSurface, fontSize: 48, fontWeight: "900", letterSpacing: 2, lineHeight: 50 },
  subtitle: { color: colors.brand, fontSize: 12, fontWeight: "800", letterSpacing: 3, marginBottom: spacing.lg },
  successText: { color: colors.muted, fontSize: 16, lineHeight: 24, marginBottom: spacing.md },
  label: { color: colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 2, marginTop: spacing.sm },
  input: { backgroundColor: colors.surfaceSecondary, borderWidth: 2, borderColor: colors.border, color: colors.onSurface, paddingVertical: 14, paddingHorizontal: spacing.md, fontSize: 16 },
  err: { color: colors.error, fontSize: 12, fontWeight: "800", letterSpacing: 1.5, marginTop: spacing.xs },
  cta: { backgroundColor: colors.brand, paddingVertical: 18, alignItems: "center", marginTop: spacing.lg, borderWidth: 2, borderColor: colors.brand },
  ctaDisabled: { opacity: 0.5 },
  ctaPressed: { backgroundColor: colors.brandSecondary },
  ctaText: { color: colors.onBrand, fontSize: 16, fontWeight: "900", letterSpacing: 2 },
  artistBtn: { paddingVertical: 16, alignItems: "center", borderWidth: 2, borderColor: colors.brand, marginTop: spacing.sm },
  artistText: { color: colors.brand, fontSize: 13, fontWeight: "900", letterSpacing: 1.5 },
  divider: { height: 2, backgroundColor: colors.divider, marginVertical: spacing.lg },
  secondaryBtn: { paddingVertical: spacing.md, alignItems: "center", borderWidth: 2, borderColor: colors.borderStrong },
  secondaryText: { color: colors.onSurface, fontSize: 13, fontWeight: "800", letterSpacing: 2 },
});
