import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import Icon from "@react-native-vector-icons/feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, Booking, Followup } from "../../src/api";
import { useSession } from "../../src/session";
import { useI18n } from "../../src/i18n";
import { colors, spacing } from "../../src/theme";
import { fmtPHP } from "../../src/currency";

export default function BookingsTab() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token } = useSession();
  const { t } = useI18n();
  const [items, setItems] = useState<Booking[]>([]);
  const [followups, setFollowups] = useState<Followup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setError("");
      const [data, fu] = await Promise.all([
        api<Booking[]>("/bookings", {}, token),
        api<Followup[]>("/bookings/followups", {}, token).catch(() => []),
      ]);
      setItems(data);
      setFollowups(fu);
    } catch (e: any) {
      setError(e?.message || "Could not load your bookings. Please try again.");
    } finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const cancel = async (id: string) => {
    try {
      await api(`/bookings/${id}/cancel`, { method: "POST" }, token);
      await load();
    } catch (e: any) {
      setError(e?.message || "Could not cancel this booking. Please try again.");
    }
  };

  const today = new Date().toISOString().slice(0, 10);
  const filtered = items.filter((b) =>
    tab === "upcoming"
      ? b.status !== "cancelled" && b.date >= today
      : b.status === "cancelled" || b.date < today
  );

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.title}>{t("tab.bookings")}</Text>
        <View style={styles.segRow}>
          <Pressable testID="bookings-tab-upcoming" onPress={() => setTab("upcoming")} style={[styles.segBtn, tab === "upcoming" && styles.segActive]}>
            <Text style={[styles.segText, tab === "upcoming" && styles.segTextActive]}>{t("bookings.upcoming")}</Text>
          </Pressable>
          <Pressable testID="bookings-tab-past" onPress={() => setTab("past")} style={[styles.segBtn, tab === "past" && styles.segActive]}>
            <Text style={[styles.segText, tab === "past" && styles.segTextActive]}>{t("bookings.past")}</Text>
          </Pressable>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} size="large" /></View>
      ) : filtered.length === 0 && error ? (
        <View style={styles.center}>
          <Icon name="wifi-off" size={34} color={colors.brand} />
          <Text style={styles.errorTitle}>CONNECTION ISSUE</Text>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable testID="bookings-retry-button" onPress={load} style={styles.cta}>
            <Text style={styles.ctaText}>RETRY</Text>
          </Pressable>
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyBig}>{tab === "upcoming" ? t("bookings.empty.upcoming") : t("bookings.empty.past")}</Text>
          {tab === "upcoming" && (
            <Pressable testID="explore-artists-cta" onPress={() => router.push("/(tabs)")} style={styles.cta}>
              <Text style={styles.ctaText}>{t("bookings.explore")}</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <View style={styles.listWrap}>
          {error ? (
            <View style={styles.errorBanner} testID="bookings-error-banner">
              <Icon name="alert-circle" size={15} color={colors.brand} />
              <Text style={styles.errorBannerText}>{error}</Text>
              <Pressable testID="bookings-retry-inline" onPress={load} hitSlop={10}>
                <Text style={styles.errorRetry}>RETRY</Text>
              </Pressable>
            </View>
          ) : null}
          <FlatList
          data={filtered}
          keyExtractor={(b) => b.id}
          contentContainerStyle={{ paddingBottom: spacing.xl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brand} />}
          ListHeaderComponent={
            tab === "upcoming" && followups.length > 0 ? (
              <View style={styles.followupList} testID="followup-banner">
                {followups.map((f) => (
                  <View key={f.booking_id} style={styles.followupCard}>
                    <View style={styles.followupHead}>
                      <Image source={f.artist_avatar} style={styles.followupAvatar} contentFit="cover" />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.followupTitle}>{t("bookings.followup.title")}</Text>
                        <Text style={styles.followupSub}>{f.artist_name.toUpperCase()} · {f.date}</Text>
                      </View>
                    </View>
                    <View style={styles.followupActions}>
                      <Pressable testID={`followup-review-${f.booking_id}`} onPress={() => router.push(`/artist/${f.artist_id}`)} style={styles.followupBtn}>
                        <Icon name="star" size={12} color={colors.onBrand} />
                        <Text style={styles.followupBtnText}>{t("bookings.followup.leaveReview")}</Text>
                      </Pressable>
                      <Pressable testID={`followup-rebook-${f.booking_id}`} onPress={() => router.push(`/book/${f.artist_id}`)} style={[styles.followupBtn, styles.followupBtnGhost]}>
                        <Icon name="rotate-cw" size={12} color={colors.onSurface} />
                        <Text style={[styles.followupBtnText, { color: colors.onSurface }]}>{t("bookings.followup.bookAgain")}</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            ) : null
          }
          renderItem={({ item }) => {
            const d = new Date(item.date + "T00:00:00");
            const today0 = new Date(); today0.setHours(0,0,0,0);
            const daysAway = Math.round((d.getTime() - today0.getTime()) / 86400000);
            const upcomingSoon = item.status !== "cancelled" && daysAway >= 0 && daysAway <= 3;
            const reminderText = daysAway === 0 ? t("bookings.today") : daysAway === 1 ? t("bookings.tomorrow") : `${daysAway} ${t("bookings.daysAway")}`;
            const isGcashPending = item.payment_method === "gcash" && item.payment_status !== "paid" && item.gcash_review_status === "pending";
            const isGcashRejected = item.payment_method === "gcash" && item.payment_status !== "paid" && item.gcash_review_status === "rejected";
            const paymentLabel = item.payment_status === "paid" ? "PAID" : isGcashPending ? "PENDING" : isGcashRejected ? "REJECTED" : (item.payment_status || "unpaid").toUpperCase();
            return (
              <View style={styles.row} testID={`booking-row-${item.id}`}>
                {upcomingSoon && (
                  <View style={styles.reminderBanner} testID={`reminder-${item.id}`}>
                    <Icon name="bell" size={11} color={colors.onBrand} />
                    <Text style={styles.reminderText}>{reminderText} — {t("bookings.getReady")}</Text>
                  </View>
                )}
                <View style={styles.rowInner}>
                  <View style={styles.dateBlock}>
                    <Text style={styles.day}>{d.getDate().toString().padStart(2, "0")}</Text>
                    <Text style={styles.mon}>{d.toLocaleString("en", { month: "short" }).toUpperCase()}</Text>
                    <Text style={styles.yr}>{d.getFullYear()}</Text>
                  </View>
                  <View style={styles.rowContent}>
                    <View style={styles.rowTop}>
                      <Image source={item.artist_avatar} style={styles.avatar} contentFit="cover" />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.artistName}>{item.artist_name.toUpperCase()}</Text>
                        <Text style={styles.timeRow}>
                          <Icon name="clock" size={11} color={colors.muted} />  {item.time_slot} · {item.estimated_hours}H
                        </Text>
                      </View>
                      <View style={[styles.statusPill, item.status === "cancelled" && styles.statusCancelled]}>
                        <Text style={styles.statusText}>{item.status.toUpperCase()}</Text>
                      </View>
                    </View>
                    <Text style={styles.desc} numberOfLines={2}>{item.description}</Text>
                    {item.reference_image && (
                      <View style={styles.refThumb}>
                        <Image source={item.reference_image.startsWith("http") ? { uri: item.reference_image, headers: token ? { Authorization: `Bearer ${token}` } : undefined } : item.reference_image} style={StyleSheet.absoluteFill} contentFit="cover" />
                      </View>
                    )}
                    <View style={styles.actionRow}>
                      <View style={styles.depositRow}>
                        <Text style={styles.deposit}>DEPOSIT {fmtPHP(item.deposit)}</Text>
                        <View style={[styles.payPill, item.payment_status === "paid" ? styles.payPillPaid : isGcashPending ? styles.payPillPending : item.payment_status === "refunded" ? styles.payPillRefunded : styles.payPillUnpaid]}>
                          <Icon name={item.payment_status === "paid" ? "check" : isGcashPending ? "clock" : item.payment_status === "refunded" ? "rotate-ccw" : "alert-circle"} size={10} color={item.payment_status === "paid" ? colors.onSuccess : item.payment_status === "refunded" ? colors.info : colors.warning} />
                          <Text style={[styles.payPillText, { color: item.payment_status === "paid" ? colors.onSuccess : item.payment_status === "refunded" ? colors.info : colors.warning }]}>{paymentLabel}</Text>
                        </View>
                      </View>
                      <View style={styles.rowActions}>
                        {item.status === "cancelled" || item.date < today ? (
                          <Pressable testID={`book-again-${item.id}`} onPress={() => router.push(`/book/${item.artist_id}`)} style={styles.bookAgainBtn}>
                            <Icon name="rotate-cw" size={11} color={colors.onBrand} />
                            <Text style={styles.bookAgainText}>{t("bookings.bookAgain")}</Text>
                          </Pressable>
                        ) : (
                          <Pressable testID={`cancel-booking-${item.id}`} onPress={() => cancel(item.id)} style={styles.cancelBtn}>
                            <Text style={styles.cancelText}>{t("bookings.cancel")}</Text>
                          </Pressable>
                        )}
                      </View>
                    </View>
                  </View>
                </View>
              </View>
            );
          }}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 2, borderBottomColor: colors.borderStrong, gap: spacing.md },
  title: { color: colors.onSurface, fontSize: 36, fontWeight: "900", letterSpacing: 2 },
  segRow: { flexDirection: "row", gap: spacing.sm },
  segBtn: { flex: 1, paddingVertical: 12, borderWidth: 2, borderColor: colors.border, alignItems: "center" },
  segActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  segText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "800", letterSpacing: 2 },
  segTextActive: { color: colors.onBrand },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.lg },
  listWrap: { flex: 1 },
  errorTitle: { color: colors.onSurface, fontSize: 22, fontWeight: "900", letterSpacing: 2, textAlign: "center" },
  errorText: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: "center", maxWidth: 320 },
  errorBanner: { marginTop: spacing.md, marginHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 2, borderColor: colors.brand, backgroundColor: colors.surfaceSecondary, padding: spacing.sm },
  errorBannerText: { color: colors.onSurfaceSecondary, flex: 1, fontSize: 11, lineHeight: 15 },
  errorRetry: { color: colors.brand, fontSize: 10, fontWeight: "900", letterSpacing: 1.5 }
  emptyBig: { color: colors.onSurface, fontSize: 44, fontWeight: "900", letterSpacing: 2, textAlign: "center", lineHeight: 48 },
  cta: { backgroundColor: colors.brand, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  ctaText: { color: colors.onBrand, fontSize: 13, fontWeight: "900", letterSpacing: 2 },
  row: { padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.divider },
  rowInner: { flexDirection: "row", gap: spacing.md },
  reminderBanner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.brand, paddingHorizontal: spacing.md, paddingVertical: 6, marginBottom: spacing.md, borderWidth: 2, borderColor: colors.borderStrong },
  reminderText: { color: colors.onBrand, fontSize: 11, fontWeight: "900", letterSpacing: 2 },
  dateBlock: { width: 60, borderRightWidth: 2, borderRightColor: colors.border, paddingRight: spacing.md, alignItems: "flex-start" },
  day: { color: colors.onSurface, fontSize: 36, fontWeight: "900", lineHeight: 38 },
  mon: { color: colors.brand, fontSize: 12, fontWeight: "900", letterSpacing: 2 },
  yr: { color: colors.muted, fontSize: 10, fontWeight: "700" },
  rowContent: { flex: 1, gap: spacing.sm },
  rowTop: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  avatar: { width: 40, height: 40, backgroundColor: colors.surfaceSecondary, borderWidth: 2, borderColor: colors.border },
  artistName: { color: colors.onSurface, fontSize: 14, fontWeight: "900", letterSpacing: 1 },
  timeRow: { color: colors.muted, fontSize: 11, fontWeight: "700", letterSpacing: 1, marginTop: 2 },
  statusPill: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderWidth: 1, borderColor: colors.success },
  statusCancelled: { borderColor: colors.muted },
  statusText: { color: colors.onSurface, fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  desc: { color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 18 },
  actionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xs },
  depositRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  deposit: { color: colors.brand, fontSize: 12, fontWeight: "900", letterSpacing: 1 },
  payPill: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  payPillPaid: { borderColor: colors.success, backgroundColor: "rgba(0,138,46,0.15)" },
  payPillPending: { borderColor: colors.warning, backgroundColor: "rgba(255,170,0,0.10)" },
  payPillUnpaid: { borderColor: colors.warning },
  payPillRefunded: { borderColor: colors.info, backgroundColor: colors.surfaceSecondary },
  payPillText: { fontSize: 9, fontWeight: "900", letterSpacing: 1.5 },
  refThumb: { aspectRatio: 16 / 9, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, marginTop: spacing.xs },
  rowActions: { flexDirection: "row", gap: spacing.sm },
  cancelBtn: { borderWidth: 1, borderColor: colors.muted, paddingHorizontal: spacing.md, paddingVertical: 6 },
  cancelText: { color: colors.muted, fontSize: 10, fontWeight: "900", letterSpacing: 1.5 },
  bookAgainBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.brand, borderWidth: 1, borderColor: colors.brand, paddingHorizontal: spacing.md, paddingVertical: 6 },
  bookAgainText: { color: colors.onBrand, fontSize: 10, fontWeight: "900", letterSpacing: 1.5 },
  followupList: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm },
  followupCard: { borderWidth: 2, borderColor: colors.brand, backgroundColor: colors.surfaceSecondary, padding: spacing.md, gap: spacing.md },
  followupHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  followupAvatar: { width: 40, height: 40, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.borderStrong },
  followupTitle: { color: colors.brand, fontSize: 12, fontWeight: "900", letterSpacing: 2 },
  followupSub: { color: colors.onSurface, fontSize: 13, fontWeight: "800", letterSpacing: 1, marginTop: 2 },
  followupActions: { flexDirection: "row", gap: spacing.sm },
  followupBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: colors.brand, paddingVertical: 10, borderWidth: 2, borderColor: colors.brand },
  followupBtnGhost: { backgroundColor: colors.surface, borderColor: colors.borderStrong },
  followupBtnText: { color: colors.onBrand, fontSize: 11, fontWeight: "900", letterSpacing: 1.5 },
});
