import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import Icon from "@react-native-vector-icons/feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../../src/session";
import { useI18n } from "../../src/i18n";
import { colors, spacing } from "../../src/theme";
import { adminApi, AdminStats } from "../../src/adminApi";
import { fmtPHP } from "../../src/currency";

export default function AdminTab() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, token } = useSession();
  const { t } = useI18n();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const s = await adminApi.stats(token);
      setStats(s);
    } catch (e: any) {
      // Non-admin will land in profile via layout guard, but handle 403 gracefully
      console.warn("admin stats", e?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  if (!user?.is_admin) {
    return (
      <View style={[styles.root, { justifyContent: "center", alignItems: "center", paddingTop: insets.top }]}>
        <Icon name="lock" size={48} color={colors.brand} />
        <Text style={styles.deniedTitle}>ADMIN ONLY</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{ paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
    >
      <View style={styles.header}>
        <Text style={styles.eyebrow}>{t("admin.subtitle")}</Text>
        <Text style={styles.title} testID="admin-title">{t("admin.title")}</Text>
      </View>

      {loading ? (
        <View style={{ padding: spacing.xl }}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : stats ? (
        <>
          <Text style={styles.sectionTitle}>{t("admin.overview")}</Text>
          <View style={styles.statGrid}>
            <StatCard label={t("admin.stats.users")} value={String(stats.users)} icon="users" testID="stat-users" />
            <StatCard label={t("admin.stats.artists")} value={String(stats.artists)} icon="user-check" testID="stat-artists" />
            <StatCard label={t("admin.stats.bookings")} value={String(stats.bookings.total)} icon="calendar" testID="stat-bookings" />
            <StatCard
              label={t("admin.stats.paid")}
              value={String(stats.bookings.paid)}
              icon="check-circle"
              accent={colors.success}
              testID="stat-paid"
            />
          </View>

          <Text style={styles.sectionTitle}>REVENUE</Text>
          <View style={styles.revBlock}>
            <RevRow label={t("admin.stats.gross")} value={fmtPHP(stats.revenue.gross)} testID="rev-gross" />
            <RevRow
              label={`${t("admin.stats.commission")} (${stats.commission_pct}%)`}
              value={fmtPHP(stats.revenue.commission_earned)}
              accent
              testID="rev-commission"
            />
            <RevRow label={t("admin.stats.artistEarn")} value={fmtPHP(stats.revenue.artist_earnings)} testID="rev-artist-earn" />
            <RevRow
              label={t("admin.stats.pendingPayouts")}
              value={fmtPHP(stats.revenue.pending_payouts)}
              hint
              testID="rev-pending-payouts"
            />
          </View>

          <Text style={styles.sectionTitle}>MANAGE</Text>
          <NavTile
            testID="nav-users"
            icon="users"
            label={t("admin.nav.users")}
            hint={`${stats.users} total`}
            onPress={() => router.push("/admin/users")}
          />
          <NavTile
            testID="nav-artists"
            icon="user-check"
            label={t("admin.nav.artists")}
            hint={`${stats.artists} active`}
            onPress={() => router.push("/admin/artists")}
          />
          <NavTile
            testID="nav-bookings"
            icon="calendar"
            label={t("admin.nav.bookings")}
            hint={`${stats.bookings.total} total`}
            onPress={() => router.push("/admin/bookings")}
          />
          <NavTile
            testID="nav-payments"
            icon="credit-card"
            label={t("admin.nav.payments")}
            hint={`${stats.bookings.paid} paid`}
            onPress={() => router.push("/admin/payments")}
          />
          <NavTile
            testID="nav-commissions"
            icon="pie-chart"
            label={t("admin.nav.commissions")}
            hint={fmtPHP(stats.revenue.commission_earned)}
            onPress={() => router.push("/admin/commissions")}
          />
          <NavTile
            testID="nav-payouts"
            icon="dollar-sign"
            label={t("admin.nav.payouts")}
            hint={fmtPHP(stats.revenue.pending_payouts) + " pending"}
            onPress={() => router.push("/admin/payouts")}
          />
        </>
      ) : null}
    </ScrollView>
  );
}

function StatCard({ label, value, icon, accent, testID }: { label: string; value: string; icon: any; accent?: string; testID?: string }) {
  return (
    <View style={[styles.statCard, accent ? { borderColor: accent } : null]} testID={testID}>
      <Icon name={icon} size={16} color={accent ?? colors.brand} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function RevRow({ label, value, accent, hint, testID }: { label: string; value: string; accent?: boolean; hint?: boolean; testID?: string }) {
  return (
    <View style={styles.revRow} testID={testID}>
      <Text style={styles.revLabel}>{label}</Text>
      <Text style={[styles.revValue, accent && { color: colors.brand }, hint && { color: colors.warning }]}>{value}</Text>
    </View>
  );
}

function NavTile({ icon, label, hint, onPress, testID }: { icon: any; label: string; hint?: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable testID={testID} onPress={onPress} style={styles.navTile}>
      <View style={styles.navIcon}>
        <Icon name={icon} size={20} color={colors.onBrand} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.navLabel}>{label}</Text>
        {hint ? <Text style={styles.navHint}>{hint}</Text> : null}
      </View>
      <Icon name="chevron-right" size={20} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 2, borderBottomColor: colors.borderStrong },
  eyebrow: { color: colors.brand, fontSize: 10, fontWeight: "900", letterSpacing: 3, marginBottom: 4 },
  title: { color: colors.onSurface, fontSize: 32, fontWeight: "900", letterSpacing: 2, lineHeight: 34 },
  deniedTitle: { color: colors.onSurface, fontSize: 20, fontWeight: "900", letterSpacing: 3, marginTop: spacing.md },
  sectionTitle: {
    color: colors.brand,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 3,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    marginTop: spacing.md,
  },
  statGrid: { flexDirection: "row", flexWrap: "wrap", padding: spacing.md, gap: spacing.sm },
  statCard: {
    width: "48%",
    padding: spacing.md,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceSecondary,
    gap: 6,
  },
  statValue: { color: colors.onSurface, fontSize: 24, fontWeight: "900", letterSpacing: 1 },
  statLabel: { color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 2 },
  revBlock: { marginHorizontal: spacing.lg, borderWidth: 2, borderColor: colors.borderStrong, backgroundColor: colors.surfaceSecondary },
  revRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  revLabel: { color: colors.onSurfaceSecondary, fontSize: 11, fontWeight: "800", letterSpacing: 1.5 },
  revValue: { color: colors.onSurface, fontSize: 16, fontWeight: "900", letterSpacing: 0.5 },
  navTile: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  navIcon: { width: 40, height: 40, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.borderStrong },
  navLabel: { color: colors.onSurface, fontSize: 13, fontWeight: "900", letterSpacing: 1.5 },
  navHint: { color: colors.muted, fontSize: 11, marginTop: 2 },
});
