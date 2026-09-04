import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Alert, ActivityIndicator, Switch } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../../src/session";
import { colors, spacing } from "../../src/theme";
import AdminHeader from "../../src/AdminHeader";
import { adminApi } from "../../src/adminApi";

const STYLE_OPTIONS = ["Blackwork", "Fineline", "Traditional", "Realism", "Japanese", "Neo-Traditional", "Geometric"];

export default function NewArtistScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token } = useSession();

  const [form, setForm] = useState({
    name: "",
    handle: "",
    city: "",
    studio: "",
    address: "",
    bio: "",
    bio_tl: "",
    rate_per_hour: "10000",
    avatar: "",
    hero: "",
    portfolio: "",
    home_service_available: false,
    home_service_fee: "0",
  });
  const [styles_, setStyles_] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const upd = (k: keyof typeof form) => (v: any) => setForm((s) => ({ ...s, [k]: v }));

  const toggleStyle = (s: string) => {
    setStyles_((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  };

  const submit = async () => {
    if (!form.name || !form.handle || !form.city || !form.studio) {
      Alert.alert("Missing fields", "Name, handle, city and studio are required.");
      return;
    }
    if (!styles_.length) {
      Alert.alert("Pick style", "Select at least one style.");
      return;
    }
    setSaving(true);
    try {
      const portfolio = form.portfolio
        .split(/\n|,/)
        .map((s) => s.trim())
        .filter(Boolean);
      await adminApi.createArtist(
        {
          ...form,
          styles: styles_,
          rate_per_hour: parseInt(form.rate_per_hour) || 10000,
          home_service_fee: parseInt(form.home_service_fee) || 0,
          portfolio,
        },
        token!,
      );
      router.back();
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.root}>
      <AdminHeader title="NEW ARTIST" testID="admin-new-artist-title" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 120 }}>
        <Field label="NAME" value={form.name} onChangeText={upd("name")} testID="f-name" />
        <Field label="HANDLE" value={form.handle} onChangeText={upd("handle")} placeholder="@username" testID="f-handle" />
        <Field label="CITY" value={form.city} onChangeText={upd("city")} testID="f-city" />
        <Field label="STUDIO" value={form.studio} onChangeText={upd("studio")} testID="f-studio" />
        <Field label="ADDRESS" value={form.address} onChangeText={upd("address")} testID="f-address" />

        <Text style={styles.label}>STYLES</Text>
        <View style={styles.chipRow}>
          {STYLE_OPTIONS.map((s) => {
            const on = styles_.includes(s);
            return (
              <Pressable key={s} onPress={() => toggleStyle(s)} style={[styles.chip, on && styles.chipOn]} testID={`style-${s}`}>
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{s}</Text>
              </Pressable>
            );
          })}
        </View>

        <Field label="BIO (ENGLISH)" value={form.bio} onChangeText={upd("bio")} multiline testID="f-bio" />
        <Field label="BIO (TAGALOG)" value={form.bio_tl} onChangeText={upd("bio_tl")} multiline testID="f-bio-tl" />
        <Field label="RATE PER HOUR (₱)" value={form.rate_per_hour} onChangeText={upd("rate_per_hour")} keyboardType="numeric" testID="f-rate" />
        <Field label="AVATAR URL" value={form.avatar} onChangeText={upd("avatar")} testID="f-avatar" />
        <Field label="HERO URL" value={form.hero} onChangeText={upd("hero")} testID="f-hero" />
        <Field label="PORTFOLIO URLS (one per line)" value={form.portfolio} onChangeText={upd("portfolio")} multiline testID="f-portfolio" />

        <View style={styles.switchRow}>
          <Text style={styles.label}>HOME SERVICE</Text>
          <Switch
            testID="f-home-service"
            value={form.home_service_available}
            onValueChange={upd("home_service_available")}
            trackColor={{ true: colors.brand, false: colors.border }}
            thumbColor={colors.onSurface}
          />
        </View>
        {form.home_service_available && (
          <Field label="HOME SERVICE FEE (₱)" value={form.home_service_fee} onChangeText={upd("home_service_fee")} keyboardType="numeric" testID="f-hs-fee" />
        )}

        <Pressable testID="save-artist" onPress={submit} style={styles.saveBtn} disabled={saving}>
          {saving ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.saveText}>CREATE ARTIST</Text>}
        </Pressable>
      </ScrollView>
    </View>
  );
}

function Field({ label, testID, multiline, ...rest }: any) {
  return (
    <View style={{ marginTop: spacing.md }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        testID={testID}
        {...rest}
        multiline={multiline}
        placeholderTextColor={colors.muted}
        style={[styles.input, multiline && { minHeight: 80, textAlignVertical: "top" }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  label: { color: colors.brand, fontSize: 10, fontWeight: "900", letterSpacing: 2, marginBottom: 6 },
  input: {
    color: colors.onSurface,
    fontSize: 14,
    borderWidth: 2,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 8, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { color: colors.onSurface, fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  chipTextOn: { color: colors.onBrand },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.lg },
  saveBtn: { marginTop: spacing.xl, backgroundColor: colors.brand, paddingVertical: spacing.md, alignItems: "center", borderWidth: 2, borderColor: colors.borderStrong },
  saveText: { color: colors.onBrand, fontSize: 14, fontWeight: "900", letterSpacing: 2 },
});
