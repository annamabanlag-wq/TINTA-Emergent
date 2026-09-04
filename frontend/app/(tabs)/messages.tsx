import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, Thread } from "../../src/api";
import { useSession } from "../../src/session";
import { colors, spacing } from "../../src/theme";

export default function MessagesTab() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token } = useSession();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<Thread[]>("/threads", {}, token);
      setThreads(data);
    } catch { setThreads([]); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.title}>MESSAGES</Text>
      </View>
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} size="large" /></View>
      ) : threads.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyBig}>NO{"\n"}MESSAGES</Text>
          <Pressable testID="explore-messages-cta" onPress={() => router.push("/(tabs)")} style={styles.cta}>
            <Text style={styles.ctaText}>EXPLORE ARTISTS</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={threads}
          keyExtractor={(t) => t.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brand} />}
          renderItem={({ item }) => (
            <Pressable
              testID={`thread-row-${item.artist_id}`}
              onPress={() => router.push(`/chat/${item.artist_id}`)}
              style={styles.row}
            >
              <Image source={item.artist_avatar} style={styles.avatar} contentFit="cover" />
              <View style={styles.rowContent}>
                <Text style={styles.name}>{item.artist_name.toUpperCase()}</Text>
                <Text style={styles.last} numberOfLines={1}>{item.last_message}</Text>
              </View>
              <Text style={styles.time}>{new Date(item.last_at).toLocaleDateString()}</Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 2, borderBottomColor: colors.borderStrong },
  title: { color: colors.onSurface, fontSize: 36, fontWeight: "900", letterSpacing: 2 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.lg },
  emptyBig: { color: colors.onSurface, fontSize: 48, fontWeight: "900", letterSpacing: 2, textAlign: "center", lineHeight: 52 },
  cta: { backgroundColor: colors.brand, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  ctaText: { color: colors.onBrand, fontSize: 13, fontWeight: "900", letterSpacing: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.divider },
  avatar: { width: 56, height: 56, backgroundColor: colors.surfaceSecondary, borderWidth: 2, borderColor: colors.borderStrong },
  rowContent: { flex: 1, gap: 4 },
  name: { color: colors.onSurface, fontSize: 15, fontWeight: "900", letterSpacing: 1 },
  last: { color: colors.muted, fontSize: 13 },
  time: { color: colors.muted, fontSize: 10, fontWeight: "700", letterSpacing: 1 },
});
