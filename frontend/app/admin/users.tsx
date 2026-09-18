import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl, ActivityIndicator, Alert } from "react-native";
import Icon from "@react-native-vector-icons/feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../../src/session";
import { useI18n } from "../../src/i18n";
import { colors, spacing } from "../../src/theme";
import AdminHeader from "../../src/AdminHeader";
import { adminApi, AdminUser } from "../../src/adminApi";

export default function AdminUsersScreen() {
  const insets = useSafeAreaInsets();
  const { user: me, token } = useSession();
  const { t } = useI18n();
  const [rows, setRows] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const data = await adminApi.listUsers(token);
      setRows(data);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to load");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const onDeleteUser = async (u: AdminUser) => {
    if (u.id === me?.id) {
      Alert.alert("Cannot delete", "You cannot delete your own admin account.");
      return;
    }
    Alert.alert(
      t("admin.user.delete.title"),
      `${u.name || "User"} — ${u.email}`,
      [
        { text: t("admin.cancel"), style: "cancel" },
        {
          text: t("admin.user.delete.confirm"),
          style: "destructive",
          onPress: async () => {
            try {
              await adminApi.deleteUser(u.id, token!);
              await load();
            } catch (e: any) {
              Alert.alert("Error", e?.message ?? "Failed to delete user");
            }
          },
        },
      ],
    );
  };

  const onToggleAdmin = async (u: AdminUser) => {
    if (u.id === me?.id) {
      Alert.alert("Cannot modify", "You cannot change your own admin role.");
      return;
    }
    Alert.alert(
      u.is_admin ? t("admin.role.demote") : t("admin.role.promote"),
      `${u.email}`,
      [
        { text: t("admin.cancel"), style: "cancel" },
        {
          text: t("admin.confirm"),
          onPress: async () => {
            try {
              await adminApi.toggleUserAdmin(u.id, token!);
              await load();
            } catch (e: any) {
              Alert.alert("Error", e?.message ?? "Failed");
            }
          },
        },
      ],
    );
  };

  return (
    <View style={styles.root}>
      <AdminHeader title={t("admin.users.title")} testID="admin-users-title" />
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(u) => u.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brand} />}
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
          renderItem={({ item }) => (
            <View style={styles.row} testID={`user-row-${item.id}`}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{(item.name || item.email)[0].toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{item.name || "—"}</Text>
                <Text style={styles.email} numberOfLines={1}>{item.email}</Text>
                <Text style={styles.meta}>{item.bookings_count} bookings</Text>
              </View>
              <Pressable
                testID={`toggle-admin-${item.id}`}
                onPress={() => onToggleAdmin(item)}
                style={[styles.roleBadge, item.is_admin && styles.roleBadgeActive]}
              >
                <Icon name={item.is_admin ? "shield" : "user"} size={12} color={item.is_admin ? colors.onBrand : colors.onSurface} />
                <Text style={[styles.roleText, item.is_admin && styles.roleTextActive]}>
                  {item.is_admin ? t("admin.role.admin") : t("admin.role.user")}
                </Text>
              </Pressable>
              {item.id !== me?.id && (
                <Pressable
                  testID={`delete-user-${item.id}`}
                  onPress={() => onDeleteUser(item)}
                  style={styles.deleteButton}
                  accessibilityLabel="Delete user"
                >
                  <Icon name="trash-2" size={13} color={colors.danger} />
                  <Text style={styles.deleteText}>{t("admin.user.delete.button")}</Text>
                </Pressable>
              )}
            </View>
          )}
          ListEmptyComponent={<Text style={styles.empty}>No users yet</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { padding: spacing.xl, alignItems: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  avatar: { width: 44, height: 44, backgroundColor: colors.surfaceSecondary, borderWidth: 2, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.brand, fontSize: 16, fontWeight: "900" },
  name: { color: colors.onSurface, fontSize: 14, fontWeight: "900", letterSpacing: 0.5 },
  email: { color: colors.muted, fontSize: 11, marginTop: 2 },
  meta: { color: colors.brand, fontSize: 10, marginTop: 2, letterSpacing: 1, fontWeight: "800" },
  roleBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 6, borderWidth: 2, borderColor: colors.border },
  roleBadgeActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  roleText: { color: colors.onSurface, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  roleTextActive: { color: colors.onBrand },
  deleteButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderWidth: 2,
    borderColor: colors.danger,
  },
  deleteText: { color: colors.danger, fontSize: 9, fontWeight: "900", letterSpacing: 0.7 },
  empty: { color: colors.muted, textAlign: "center", padding: spacing.xl, letterSpacing: 2, fontWeight: "800" },
});
