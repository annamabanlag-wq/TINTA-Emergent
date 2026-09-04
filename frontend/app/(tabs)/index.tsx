import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ScrollView, ActivityIndicator, TextInput, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Icon from "@react-native-vector-icons/feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, Artist } from "../../src/api";
import { useSession } from "../../src/session";
import { colors, spacing } from "../../src/theme";

const STYLES = ["All", "Blackwork", "Fineline", "Traditional", "Realism", "Japanese", "Neo-Traditional", "Geometric"];

export default function Discover() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useSession();
  const [style, setStyle] = useState("All");
  const [q, setQ] = useState("");
  const [artists, setArtists] = useState<Artist[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (style && style !== "All") params.set("style", style);
      if (q) params.set("q", q);
      const data = await api<Artist[]>(`/artists?${params.toString()}`);
      setArtists(data);
    } catch (e) {
      setArtists([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [style, q]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(); };

  return (
    <View style={styles.root}>
      {/* Sticky header */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.hi}>HELLO, {user?.name?.split(" ")[0]?.toUpperCase() ?? "INK"}</Text>
            <Text style={styles.headerTitle}>DISCOVER</Text>
          </View>
          <View style={styles.logo}><Text style={styles.logoText}>INK</Text></View>
        </View>

        <View style={styles.searchBox}>
          <Icon name="search" size={16} color={colors.muted} />
          <TextInput
            testID="discover-search-input"
            value={q}
            onChangeText={setQ}
            placeholder="SEARCH ARTISTS"
            placeholderTextColor={colors.muted}
            style={styles.searchInput}
            autoCapitalize="none"
          />
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
          style={styles.chipScroll}
        >
          {STYLES.map((s) => {
            const active = s === style;
            return (
              <Pressable
                key={s}
                testID={`style-chip-${s.toLowerCase()}`}
                onPress={() => setStyle(s)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{s.toUpperCase()}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} size="large" /></View>
      ) : artists.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyBig}>NO{"\n"}ARTISTS{"\n"}FOUND</Text>
          <Pressable onPress={() => { setStyle("All"); setQ(""); }} style={styles.resetBtn}>
            <Text style={styles.resetText}>RESET FILTERS</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={artists}
          keyExtractor={(a) => a.id}
          contentContainerStyle={{ paddingBottom: spacing.xl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
          renderItem={({ item }) => (
            <Pressable
              testID={`artist-card-${item.id}`}
              onPress={() => router.push(`/artist/${item.id}`)}
              style={styles.card}
            >
              <View style={styles.cardImageWrap}>
                <Image source={item.hero} style={StyleSheet.absoluteFill} contentFit="cover" />
                <LinearGradient colors={["transparent", "rgba(10,10,10,0.95)"]} style={StyleSheet.absoluteFill} />
                <View style={styles.cardOverlay}>
                  <View style={styles.cardTopRow}>
                    <View style={styles.ratingPill}>
                      <Icon name="star" size={10} color={colors.warning} />
                      <Text style={styles.ratingText}>{item.rating.toFixed(1)}</Text>
                    </View>
                    <Text style={styles.cardRate}>${item.rate_per_hour}/HR</Text>
                  </View>
                  <View>
                    <Text style={styles.cardName}>{item.name.toUpperCase()}</Text>
                    <Text style={styles.cardMeta}>{item.city.toUpperCase()} · {item.studio.toUpperCase()}</Text>
                    <View style={styles.styleRow}>
                      {item.styles.slice(0, 3).map((s) => (
                        <View key={s} style={styles.styleTag}>
                          <Text style={styles.styleTagText}>{s.toUpperCase()}</Text>
                        </View>
                      ))}
                    </View>
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
  header: {
    backgroundColor: colors.surface,
    borderBottomWidth: 2,
    borderBottomColor: colors.borderStrong,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  hi: { color: colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 2 },
  headerTitle: { color: colors.onSurface, fontSize: 36, fontWeight: "900", letterSpacing: 2 },
  logo: { borderWidth: 2, borderColor: colors.brand, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  logoText: { color: colors.brand, fontSize: 16, fontWeight: "900", letterSpacing: 3 },
  searchBox: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderWidth: 2, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 10,
  },
  searchInput: { flex: 1, color: colors.onSurface, fontSize: 14, letterSpacing: 1, padding: 0 },
  chipScroll: {},
  chipRow: { gap: spacing.sm, paddingRight: spacing.lg },
  chip: {
    height: 36, paddingHorizontal: spacing.md, justifyContent: "center", flexShrink: 0,
    borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { color: colors.onSurfaceSecondary, fontSize: 11, fontWeight: "800", letterSpacing: 1.5 },
  chipTextActive: { color: colors.onBrand },
  card: {
    marginTop: spacing.md, marginHorizontal: spacing.lg,
    borderWidth: 2, borderColor: colors.borderStrong,
  },
  cardImageWrap: { aspectRatio: 3 / 4, backgroundColor: colors.surfaceSecondary },
  cardOverlay: { flex: 1, padding: spacing.md, justifyContent: "space-between" },
  cardTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  ratingPill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.borderStrong,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
  },
  ratingText: { color: colors.onSurface, fontSize: 11, fontWeight: "900" },
  cardRate: { color: colors.brand, fontSize: 14, fontWeight: "900", letterSpacing: 1 },
  cardName: { color: colors.onSurface, fontSize: 28, fontWeight: "900", letterSpacing: 1 },
  cardMeta: { color: colors.onSurfaceTertiary, fontSize: 11, fontWeight: "700", letterSpacing: 1, marginTop: 2 },
  styleRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.sm },
  styleTag: { borderWidth: 1, borderColor: colors.onSurface, paddingHorizontal: 6, paddingVertical: 2 },
  styleTagText: { color: colors.onSurface, fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.lg },
  emptyBig: { color: colors.onSurface, fontSize: 48, fontWeight: "900", letterSpacing: 2, textAlign: "center", lineHeight: 52 },
  resetBtn: { backgroundColor: colors.brand, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  resetText: { color: colors.onBrand, fontSize: 13, fontWeight: "900", letterSpacing: 2 },
});
