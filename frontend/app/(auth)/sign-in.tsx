import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { Link, useLocalSearchParams, useRouter } from "expo-router";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../../src/session";
import { colors, spacing, IMAGES } from "../../src/theme";

function isArtistHost() {
  if (typeof window !== "undefined") {
    return window.location.hostname.toLowerCase().includes("tinta-artist");
  }
  return false;
}

export default function SignIn() {
  const router = useRouter();
  const params = useLocalSearchParams<{ next?: string }>();
  const isArtist = params.next === "artist" || isArtistHost();
  const isAdmin = params.next === "admin";
  const insets = useSafeAreaInsets();
  const { signIn } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    setErr("");
    setBusy(true);
    try {
      await signIn(email.trim(), password);
      if (isAdmin) router.replace("/admin/payments");
      else router.replace(isArtist ? "/artist/apply" : "/(tabs)");
    } catch (e: any) {
      setErr(e?.message ?? "Sign in failed");
    } finally {
      setBusy(false);
    }
  };

  const signupHref = isArtist ? "/(auth)/sign-up?role=artist" : "/(auth)/sign-up";

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={styles.hero}>
        <Image source={IMAGES.moody} style={StyleSheet.absoluteFill} contentFit="cover" />
        <LinearGradient colors={["transparent", colors.surface]} style={StyleSheet.absoluteFill} />
        <View style={[styles.heroContent, { paddingTop: insets.top + spacing.xl }]}>
          <Text style={styles.brandMark}>{isAdmin ? "TINTA ADMIN" : isArtist ? "TINTA ARTIST" : "TINTA"}</Text>
          <Text style={styles.tagline}>{isAdmin ? "OWNER CONTROL CENTER" : isArtist ? "ARTIST STUDIO PORTAL" : "BOOK YOUR NEXT PIECE"}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.form, { paddingBottom: insets.bottom + spacing.xl }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{isAdmin ? "ADMIN SIGN IN" : isArtist ? "ARTIST SIGN IN" : "SIGN IN"}</Text>
        {(isArtist || isAdmin) && <Text style={styles.artistHint}>{isAdmin ? "Owner access only. Your account must have admin permissions." : "Sign in to continue setting up your TINTA artist profile."}</Text>}
        <Text style={styles.label}>EMAIL</Text>
        <TextInput testID="signin-email-input" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="you@ink.com" placeholderTextColor={colors.muted} style={styles.input} />
        <Text style={styles.label}>PASSWORD</Text>
        <TextInput testID="signin-password-input" value={password} onChangeText={setPassword} secureTextEntry placeholder="••••••••" placeholderTextColor={colors.muted} style={styles.input} />
        {!!err && <Text style={styles.err} testID="signin-error">{err.toUpperCase()}</Text>}
        <Pressable testID="signin-submit-button" onPress={submit} disabled={busy || !email || !password} style={({ pressed }) => [styles.cta, (busy || !email || !password) && styles.ctaDisabled, pressed && styles.ctaPressed]}>
          <Text style={styles.ctaText}>{busy ? "SIGNING IN..." : isAdmin ? "SIGN IN AS OWNER" : isArtist ? "SIGN IN AS ARTIST" : "SIGN IN"}</Text>
        </Pressable>
        {!isAdmin && <>
          <View style={styles.divider} />
          <Link href={signupHref} asChild>
            <Pressable testID="go-to-signup-button" style={styles.secondaryBtn}><Text style={styles.secondaryText}>CREATE AN ACCOUNT →</Text></Pressable>
          </Link>
          {!isArtist && <Link href="/artist/apply" asChild>
            <Pressable style={styles.artistBtn}><Text style={styles.artistText}>ARE YOU AN ARTIST? APPLY HERE →</Text></Pressable>
          </Link>}
        </>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  hero: { height: 280, backgroundColor: colors.surfaceSecondary, borderBottomWidth: 2, borderBottomColor: colors.borderStrong },
  heroContent: { flex: 1, justifyContent: "flex-end", padding: spacing.lg },
  brandMark: { color: colors.onSurface, fontSize: 52, fontWeight: "900", letterSpacing: 4 },
  tagline: { color: colors.brand, fontSize: 12, fontWeight: "800", letterSpacing: 3, marginTop: spacing.xs },
  form: { padding: spacing.lg, gap: spacing.md },
  title: { color: colors.onSurface, fontSize: 32, fontWeight: "900", letterSpacing: 2, marginBottom: spacing.md },
  artistHint: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  label: { color: colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 2, marginTop: spacing.sm },
  input: { backgroundColor: colors.surfaceSecondary, borderWidth: 2, borderColor: colors.border, color: colors.onSurface, paddingVertical: 14, paddingHorizontal: spacing.md, fontSize: 16 },
  err: { color: colors.error, fontSize: 12, fontWeight: "800", letterSpacing: 1.5, marginTop: spacing.xs },
  cta: { backgroundColor: colors.brand, paddingVertical: 18, alignItems: "center", marginTop: spacing.lg, borderWidth: 2, borderColor: colors.brand },
  ctaDisabled: { opacity: 0.5 },
  ctaPressed: { backgroundColor: colors.brandSecondary },
  ctaText: { color: colors.onBrand, fontSize: 16, fontWeight: "900", letterSpacing: 3 },
  divider: { height: 2, backgroundColor: colors.divider, marginVertical: spacing.lg },
  secondaryBtn: { paddingVertical: spacing.md, alignItems: "center", borderWidth: 2, borderColor: colors.borderStrong },
  secondaryText: { color: colors.onSurface, fontSize: 13, fontWeight: "800", letterSpacing: 2 },
  artistBtn: { paddingVertical: spacing.md, alignItems: "center" },
  artistText: { color: colors.brand, fontSize: 12, fontWeight: "900", letterSpacing: 1.5, textAlign: "center" },
});
