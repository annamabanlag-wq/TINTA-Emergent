import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl, ActivityIndicator, Alert, Modal, TextInput } from "react-native";
import Icon from "@react-native-vector-icons/feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../../src/session";
import { useI18n } from "../../src/i18n";
import { colors, spacing } from "../../src/theme";
import AdminHeader from "../../src/AdminHeader";
import { adminApi, Payout, AdminArtist } from "../../src/adminApi";
import { fmtPHP } from "../../src/currency";

export default function AdminPayoutsScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useSession();
  const { t } = useI18n();
  const [rows, setRows] = useState<Payout[]>([]);
  const [artists, setArtists] = useState<AdminArtist[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modal, setModal] = useState(false);
  const [selArtist, setSelArtist] = useState<AdminArtist | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [ps, ars] = await Promise.all([adminApi.payouts(token), adminApi.listArtists(token)]);
      setRows(ps);
      setArtists(ars);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const eligibleArtists = artists.filter((a) => a.pending_earnings > 0);

  const createPayout = async () => {
    if (!selArtist) return;
    setSubmitting(true);
    try {
      await adminApi.createPayout(selArtist.id, note.trim(), token!);
      setModal(false);
      setSelArtist(null);
      setNote("");
      await load();
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.root}>
      <AdminHeader
        title={t("admin.payouts.title")}
        testID="admin-payouts-title"
        right={
          <Pressable testID="new-payout-btn" onPress={() => setModal(true)} style={styles.addBtn}>
            <Icon name="plus" size={14} color={colors.onBrand} />
            <Text style={styles.addBtnText}>{t("admin.payouts.create")}</Text>
          </Pressable>
        }
      />
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(p) => p.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brand} />}
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
          renderItem={({ item }) => (
            <View style={styles.card} testID={`payout-row-${item.id}`}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={styles.artist}>{item.artist_name}</Text>
                <View style={{ flex: 1 }} />
                <Text style={styles.amount}>{fmtPHP(item.amount)}</Text>
              </View>
              <Text style={styles.meta}>{item.count} bookings · {new Date(item.created_at).toLocaleDateString()}</Text>
              {item.note ? <Text style={styles.note} numberOfLines={2}>“{item.note}”</Text> : null}
              <View style={styles.by}>
                <Text style={styles.byText}>by {item.created_by_name} · {item.status.toUpperCase()}</Text>
              </View>
            </View>
          )}
          ListEmptyComponent={<Text style={styles.empty}>No payouts yet — {eligibleArtists.length} artist(s) have pending earnings</Text>}
        />
      )}

      <Modal visible={modal} animationType="slide" transparent onRequestClose={() => setModal(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modal}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>{t("admin.payouts.create")}</Text>
              <Pressable onPress={() => setModal(false)} testID="modal-close"><Icon name="x" size={22} color={colors.onSurface} /></Pressable>
            </View>
            <Text style={styles.label}>SELECT ARTIST</Text>
            {eligibleArtists.length === 0 ? (
              <Text style={styles.emptyModal}>No artists have pending earnings</Text>
            ) : (
              <FlatList
                data={eligibleArtists}
                keyExtractor={(a) => a.id}
                style={{ maxHeight: 260 }}
                renderItem={({ item }) => (
                  <Pressable
                    testID={`pick-artist-${item.id}`}
                    onPress={() => setSelArtist(item)}
                    style={[styles.pickRow, selArtist?.id === item.id && styles.pickRowOn]}
                  >
                    <Text style={styles.pickName} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.pickAmt}>{fmtPHP(item.pending_earnings)}</Text>
                    <Text style={styles.pickMeta}>{item.pending_count}x</Text>
                  </Pressable>
                )}
              />
            )}
            <Text style={styles.label}>NOTE (optional)</Text>
            <TextInput
              testID="payout-note"
              placeholder="Bank ref / channel..."
              placeholderTextColor={colors.muted}
              style={styles.input}
              value={note}
              onChangeText={setNote}
            />
            <Pressable testID="confirm-payout" onPress={createPayout} style={[styles.confirmBtn, !selArtist && { opacity: 0.5 }]} disabled={!selArtist || submitting}>
              {submitting ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.confirmText}>{t("admin.confirm")} · {fmtPHP(selArtist?.pending_earnings ?? 0)}</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { padding: spacing.xl, alignItems: "center" },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.brand, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  addBtnText: { color: colors.onBrand, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  card: { marginHorizontal: spacing.lg, marginTop: spacing.md, padding: spacing.md, borderWidth: 2, borderColor: colors.borderStrong, backgroundColor: colors.surfaceSecondary, gap: 4 },
  artist: { color: colors.onSurface, fontSize: 14, fontWeight: "900", letterSpacing: 0.5 },
  amount: { color: colors.success, fontSize: 16, fontWeight: "900" },
  meta: { color: colors.muted, fontSize: 11 },
  note: { color: colors.onSurfaceSecondary, fontSize: 12, fontStyle: "italic", marginTop: 4 },
  by: { marginTop: 4 },
  byText: { color: colors.muted, fontSize: 10, letterSpacing: 1, fontWeight: "800" },
  empty: { color: colors.muted, textAlign: "center", padding: spacing.xl, letterSpacing: 1, fontWeight: "800" },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "flex-end" },
  modal: { backgroundColor: colors.surface, padding: spacing.lg, borderTopWidth: 2, borderColor: colors.borderStrong, gap: spacing.sm, maxHeight: "85%" },
  modalHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  modalTitle: { color: colors.onSurface, fontSize: 18, fontWeight: "900", letterSpacing: 2 },
  label: { color: colors.brand, fontSize: 10, fontWeight: "900", letterSpacing: 2, marginTop: spacing.sm },
  pickRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 2, borderColor: colors.border, marginTop: 6 },
  pickRowOn: { borderColor: colors.brand, backgroundColor: colors.brandTertiary },
  pickName: { flex: 1, color: colors.onSurface, fontSize: 13, fontWeight: "900" },
  pickAmt: { color: colors.success, fontSize: 13, fontWeight: "900" },
  pickMeta: { color: colors.muted, fontSize: 10, marginLeft: 6 },
  emptyModal: { color: colors.muted, padding: spacing.md, textAlign: "center" },
  input: { color: colors.onSurface, fontSize: 14, borderWidth: 2, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surfaceSecondary },
  confirmBtn: { marginTop: spacing.md, backgroundColor: colors.brand, paddingVertical: spacing.md, alignItems: "center", borderWidth: 2, borderColor: colors.borderStrong },
  confirmText: { color: colors.onBrand, fontSize: 14, fontWeight: "900", letterSpacing: 2 },
});
