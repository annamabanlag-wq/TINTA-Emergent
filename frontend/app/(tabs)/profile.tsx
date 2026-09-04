import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import Icon from "@react-native-vector-icons/feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../../src/session";
import { colors, spacing } from "../../src/theme";

export default function ProfileTab() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signOut } = useSession();

  const doSignOut = async () => {
    await signOut();
    router.replace("/(auth)/sign-in");
  };

  const initials = (user?.name ?? "IN")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl }}>
      <View style={styles.header}>
        <Text style={styles.title}>PROFILE</Text>
      </View>

      <View style={styles.userBlock}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{initials}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name} testID="profile-name">{user?.name?.toUpperCase()}</Text>
          <Text style={styles.email} testID="profile-email">{user?.email}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>ACCOUNT</Text>
        <Row icon="heart" label="MY WISHLIST" onPress={() => router.push("/favorites")} testID="profile-favorites-row" />
        <Row icon="calendar" label="MY BOOKINGS" onPress={() => router.push("/(tabs)/bookings")} testID="profile-bookings-row" />
        <Row icon="message-square" label="MESSAGES" onPress={() => router.push("/(tabs)/messages")} testID="profile-messages-row" />
        <Row icon="search" label="DISCOVER ARTISTS" onPress={() => router.push("/(tabs)")} testID="profile-discover-row" />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>SUPPORT</Text>
        <Row icon="help-circle" label="HELP CENTER" onPress={() => {}} testID="profile-help-row" />
        <Row icon="shield" label="PRIVACY & TERMS" onPress={() => {}} testID="profile-privacy-row" />
      </View>

      <Pressable testID="signout-button" onPress={doSignOut} style={styles.signOut}>
        <Icon name="log-out" size={16} color={colors.brand} />
        <Text style={styles.signOutText}>SIGN OUT</Text>
      </Pressable>

      <Text style={styles.version}>INKED v1.0.0</Text>
    </ScrollView>
  );
}

function Row({ icon, label, onPress, testID }: { icon: any; label: string; onPress: () => void; testID: string }) {
  return (
    <Pressable testID={testID} onPress={onPress} style={styles.row}>
      <Icon name={icon} size={18} color={colors.onSurface} />
      <Text style={styles.rowLabel}>{label}</Text>
      <Icon name="chevron-right" size={18} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 2, borderBottomColor: colors.borderStrong },
  title: { color: colors.onSurface, fontSize: 36, fontWeight: "900", letterSpacing: 2 },
  userBlock: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderBottomWidth: 2, borderBottomColor: colors.borderStrong },
  avatar: { width: 72, height: 72, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.borderStrong },
  avatarText: { color: colors.onBrand, fontSize: 28, fontWeight: "900", letterSpacing: 2 },
  name: { color: colors.onSurface, fontSize: 22, fontWeight: "900", letterSpacing: 1 },
  email: { color: colors.muted, fontSize: 12, marginTop: 2 },
  section: { marginTop: spacing.lg, borderTopWidth: 2, borderTopColor: colors.borderStrong },
  sectionTitle: { color: colors.brand, fontSize: 11, fontWeight: "900", letterSpacing: 3, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: colors.surfaceSecondary },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  rowLabel: { flex: 1, color: colors.onSurface, fontSize: 13, fontWeight: "800", letterSpacing: 1.5 },
  signOut: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, marginHorizontal: spacing.lg, marginTop: spacing.xl, paddingVertical: spacing.md, borderWidth: 2, borderColor: colors.brand },
  signOutText: { color: colors.brand, fontSize: 13, fontWeight: "900", letterSpacing: 2 },
  version: { color: colors.muted, fontSize: 10, textAlign: "center", marginTop: spacing.xl, letterSpacing: 2 },
});
