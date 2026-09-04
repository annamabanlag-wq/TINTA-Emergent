import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator } from "react-native";
import { useRouter, Stack } from "expo-router";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Icon from "@react-native-vector-icons/feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, Artist } from "../src/api";
import { useSession } from "../src/session";
import { useFavorites } from "../src/favorites";
import { colors, spacing } from "../src/theme";

export default function FavoritesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token } = useSession();
  const { toggle, refresh } = useFavorites();
  const [items, setItems] = useState<Artist[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await api<Artist[]>("/favorites", {}, token);
      setItems(data);
    } catch { setItems([]); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const remove = async (id: string) => {
    await toggle(id);
    setItems((prev) => prev.filter((a) => a.id !== id));
    refresh();
  };

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="fav-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Icon name="arrow-left" size={20} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>WISHLIST</Text>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} size="large" /></View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Icon name="heart" size={48} color={colors.brand} />
          <Text style={styles.emptyBig}>NO{"\n"}FAVORITES{"\n"}YET</Text>
          <Text style={styles.emptySub}>TAP THE HEART ON ANY ARTIST TO SAVE THEM FOR LATER</Text>
          <Pressable testID="fav-explore-cta" onPress={() => router.replace("/(tabs)")} style={styles.cta}>
            <Text style={styles.ctaText}>EXPLORE ARTISTS</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(a) => a.id}
          contentContainerStyle={{ paddingBottom: spacing.xl }}
          renderItem={({ item }) => (
            <Pressable
              testID={`fav-card-${item.id}`}
              onPress={() => router.push(`/artist/${item.id}`)}
              style={styles.card}
            >
              <View style={styles.cardImageWrap}>
                <Image source={item.hero} style={StyleSheet.absoluteFill} contentFit="cover" />
                <LinearGradient colors={["transparent", "rgba(10,10,10,0.95)"]} style={StyleSheet.absoluteFill} />
                <Pressable testID={`fav-remove-${item.id}`} onPress={() => remove(item.id)} style={styles.heartBtn}>
                  <Icon name="heart" size={20} color={colors.brand} />
                </Pressable>
                <View style={styles.cardOverlay}>
                  <View>
                    <Text style={styles.cardName}>{item.name.toUpperCase()}</Text>
                    <Text style={styles.cardMeta}>{item.city.toUpperCase()} · ${item.rate_per_hour}/HR</Text>
                  </View>
                </View>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, paddingBottom: spacing.md, borderBottomWidth: 2, borderBottomColor: colors.borderStrong },
  iconBtn: { width: 40, height: 40, borderWidth: 2, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  title: { color: colors.onSurface, fontSize: 32, fontWeight: "900", letterSpacing: 2 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  emptyBig: { color: colors.onSurface, fontSize: 40, fontWeight: "900", letterSpacing: 2, textAlign: "center", lineHeight: 44 },
  emptySub: { color: colors.muted, fontSize: 12, fontWeight: "800", letterSpacing: 1.5, textAlign: "center", paddingHorizontal: spacing.lg },
  cta: { backgroundColor: colors.brand, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, marginTop: spacing.md },
  ctaText: { color: colors.onBrand, fontSize: 13, fontWeight: "900", letterSpacing: 2 },
  card: { marginTop: spacing.md, marginHorizontal: spacing.lg, borderWidth: 2, borderColor: colors.borderStrong },
  cardImageWrap: { aspectRatio: 2, backgroundColor: colors.surfaceSecondary },
  heartBtn: { position: "absolute", top: spacing.md, right: spacing.md, width: 40, height: 40, backgroundColor: "rgba(10,10,10,0.7)", borderWidth: 2, borderColor: colors.brand, alignItems: "center", justifyContent: "center" },
  cardOverlay: { flex: 1, padding: spacing.md, justifyContent: "flex-end" },
  cardName: { color: colors.onSurface, fontSize: 28, fontWeight: "900", letterSpacing: 1 },
  cardMeta: { color: colors.onSurfaceTertiary, fontSize: 11, fontWeight: "700", letterSpacing: 1, marginTop: 2 },
});
