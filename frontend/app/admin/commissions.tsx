import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, RefreshControl, ActivityIndicator, Alert, Image } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../../src/session";
import { useI18n } from "../../src/i18n";
import { colors, spacing } from "../../src/theme";
import AdminHeader from "../../src/AdminHeader";
import { adminApi, CommissionRow } from "../../src/adminApi";
import { fmtPHP } from "../../src/currency";

export default function AdminCommissionsScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useSession();
  const { t } = useI18n();
  const [rows, setRows] = useState<CommissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const data = await adminApi.commissions(token);
      setRows(data);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const totals = rows.reduce(
    (acc, r) => {
      acc.gross += r.gross;
      acc.commission += r.commission;
      acc.net += r.artist_net;
      acc.bookings += r.bookings;
      return acc;
    },
    { gross: 0, commission: 0, net: 0, bookings: 0 },
  );

  return (
    <View style={styles.root}>
      <AdminHeader title={t("admin.commissions.title")} testID="admin-commissions-title" />
      <Text style={styles.sub}>{t("admin.commissions.subtitle")}</Text>

      <View style={styles.summaryRow}>
        <SummaryBox label="GROSS" value={fmtPHP(totals.gross)} />
        <SummaryBox label="INKED CUT" value={fmtPHP(totals.commission)} accent />
        <SummaryBox label="ARTIST NET" value={fmtPHP(totals.net)} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.artist_id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brand} />}
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
          renderItem={({ item }) => (
            <View style={styles.card} testID={`comm-row-${item.artist_id}`}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                {item.artist_avatar ? <Image source={{ uri: item.artist_avatar }} style={styles.avatar} /> : <View style={styles.avatar} />}
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={1}>{item.artist_name}</Text>
                  <Text style={styles.meta}>{item.bookings} bookings paid</Text>
                </View>
              </View>
              <View style={styles.metaRow}>
                <MetaBox label="GROSS" value={fmtPHP(item.gross)} />
                <MetaBox label="COMMISSION" value={fmtPHP(item.commission)} accent />
                <MetaBox label="ARTIST NET" value={fmtPHP(item.artist_net)} success />
              </View>
            </View>
          )}
          ListEmptyComponent={<Text style={styles.empty}>No paid bookings yet</Text>}
        />
      )}
    </View>
  );
}

function SummaryBox({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={[styles.sumBox, accent && { borderColor: colors.brand }]}>
      <Text style={styles.sumLabel}>{label}</Text>
      <Text style={[styles.sumValue, accent && { color: colors.brand }]}>{value}</Text>
    </View>
  );
}

function MetaBox({ label, value, accent, success }: { label: string; value: string; accent?: boolean; success?: boolean }) {
  return (
    <View style={styles.metaBox}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={[styles.metaValue, accent && { color: colors.brand }, success && { color: colors.success }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { padding: spacing.xl, alignItems: "center" },
  sub: { color: colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 2, padding: spacing.md },
  summaryRow: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  sumBox: { flex: 1, padding: spacing.md, borderWidth: 2, borderColor: colors.borderStrong, backgroundColor: colors.surfaceSecondary },
  sumLabel: { color: colors.muted, fontSize: 9, fontWeight: "800", letterSpacing: 1 },
  sumValue: { color: colors.onSurface, fontSize: 14, fontWeight: "900", marginTop: 4 },
  card: { marginHorizontal: spacing.lg, marginBottom: spacing.md, padding: spacing.md, borderWidth: 2, borderColor: colors.borderStrong, backgroundColor: colors.surfaceSecondary, gap: spacing.sm },
  avatar: { width: 44, height: 44, borderWidth: 2, borderColor: colors.borderStrong, backgroundColor: colors.surfaceTertiary },
  name: { color: colors.onSurface, fontSize: 14, fontWeight: "900", letterSpacing: 0.5 },
  meta: { color: colors.muted, fontSize: 11, marginTop: 2 },
  metaRow: { flexDirection: "row", gap: spacing.sm },
  metaBox: { flex: 1, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  metaLabel: { color: colors.muted, fontSize: 9, fontWeight: "800", letterSpacing: 1 },
  metaValue: { color: colors.onSurface, fontSize: 12, fontWeight: "900", marginTop: 2 },
  empty: { color: colors.muted, textAlign: "center", padding: spacing.xl, letterSpacing: 2, fontWeight: "800" },
});
