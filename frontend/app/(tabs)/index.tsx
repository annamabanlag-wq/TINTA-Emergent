import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ScrollView, ActivityIndicator, TextInput, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Icon from "@react-native-vector-icons/feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, Artist, Featured } from "../../src/api";
import { useSession } from "../../src/session";
import { useFavorites } from "../../src/favorites";
import { useI18n } from "../../src/i18n";
import { colors, spacing } from "../../src/theme";
import { fmtPHP } from "../../src/currency";

const STYLES = ["All", "Blackwork", "Fineline", "Traditional", "Realism", "Japanese", "Neo-Traditional", "Geometric"];

function useCountdown(endIso: string) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);
  const end = new Date(endIso).getTime();
  let diff = Math.max(0, end - now);
  const days = Math.floor(diff / 86400000); diff -= days * 86400000;
  const hours = Math.floor(diff / 3600000); diff -= hours * 3600000;
  const mins = Math.floor(diff / 60000);
  return `${days}D ${hours}H ${mins}M`;
}

function FeaturedCard({ featured, onPress }: { featured: Featured; onPress: () => void }) {
  const countdown = useCountdown(featured.deal_ends_at);
  const { t } = useI18n();
  return (
    <Pressable testID="featured-artist-card" onPress={onPress} style={styles.featWrap}>
      <View style={styles.featImage}>
        <Image source={featured.artist.hero} style={StyleSheet.absoluteFill} contentFit="cover" />
        <LinearGradient colors={["rgba(10,10,10,0.5)", "rgba(10,10,10,0.95)"]} style={StyleSheet.absoluteFill} />
        <View style={styles.featContent}>
          <View style={styles.featBadgeRow}>
            <View style={styles.featBadge}>
              <Icon name="zap" size={12} color={colors.onBrand} />
              <Text style={styles.featBadgeText}>{t("discover.featured")}</Text>
            </View>
            <View style={styles.featDiscount}>
              <Text style={styles.featDiscountText}>-{featured.discount_pct}%</Text>
            </View>
          </View>
          <View>
            <Text style={styles.featName}>{featured.artist.name.toUpperCase()}</Text>
            <Text style={styles.featStory}>{featured.story}</Text>
            <View style={styles.featBottom}>
              <View>
                <Text style={styles.featMetaLabel}>{t("discover.featured.endsIn")}</Text>
                <Text style={styles.featMetaValue}>{countdown}</Text>
              </View>
              <View style={styles.featCta}>
                <Text style={styles.featCtaText}>{t("discover.featured.cta")}</Text>
                <Icon name="arrow-right" size={16} color={colors.onBrand} />
              </View>
            </View>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

export default function Discover() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useSession();
  const { isFavorite, toggle } = useFavorites();
  const { t } = useI18n();
  const [style, setStyle] = useState("All");
  const [q, setQ] = useState("");
  const [searchText, setSearchText] = useState("");
  const [artists, setArtists] = useState<Artist[]>([]);
  const [featured, setFeatured] = useState<Featured | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setError("");
      const params = new URLSearchParams();
      if (style && style !== "All") params.set("style", style);
      if (q) params.set("q", q);
      const [data, f] = await Promise.all([
        api<Artist[]>(`/artists?${params.toString()}`),
        api<Featured>(`/featured`).catch(() => null),
      ]);
      setArtists(data);
      setFeatured(f);
    } catch (e: any) {
      setError(e?.message || "Could not load artists. Please try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [style, q]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const timer = setTimeout(() => setQ(searchText.trim()), 350);
    return () => clearTimeout(timer);
  }, [searchText]);

  const onRefresh = () => { setRefreshing(true); load(); };

  const showFeatured = featured && style === "All" && !q;

  return (
    <View style={styles.root}>
      {/* Sticky header */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.headerRow}>
          <View>
            <View style={styles.brandRow}>
              <Text style={styles.brandText}>TINTA</Text>
              <View style={styles.liveMark}><View style={styles.liveDot} /></View>
            </View>
            <Text style={styles.hi}>WELCOME BACK, {user?.name?.split(" ")[0]?.toUpperCase() ?? "INK"}</Text>
            <Text style={styles.headerTitle}>FIND YOUR NEXT INK.</Text>
          </View>
          <Pressable testID="home-profile-button" onPress={() => router.push("/(tabs)/profile")} style={styles.logo}>
            <Icon name="user" size={17} color={colors.brand} />
          </Pressable>
        </View>

        <Text style={styles.homeSub}>DISCOVER ARTISTS, ORIGINAL WORK AND YOUR NEXT SESSION.</Text>
        <View style={styles.searchBox}>
          <Icon name="search" size={16} color={colors.muted} />
          <TextInput
            testID="discover-search-input"
            value={searchText}
            onChangeText={setSearchText}
            placeholder="SEARCH ARTIST, STYLE OR CITY"
            placeholderTextColor={colors.muted}
            style={styles.searchInput}
            autoCapitalize="none"
          />
          {searchText ? <Pressable testID="discover-clear-search" onPress={() => setSearchText("")} hitSlop={10}>
            <Icon name="x-circle" size={16} color={colors.muted} />
          </Pressable> : null}
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

        <View style={styles.quickRow}>
          <Pressable testID="quick-favorites" onPress={() => router.push("/favorites")} style={styles.quickCard}>
            <View style={styles.quickIcon}><Icon name="heart" size={15} color={colors.brand} /></View>
            <View style={styles.quickBody}>
              <Text style={styles.quickLabel}>SAVED ARTISTS</Text>
              <Text style={styles.quickHint}>YOUR PICKS</Text>
            </View>
            <Icon name="chevron-right" size={16} color={colors.muted} />
          </Pressable>
          <Pressable testID="quick-bookings" onPress={() => router.push("/(tabs)/bookings")} style={styles.quickCard}>
            <View style={styles.quickIcon}><Icon name="calendar" size={15} color={colors.brand} /></View>
            <View style={styles.quickBody}>
              <Text style={styles.quickLabel}>MY BOOKINGS</Text>
              <Text style={styles.quickHint}>UPCOMING SESSIONS</Text>
            </View>
            <Icon name="chevron-right" size={16} color={colors.muted} />
          </Pressable>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} size="large" /></View>
      ) : artists.length === 0 ? (
        <View style={styles.center}>
          {error ? (
            <>
              <Icon name="wifi-off" size={34} color={colors.brand} />
              <Text style={styles.errorTitle}>CONNECTION ISSUE</Text>
              <Text style={styles.errorText}>{error}</Text>
              <Pressable testID="discover-retry-button" onPress={load} style={styles.resetBtn}>
                <Text style={styles.resetText}>RETRY</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.emptyBig}>{t("discover.empty")}</Text>
              <Pressable onPress={() => { setStyle("All"); setSearchText(""); }} style={styles.resetBtn}>
                <Text style={styles.resetText}>{t("discover.reset")}</Text>
              </Pressable>
            </>
          )}
        </View>
      ) : (
        <FlatList
          data={artists}
          keyExtractor={(a) => a.id}
          contentContainerStyle={{ paddingBottom: spacing.xl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
          ListHeaderComponent={
            <View>
              {error ? (
                <View style={styles.errorBanner} testID="discover-error-banner">
                  <Icon name="alert-circle" size={15} color={colors.brand} />
                  <Text style={styles.errorBannerText}>{error}</Text>
                  <Pressable testID="discover-retry-inline" onPress={load} hitSlop={10}>
                    <Text style={styles.errorRetry}>RETRY</Text>
                  </Pressable>
                </View>
              ) : null}
              {showFeatured ? <FeaturedCard featured={featured!} onPress={() => router.push(`/artist/${featured!.artist.id}`)} /> : null}
            </View>
          }
          renderItem={({ item }) => {
            const fav = isFavorite(item.id);
            return (
              <View style={styles.cardWrapper}>
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
                        <Text style={styles.cardRate}>{fmtPHP(item.rate_per_hour)}/HR</Text>
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
                {/* Heart lives OUTSIDE the card Pressable to prevent tap bubbling */}
                <Pressable
                  testID={`favorite-toggle-${item.id}`}
                  onPress={() => toggle(item.id)}
                  hitSlop={12}
                  style={styles.heartBtn}
                >
                  <Icon name="heart" size={20} color={fav ? colors.brand : colors.onSurface} />
                </Pressable>
              </View>
            );
          }}
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
  brandRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  brandText: { color: colors.onSurface, fontSize: 24, fontWeight: "900", letterSpacing: 4 },
  liveMark: { width: 18, height: 18, borderWidth: 1, borderColor: colors.brand, alignItems: "center", justifyContent: "center" },
  liveDot: { width: 6, height: 6, backgroundColor: colors.brand },
  hi: { color: colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 2 },
  headerTitle: { color: colors.onSurface, fontSize: 38, fontWeight: "900", letterSpacing: 1.5, lineHeight: 42 },
  homeSub: { color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 1.4, lineHeight: 15 },
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
  quickRow: { flexDirection: "row", gap: spacing.sm },
  quickCard: { flex: 1, minHeight: 64, flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  quickIcon: { width: 32, height: 32, borderWidth: 1, borderColor: colors.brand, alignItems: "center", justifyContent: "center" },
  quickBody: { flex: 1 },
  quickLabel: { color: colors.onSurface, fontSize: 9, fontWeight: "900", letterSpacing: 1.2 },
  quickHint: { color: colors.muted, fontSize: 8, fontWeight: "800", letterSpacing: 1, marginTop: 2 },
  cardWrapper: { position: "relative" },
  card: {
    marginTop: spacing.md, marginHorizontal: spacing.lg,
    borderWidth: 2, borderColor: colors.borderStrong,
  },
  cardImageWrap: { aspectRatio: 0.82, backgroundColor: colors.surfaceSecondary },
  heartBtn: {
    position: "absolute", top: spacing.md + spacing.md, left: spacing.lg + spacing.md,
    width: 40, height: 40, backgroundColor: "rgba(10,10,10,0.7)",
    borderWidth: 2, borderColor: colors.borderStrong,
    alignItems: "center", justifyContent: "center",
    zIndex: 2,
  },
  cardOverlay: { flex: 1, padding: spacing.md, justifyContent: "space-between" },
  cardTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginLeft: 52 },
  ratingPill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.borderStrong,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
  },
  ratingText: { color: colors.onSurface, fontSize: 11, fontWeight: "900" },
  cardRate: { color: colors.brand, fontSize: 14, fontWeight: "900", letterSpacing: 1 },
  cardName: { color: colors.onSurface, fontSize: 23, fontWeight: "900", letterSpacing: 1 },
  cardMeta: { color: colors.onSurfaceTertiary, fontSize: 11, fontWeight: "700", letterSpacing: 1, marginTop: 2 },
  styleRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.sm },
  styleTag: { borderWidth: 1, borderColor: colors.onSurface, paddingHorizontal: 6, paddingVertical: 2 },
  styleTagText: { color: colors.onSurface, fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.lg },
  errorTitle: { color: colors.onSurface, fontSize: 22, fontWeight: "900", letterSpacing: 2, textAlign: "center" },
  errorText: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: "center", maxWidth: 320 },
  errorBanner: { marginTop: spacing.md, marginHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 2, borderColor: colors.brand, backgroundColor: colors.surfaceSecondary, padding: spacing.sm },
  errorBannerText: { color: colors.onSurfaceSecondary, flex: 1, fontSize: 11, lineHeight: 15 },
  errorRetry: { color: colors.brand, fontSize: 10, fontWeight: "900", letterSpacing: 1.5 },
  emptyBig: { color: colors.onSurface, fontSize: 48, fontWeight: "900", letterSpacing: 2, textAlign: "center", lineHeight: 52 },
  resetBtn: { backgroundColor: colors.brand, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  resetText: { color: colors.onBrand, fontSize: 13, fontWeight: "900", letterSpacing: 2 },

  // Featured
  featWrap: { marginTop: spacing.md, marginHorizontal: spacing.lg, borderWidth: 2, borderColor: colors.brand, shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  featImage: { aspectRatio: 4 / 5, backgroundColor: colors.surfaceSecondary },
  featContent: { flex: 1, padding: spacing.md, justifyContent: "space-between" },
  featBadgeRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  featBadge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.brand, paddingHorizontal: spacing.sm, paddingVertical: 6, borderWidth: 2, borderColor: colors.borderStrong },
  featBadgeText: { color: colors.onBrand, fontSize: 11, fontWeight: "900", letterSpacing: 2 },
  featDiscount: { backgroundColor: colors.onSurface, paddingHorizontal: spacing.sm, paddingVertical: 6, borderWidth: 2, borderColor: colors.borderStrong },
  featDiscountText: { color: colors.surface, fontSize: 14, fontWeight: "900", letterSpacing: 1 },
  featName: { color: colors.onSurface, fontSize: 40, fontWeight: "900", letterSpacing: 2, marginBottom: spacing.sm },
  featStory: { color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 18, marginBottom: spacing.md },
  featBottom: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  featMetaLabel: { color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 2 },
  featMetaValue: { color: colors.onSurface, fontSize: 18, fontWeight: "900", letterSpacing: 1, marginTop: 2 },
  featCta: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.brand, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 2, borderColor: colors.brand },
  featCtaText: { color: colors.onBrand, fontSize: 13, fontWeight: "900", letterSpacing: 2 },
});
