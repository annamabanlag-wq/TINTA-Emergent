import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Alert, ActivityIndicator, Switch } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import Icon from "@react-native-vector-icons/feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../../../src/session";
import { colors, spacing } from "../../../src/theme";
import AdminHeader from "../../../src/AdminHeader";
import { adminApi, AdminArtist } from "../../../src/adminApi";

const STYLE_OPTIONS = ["Blackwork", "Fineline", "Traditional", "Realism", "Japanese", "Neo-Traditional", "Geometric"];

export default function EditArtistScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useSession();

  const [artist, setArtist] = useState<AdminArtist | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [blockInput, setBlockInput] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const list = await adminApi.listArtists(token);
      const a = list.find((x) => x.id === id) || null;
      setArtist(a);
    } finally {
      setLoading(false);
    }
  }, [token, id]);

  useEffect(() => { load(); }, [load]);

  const upd = (k: keyof AdminArtist) => (v: any) => setArtist((s) => (s ? { ...s, [k]: v } : s));

  const toggleStyle = (s: string) => {
    if (!artist) return;
    const has = artist.styles.includes(s);
    setArtist({ ...artist, styles: has ? artist.styles.filter((x) => x !== s) : [...artist.styles, s] });
  };

  const addBlock = () => {
    if (!artist) return;
    const d = blockInput.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      Alert.alert("Format", "Use YYYY-MM-DD");
      return;
    }
    const cur = artist.blocked_dates || [];
    if (cur.includes(d)) return;
    setArtist({ ...artist, blocked_dates: [...cur, d].sort() });
    setBlockInput("");
  };
  const rmBlock = (d: string) => {
    if (!artist) return;
    setArtist({ ...artist, blocked_dates: (artist.blocked_dates || []).filter((x) => x !== d) });
  };

  const save = async () => {
    if (!artist) return;
    setSaving(true);
    try {
      const payload: any = {
        name: artist.name,
        handle: artist.handle,
        city: artist.city,
        studio: artist.studio,
        address: artist.address,
        styles: artist.styles,
        bio: artist.bio,
        bio_tl: artist.bio_tl,
        rate_per_hour: typeof artist.rate_per_hour === "string" ? parseInt(artist.rate_per_hour) : artist.rate_per_hour,
        avatar: artist.avatar,
        hero: artist.hero,
        portfolio: artist.portfolio,
        home_service_available: artist.home_service_available,
        home_service_fee: typeof artist.home_service_fee === "string" ? parseInt(artist.home_service_fee) : artist.home_service_fee,
        active: artist.active !== false,
        blocked_dates: artist.blocked_dates || [],
      };
      await adminApi.updateArtist(artist.id, payload, token!);
      router.back();
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !artist) {
    return (
      <View style={styles.root}>
        <AdminHeader title="EDIT ARTIST" />
        <View style={{ padding: spacing.xl, alignItems: "center" }}>
          <ActivityIndicator color={colors.brand} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <AdminHeader title="EDIT ARTIST" testID="admin-edit-artist-title" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 120 }}>
        <Field label="NAME" value={artist.name} onChangeText={upd("name")} testID="e-name" />
        <Field label="HANDLE" value={artist.handle} onChangeText={upd("handle")} testID="e-handle" />
        <Field label="CITY" value={artist.city} onChangeText={upd("city")} testID="e-city" />
        <Field label="STUDIO" value={artist.studio} onChangeText={upd("studio")} testID="e-studio" />
        <Field label="ADDRESS" value={artist.address ?? ""} onChangeText={upd("address")} testID="e-address" />

        <Text style={styles.label}>STYLES</Text>
        <View style={styles.chipRow}>
          {STYLE_OPTIONS.map((s) => {
            const on = artist.styles.includes(s);
            return (
              <Pressable key={s} onPress={() => toggleStyle(s)} style={[styles.chip, on && styles.chipOn]} testID={`estyle-${s}`}>
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{s}</Text>
              </Pressable>
            );
          })}
        </View>

        <Field label="BIO (ENGLISH)" value={artist.bio} onChangeText={upd("bio")} multiline testID="e-bio" />
        <Field label="BIO (TAGALOG)" value={artist.bio_tl ?? ""} onChangeText={upd("bio_tl")} multiline testID="e-bio-tl" />
        <Field label="RATE PER HOUR (₱)" value={String(artist.rate_per_hour)} onChangeText={(v) => upd("rate_per_hour")(v as any)} keyboardType="numeric" testID="e-rate" />
        <Field label="AVATAR URL" value={artist.avatar} onChangeText={upd("avatar")} testID="e-avatar" />
        <Field label="HERO URL" value={artist.hero} onChangeText={upd("hero")} testID="e-hero" />

        <View style={styles.switchRow}>
          <Text style={styles.label}>HOME SERVICE</Text>
          <Switch
            testID="e-home-service"
            value={!!artist.home_service_available}
            onValueChange={upd("home_service_available")}
            trackColor={{ true: colors.brand, false: colors.border }}
            thumbColor={colors.onSurface}
          />
        </View>
        {artist.home_service_available && (
          <Field label="HOME SERVICE FEE (₱)" value={String(artist.home_service_fee ?? 0)} onChangeText={(v) => upd("home_service_fee")(v as any)} keyboardType="numeric" testID="e-hs-fee" />
        )}

        <View style={styles.switchRow}>
          <Text style={styles.label}>ACTIVE</Text>
          <Switch
            testID="e-active"
            value={artist.active !== false}
            onValueChange={upd("active")}
            trackColor={{ true: colors.success, false: colors.border }}
            thumbColor={colors.onSurface}
          />
        </View>

        <Text style={[styles.label, { marginTop: spacing.lg }]}>BLOCKED DATES (YYYY-MM-DD)</Text>
        <View style={styles.blockRow}>
          <TextInput
            testID="e-block-date"
            placeholder="2026-07-15"
            placeholderTextColor={colors.muted}
            value={blockInput}
            onChangeText={setBlockInput}
            style={[styles.input, { flex: 1 }]}
          />
          <Pressable onPress={addBlock} testID="e-block-add" style={styles.addBtn}>
            <Icon name="plus" size={16} color={colors.onBrand} />
          </Pressable>
        </View>
        {(artist.blocked_dates || []).length ? (
          <View style={styles.chipRow}>
            {(artist.blocked_dates || []).map((d) => (
              <Pressable key={d} onPress={() => rmBlock(d)} style={styles.blockChip} testID={`e-block-${d}`}>
                <Text style={styles.blockChipText}>{d}</Text>
                <Icon name="x" size={12} color={colors.onBrand} />
              </Pressable>
            ))}
          </View>
        ) : (
          <Text style={styles.hint}>No blocked dates</Text>
        )}

        <Pressable testID="save-artist-edit" onPress={save} style={styles.saveBtn} disabled={saving}>
          {saving ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.saveText}>SAVE CHANGES</Text>}
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
  hint: { color: colors.muted, fontSize: 11, marginTop: 4 },
  input: {
    color: colors.onSurface,
    fontSize: 14,
    borderWidth: 2,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: spacing.sm, marginTop: 6 },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 8, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { color: colors.onSurface, fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  chipTextOn: { color: colors.onBrand },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.lg },
  blockRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  addBtn: { width: 44, height: 44, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.borderStrong },
  blockChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.sm, paddingVertical: 6, backgroundColor: colors.brand },
  blockChipText: { color: colors.onBrand, fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  saveBtn: { marginTop: spacing.xl, backgroundColor: colors.brand, paddingVertical: spacing.md, alignItems: "center", borderWidth: 2, borderColor: colors.borderStrong },
  saveText: { color: colors.onBrand, fontSize: 14, fontWeight: "900", letterSpacing: 2 },
});
