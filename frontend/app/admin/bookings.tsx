import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl, ActivityIndicator, Alert } from "react-native";
import Icon from "@react-native-vector-icons/feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../../src/session";
import { useI18n } from "../../src/i18n";
import { colors, spacing } from "../../src/theme";
import AdminHeader from "../../src/AdminHeader";
import { adminApi, AdminBooking } from "../../src/adminApi";
import { fmtPHP } from "../../src/currency";

type Filter = "" | "paid" | "unpaid" | "refunded";

export default function AdminBookingsScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useSession();
  const { t } = useI18n();
  const [rows, setRows] = useState<AdminBooking[]>([]);
  const [filter, setFilter] = useState<Filter>("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const data = await adminApi.listBookings(filter ? { payment_status: filter } : {}, token);
      setRows(data);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, filter]);

  useEffect(() => { load(); }, [load]);

  const refund = (b: AdminBooking) => {
    Alert.alert(
      t("admin.bookings.refund"),
      `${b.artist_name} · ${b.date} ${b.time_slot} · ${fmtPHP(b.amount_paid ?? b.deposit)}`,
      [
        { text: t("admin.cancel"), style: "cancel" },
        {
          text: t("admin.confirm"),
          onPress: async () => {
            try {
              await adminApi.refundBooking(b.id, token!);
              await load();
            } catch (e: any) {
              Alert.alert("Error", e?.message ?? "Failed");
            }
          },
        },
      ],
    );
  };

  const filters: { key: Filter; label: string }[] = [
    { key: "", label: t("admin.bookings.all") },
    { key: "paid", label: t("admin.bookings.filter.paid") },
    { key: "unpaid", label: t("admin.bookings.filter.unpaid") },
    { key: "refunded", label: t("admin.bookings.filter.refunded") },
  ];

  return (
    <View style={styles.root}>
      <AdminHeader title={t("admin.bookings.title")} testID="admin-bookings-title" />
      <View style={styles.filterRow}>
        {filters.map((f) => {
          const on = filter === f.key;
          return (
            <Pressable key={f.key || "all"} onPress={() => setFilter(f.key)} style={[styles.filter, on && styles.filterOn]} testID={`filter-${f.key || "all"}`}>
              <Text style={[styles.filterText, on && styles.filterTextOn]}>{f.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(b) => b.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brand} />}
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
          renderItem={({ item }) => (
            <View style={styles.card} testID={`booking-row-${item.id}`}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <View style={[styles.dot, item.payment_status === "paid" && { backgroundColor: colors.success }, item.payment_status === "refunded" && { backgroundColor: colors.warning }]} />
                <Text style={styles.artist} numberOfLines={1}>{item.artist_name}</Text>
                <Text style={styles.date}>{item.date} · {item.time_slot}</Text>
              </View>
              <Text style={styles.user}>{item.user_name} · {item.user_email}</Text>
              <Text style={styles.desc} numberOfLines={2}>{item.description}</Text>
              <View style={styles.metaRow}>
                <MetaBox label="AMOUNT" value={fmtPHP(item.amount_paid ?? item.deposit)} />
                <MetaBox label="COMMISSION" value={fmtPHP(item.commission_amount ?? 0)} accent />
                <MetaBox label="ARTIST NET" value={fmtPHP(item.artist_earnings ?? 0)} />
              </View>
              <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center", marginTop: spacing.sm }}>
                <StatusPill status={item.status} />
                <StatusPill status={item.payment_status} pay />
                {item.home_service ? <StatusPill status="HOME" /> : null}
                <View style={{ flex: 1 }} />
                {item.payment_status === "paid" && (
                  <Pressable testID={`refund-${item.id}`} onPress={() => refund(item)} style={styles.refundBtn}>
                    <Icon name="rotate-ccw" size={12} color={colors.onBrand} />
                    <Text style={styles.refundText}>{t("admin.bookings.refund")}</Text>
                  </Pressable>
                )}
              </View>
            </View>
          )}
          ListEmptyComponent={<Text style={styles.empty}>No bookings</Text>}
        />
      )}
    </View>
  );
}

function MetaBox({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.metaBox}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={[styles.metaValue, accent && { color: colors.brand }]}>{value}</Text>
    </View>
  );
}

function StatusPill({ status, pay }: { status: string; pay?: boolean }) {
  const s = (status || "").toLowerCase();
  const map: Record<string, string> = {
    confirmed: colors.info,
    completed: colors.success,
    cancelled: colors.muted,
    paid: colors.success,
    unpaid: colors.warning,
    refunded: colors.warning,
    home: colors.brand,
  };
  const bg = map[s] || colors.info;
  return (
    <View style={[styles.pill, { borderColor: bg }]}>
      <Text style={[styles.pillText, { color: bg }]}>{status.toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { padding: spacing.xl, alignItems: "center" },
  filterRow: { flexDirection: "row", gap: 6, padding: spacing.md, flexWrap: "wrap" },
  filter: { paddingHorizontal: spacing.md, paddingVertical: 6, borderWidth: 2, borderColor: colors.border },
  filterOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  filterText: { color: colors.onSurface, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  filterTextOn: { color: colors.onBrand },
  card: { marginHorizontal: spacing.lg, marginTop: spacing.sm, padding: spacing.md, borderWidth: 2, borderColor: colors.borderStrong, backgroundColor: colors.surfaceSecondary, gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.muted },
  artist: { flex: 1, color: colors.onSurface, fontSize: 14, fontWeight: "900", letterSpacing: 0.5 },
  date: { color: colors.brand, fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  user: { color: colors.muted, fontSize: 11 },
  desc: { color: colors.onSurfaceSecondary, fontSize: 12 },
  metaRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  metaBox: { flex: 1, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  metaLabel: { color: colors.muted, fontSize: 9, fontWeight: "800", letterSpacing: 1 },
  metaValue: { color: colors.onSurface, fontSize: 12, fontWeight: "900", marginTop: 2 },
  pill: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderWidth: 2 },
  pillText: { fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  refundBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.brand, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  refundText: { color: colors.onBrand, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  empty: { color: colors.muted, textAlign: "center", padding: spacing.xl, letterSpacing: 2, fontWeight: "800" },
});
