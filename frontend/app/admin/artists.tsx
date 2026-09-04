import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl, ActivityIndicator, Alert, Image } from "react-native";
import { useRouter } from "expo-router";
import Icon from "@react-native-vector-icons/feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../../src/session";
import { useI18n } from "../../src/i18n";
import { colors, spacing } from "../../src/theme";
import AdminHeader from "../../src/AdminHeader";
import { adminApi, AdminArtist } from "../../src/adminApi";
import { fmtPHP } from "../../src/currency";

export default function AdminArtistsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token } = useSession();
  const { t } = useI18n();
  const [rows, setRows] = useState<AdminArtist[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const data = await adminApi.listArtists(token);
      setRows(data);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to load");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const toggleActive = async (a: AdminArtist) => {
    try {
      await adminApi.updateArtist(a.id, { active: !(a.active !== false) }, token!);
      await load();
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed");
    }
  };

  return (
    <View style={styles.root}>
      <AdminHeader
        title={t("admin.artists.title")}
        testID="admin-artists-title"
        right={
          <Pressable testID="admin-artists-add" onPress={() => router.push("/admin/artist-new")} style={styles.addBtn}>
            <Icon name="plus" size={14} color={colors.onBrand} />
            <Text style={styles.addBtnText}>{t("admin.artists.add")}</Text>
          </Pressable>
        }
      />
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(a) => a.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brand} />}
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
          renderItem={({ item }) => (
            <View style={styles.card} testID={`artist-row-${item.id}`}>
              <View style={{ flexDirection: "row", gap: spacing.md, alignItems: "center" }}>
                {item.avatar ? (
                  <Image source={{ uri: item.avatar }} style={styles.avatar} />
                ) : (
                  <View style={styles.avatarFallback}><Text style={styles.avatarText}>{item.name[0]}</Text></View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={1}>{item.name.toUpperCase()}</Text>
                  <Text style={styles.handle} numberOfLines={1}>{item.handle} · {item.city}</Text>
                  <Text style={styles.meta}>{item.bookings_count} bookings · {fmtPHP(item.rate_per_hour)}/hr</Text>
                </View>
                <View style={[styles.statusBadge, item.active === false && styles.statusBadgeInactive]}>
                  <Text style={styles.statusText}>{item.active === false ? t("admin.artists.inactive") : t("admin.artists.active")}</Text>
                </View>
              </View>

              <View style={styles.earnRow}>
                <View style={styles.earnBox}>
                  <Text style={styles.earnLabel}>{t("admin.artists.pending")}</Text>
                  <Text style={[styles.earnValue, { color: colors.warning }]}>{fmtPHP(item.pending_earnings)}</Text>
                </View>
                <View style={styles.earnBox}>
                  <Text style={styles.earnLabel}>{t("admin.artists.paidOut")}</Text>
                  <Text style={[styles.earnValue, { color: colors.success }]}>{fmtPHP(item.paid_out_total)}</Text>
                </View>
              </View>

              <View style={styles.actionRow}>
                <Pressable
                  testID={`edit-artist-${item.id}`}
                  onPress={() => router.push(`/admin/artist-edit/${item.id}`)}
                  style={[styles.actionBtn, { backgroundColor: colors.brand }]}
                >
                  <Icon name="edit-2" size={12} color={colors.onBrand} />
                  <Text style={styles.actionText}>{t("admin.artists.edit")}</Text>
                </Pressable>
                <Pressable
                  testID={`toggle-active-${item.id}`}
                  onPress={() => toggleActive(item)}
                  style={[styles.actionBtn, styles.actionBtnGhost]}
                >
                  <Icon name={item.active === false ? "eye" : "eye-off"} size={12} color={colors.onSurface} />
                  <Text style={[styles.actionText, { color: colors.onSurface }]}>
                    {item.active === false ? t("admin.artists.enable") : t("admin.artists.disable")}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
          ListEmptyComponent={<Text style={styles.empty}>No artists</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { padding: spacing.xl, alignItems: "center" },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.brand, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  addBtnText: { color: colors.onBrand, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  card: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.md,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceSecondary,
    gap: spacing.md,
  },
  avatar: { width: 52, height: 52, borderWidth: 2, borderColor: colors.borderStrong },
  avatarFallback: { width: 52, height: 52, backgroundColor: colors.surfaceTertiary, borderWidth: 2, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.brand, fontSize: 20, fontWeight: "900" },
  name: { color: colors.onSurface, fontSize: 14, fontWeight: "900", letterSpacing: 1 },
  handle: { color: colors.muted, fontSize: 11, marginTop: 2 },
  meta: { color: colors.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  statusBadge: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderWidth: 2, borderColor: colors.success },
  statusBadgeInactive: { borderColor: colors.muted },
  statusText: { color: colors.onSurface, fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  earnRow: { flexDirection: "row", gap: spacing.sm },
  earnBox: { flex: 1, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  earnLabel: { color: colors.muted, fontSize: 9, fontWeight: "800", letterSpacing: 1.5 },
  earnValue: { fontSize: 14, fontWeight: "900", marginTop: 2 },
  actionRow: { flexDirection: "row", gap: spacing.sm },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10 },
  actionBtnGhost: { borderWidth: 2, borderColor: colors.border },
  actionText: { color: colors.onBrand, fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  empty: { color: colors.muted, textAlign: "center", padding: spacing.xl, letterSpacing: 2, fontWeight: "800" },
});
