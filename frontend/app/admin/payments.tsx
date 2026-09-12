import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, RefreshControl, ActivityIndicator, Alert, TouchableOpacity } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../../src/session";
import { useI18n } from "../../src/i18n";
import { colors, spacing } from "../../src/theme";
import AdminHeader from "../../src/AdminHeader";
import { adminApi, AdminBooking, GCashPayment } from "../../src/adminApi";
import { fmtPHP } from "../../src/currency";

export default function AdminPaymentsScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useSession();
  const { t } = useI18n();
  const [rows, setRows] = useState<AdminBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
const [gcashRows, setGcashRows] = useState<GCashPayment[]>([]);
const [gcashLoading, setGcashLoading] = useState(true);
  const load = useCallback(async () => {
    if (!token) return;
    try {
  const data = await adminApi.payments(token);
  setRows(data);

  setGcashLoading(true);
  const gcashData = await adminApi.gcashPayments(token);
  setGcashRows(gcashData);
} catch (e: any) {
  Alert.alert("Error", e?.message ?? "Failed");
} finally {
  setGcashLoading(false);
  setLoading(false);
  setRefreshing(false);
}
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);
const handleGcashReview = async (bookingId: string, approved: boolean) => {
  if (!token) return;

  try {
    await adminApi.reviewGcashPayment(
      bookingId,
      {
        approved,
        admin_note: approved ? "Payment approved by admin" : "Payment rejected by admin",
      },
      token
    );

    Alert.alert(
      approved ? "Payment Approved" : "Payment Rejected",
      approved
        ? "The GCash payment has been approved."
        : "The GCash payment has been rejected."
    );

    await load();
  } catch (e: any) {
    Alert.alert("Error", e?.message ?? "Failed to review GCash payment");
  }
};
  const totals = rows.reduce(
    (acc, r) => {
      const amt = r.amount_paid ?? r.deposit ?? 0;
      if (r.payment_status === "paid") acc.gross += amt;
      if (r.payment_status === "refunded") acc.refunded += amt;
      return acc;
    },
    { gross: 0, refunded: 0 },
  );

  return (
    <View style={styles.root}>
      <AdminHeader title={t("admin.payments.title")} testID="admin-payments-title" />
      {gcashLoading ? (
  <View style={{ padding: 16 }}>
    <ActivityIndicator color={colors.brand} />
  </View>
) : gcashRows.length > 0 ? (
  <View style={{ marginBottom: 16 }}>
    <Text style={{ fontSize: 18, fontWeight: "700", color: colors.text, marginBottom: 10 }}>
      GCash Payments for Verification
    </Text>

    {gcashRows.map((item) => (
      <View
        key={item.id}
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 12,
          padding: 14,
          marginBottom: 10,
        }}
      >
        <Text style={{ color: colors.text, fontWeight: "700" }}>
          {item.artist_name}
        </Text>

        <Text style={{ color: colors.muted, marginTop: 4 }}>
          Customer: {item.user_email}
        </Text>

        <Text style={{ color: colors.text, marginTop: 8 }}>
          Amount: {fmtPHP(item.amount_submitted ?? item.deposit ?? 0)}
        </Text>

        <Text style={{ color: colors.text, marginTop: 4 }}>
          GCash Reference: {item.gcash_reference_number ?? "Not provided"}
        </Text>

        {item.gcash_receipt_url ? (
          <Text style={{ color: colors.brand, marginTop: 4 }}>
            Receipt: {item.gcash_receipt_url}
          </Text>
        ) : null}

        <View style={{ flexDirection: "row", marginTop: 12 }}>
          <TouchableOpacity
            onPress={() => handleGcashReview(item.id, true)}
            style={{
              flex: 1,
              padding: 12,
              borderRadius: 10,
              marginRight: 6,
              alignItems: "center",
              backgroundColor: colors.success,
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "700" }}>
              APPROVE
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => handleGcashReview(item.id, false)}
            style={{
              flex: 1,
              padding: 12,
              borderRadius: 10,
              marginLeft: 6,
              alignItems: "center",
              backgroundColor: colors.warning,
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "700" }}>
              REJECT
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    ))}
  </View>
) : null}
      <View style={styles.totalsRow}>
        <View style={styles.totalBox}>
          <Text style={styles.tLabel}>PAID</Text>
          <Text style={[styles.tValue, { color: colors.success }]}>{fmtPHP(totals.gross)}</Text>
        </View>
        <View style={styles.totalBox}>
          <Text style={styles.tLabel}>REFUNDED</Text>
          <Text style={[styles.tValue, { color: colors.warning }]}>{fmtPHP(totals.refunded)}</Text>
        </View>
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
            <View style={styles.row} testID={`pay-row-${item.id}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.artist}>{item.artist_name}</Text>
                <Text style={styles.meta}>{item.user_email}</Text>
                <Text style={styles.meta}>{item.paid_at ? new Date(item.paid_at).toLocaleString() : item.date}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[styles.amount, item.payment_status === "refunded" && { color: colors.warning, textDecorationLine: "line-through" }]}>
                  {fmtPHP(item.amount_paid ?? item.deposit)}
                </Text>
                <Text style={styles.method}>{(item.payment_method ?? "card").toUpperCase()}</Text>
                <Text style={[styles.method, { color: item.payment_status === "paid" ? colors.success : colors.warning }]}>{item.payment_status.toUpperCase()}</Text>
              </View>
            </View>
          )}
          ListEmptyComponent={<Text style={styles.empty}>No payments yet</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { padding: spacing.xl, alignItems: "center" },
  totalsRow: { flexDirection: "row", gap: spacing.sm, padding: spacing.md },
  totalBox: { flex: 1, padding: spacing.md, borderWidth: 2, borderColor: colors.borderStrong, backgroundColor: colors.surfaceSecondary },
  tLabel: { color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 2 },
  tValue: { fontSize: 18, fontWeight: "900", marginTop: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  artist: { color: colors.onSurface, fontSize: 13, fontWeight: "900", letterSpacing: 0.5 },
  meta: { color: colors.muted, fontSize: 11, marginTop: 2 },
  amount: { color: colors.onSurface, fontSize: 15, fontWeight: "900" },
  method: { color: colors.brand, fontSize: 10, fontWeight: "800", letterSpacing: 1, marginTop: 2 },
  empty: { color: colors.muted, textAlign: "center", padding: spacing.xl, letterSpacing: 2, fontWeight: "800" },
});
