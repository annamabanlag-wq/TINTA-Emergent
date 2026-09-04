import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Modal } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Icon from "@react-native-vector-icons/feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, Artist, Review } from "../../src/api";
import { useSession } from "../../src/session";
import { useFavorites } from "../../src/favorites";
import { colors, spacing } from "../../src/theme";

export default function ArtistDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token } = useSession();
  const { isFavorite, toggle } = useFavorites();
  const [artist, setArtist] = useState<Artist | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [posting, setPosting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [a, r] = await Promise.all([
        api<Artist>(`/artists/${id}`),
        api<Review[]>(`/artists/${id}/reviews`),
      ]);
      setArtist(a);
      setReviews(r);
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const submitReview = async () => {
    if (!comment) return;
    setPosting(true);
    try {
      await api("/reviews", { method: "POST", body: JSON.stringify({ artist_id: id, rating, comment }) }, token);
      setComment(""); setRating(5); setReviewOpen(false);
      load();
    } finally { setPosting(false); }
  };

  if (loading || !artist) {
    return <View style={styles.center}><ActivityIndicator color={colors.brand} size="large" /></View>;
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ paddingBottom: 100 + insets.bottom }} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={styles.hero}>
          <Image source={artist.hero} style={StyleSheet.absoluteFill} contentFit="cover" />
          <LinearGradient colors={["rgba(10,10,10,0.6)", "transparent", colors.surface]} style={StyleSheet.absoluteFill} />
          <View style={[styles.heroTop, { paddingTop: insets.top + spacing.sm }]}>
            <Pressable testID="back-button" onPress={() => router.back()} style={styles.iconBtn}>
              <Icon name="arrow-left" size={20} color={colors.onSurface} />
            </Pressable>
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <Pressable
                testID="artist-heart-button"
                onPress={() => toggle(artist.id)}
                style={styles.iconBtn}
              >
                <Icon name="heart" size={20} color={isFavorite(artist.id) ? colors.brand : colors.onSurface} />
              </Pressable>
              <Pressable
                testID="message-artist-button"
                onPress={() => router.push(`/chat/${artist.id}`)}
                style={styles.iconBtn}
              >
                <Icon name="message-square" size={20} color={colors.onSurface} />
              </Pressable>
            </View>
          </View>
          <View style={styles.heroBottom}>
            <Text style={styles.artistName}>{artist.name.toUpperCase()}</Text>
            <Text style={styles.artistHandle}>{artist.handle}</Text>
          </View>
        </View>

        {/* Meta */}
        <View style={styles.metaRow}>
          <View style={styles.metaCell}>
            <Text style={styles.metaValue}>{artist.rating.toFixed(1)}</Text>
            <Text style={styles.metaLabel}>RATING</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaValue}>{artist.reviews_count}</Text>
            <Text style={styles.metaLabel}>REVIEWS</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaValue}>${artist.rate_per_hour}</Text>
            <Text style={styles.metaLabel}>PER HOUR</Text>
          </View>
        </View>

        {/* Studio */}
        <View style={styles.studioRow}>
          <Icon name="map-pin" size={14} color={colors.brand} />
          <Text style={styles.studioText}>{artist.studio.toUpperCase()} · {artist.city.toUpperCase()}</Text>
        </View>

        {/* Bio */}
        <View style={styles.block}>
          <Text style={styles.blockTitle}>ABOUT</Text>
          <Text style={styles.bio}>{artist.bio}</Text>
        </View>

        {/* Styles */}
        <View style={styles.block}>
          <Text style={styles.blockTitle}>STYLES</Text>
          <View style={styles.stylesRow}>
            {artist.styles.map((s) => (
              <View key={s} style={styles.styleTag}>
                <Text style={styles.styleTagText}>{s.toUpperCase()}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Portfolio grid */}
        <View style={styles.block}>
          <Text style={styles.blockTitle}>PORTFOLIO</Text>
          <View style={styles.portfolioGrid}>
            {artist.portfolio.map((p, i) => (
              <View key={i} style={styles.portItem}>
                <Image source={p} style={StyleSheet.absoluteFill} contentFit="cover" />
              </View>
            ))}
          </View>
        </View>

        {/* Reviews */}
        <View style={styles.block}>
          <View style={styles.reviewHead}>
            <Text style={styles.blockTitle}>REVIEWS</Text>
            <Pressable testID="write-review-button" onPress={() => setReviewOpen(true)}>
              <Text style={styles.writeReview}>WRITE +</Text>
            </Pressable>
          </View>
          {reviews.length === 0 ? (
            <Text style={styles.noReviews}>NO REVIEWS YET. BE THE FIRST.</Text>
          ) : (
            reviews.map((r) => (
              <View key={r.id} style={styles.reviewCard} testID={`review-${r.id}`}>
                <View style={styles.reviewHeadRow}>
                  <Text style={styles.reviewer}>{r.user_name.toUpperCase()}</Text>
                  <View style={styles.starsRow}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Icon key={n} name="star" size={12} color={n <= r.rating ? colors.warning : colors.info} />
                    ))}
                  </View>
                </View>
                <Text style={styles.reviewText}>{r.comment}</Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {/* Sticky Book CTA */}
      <View style={[styles.stickyBar, { paddingBottom: insets.bottom + spacing.md }]}>
        <Pressable
          testID="book-session-button"
          onPress={() => router.push(`/book/${artist.id}`)}
          style={({ pressed }) => [styles.bookBtn, pressed && { backgroundColor: colors.brandSecondary }]}
        >
          <Text style={styles.bookText}>BOOK SESSION</Text>
          <Icon name="arrow-right" size={20} color={colors.onBrand} />
        </Pressable>
      </View>

      {/* Review modal */}
      <Modal visible={reviewOpen} transparent animationType="fade" onRequestClose={() => setReviewOpen(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>WRITE REVIEW</Text>
            <View style={styles.starsInputRow}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Pressable key={n} testID={`star-${n}`} onPress={() => setRating(n)}>
                  <Icon name="star" size={32} color={n <= rating ? colors.warning : colors.info} />
                </Pressable>
              ))}
            </View>
            <TextInput
              testID="review-comment-input"
              placeholder="SHARE YOUR EXPERIENCE"
              placeholderTextColor={colors.muted}
              value={comment}
              onChangeText={setComment}
              multiline
              style={styles.reviewInput}
            />
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <Pressable testID="review-cancel" onPress={() => setReviewOpen(false)} style={[styles.modalBtn, { borderColor: colors.border, flex: 1 }]}>
                <Text style={styles.modalBtnText}>CANCEL</Text>
              </Pressable>
              <Pressable
                testID="review-submit"
                onPress={submitReview}
                disabled={!comment || posting}
                style={[styles.modalBtn, { backgroundColor: colors.brand, borderColor: colors.brand, flex: 1, opacity: (!comment || posting) ? 0.5 : 1 }]}
              >
                <Text style={[styles.modalBtnText, { color: colors.onBrand }]}>{posting ? "POSTING..." : "SUBMIT"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  hero: { height: 420, backgroundColor: colors.surfaceSecondary },
  heroTop: { position: "absolute", left: 0, right: 0, top: 0, flexDirection: "row", justifyContent: "space-between", padding: spacing.md },
  iconBtn: { width: 40, height: 40, backgroundColor: "rgba(10,10,10,0.6)", borderWidth: 2, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  heroBottom: { position: "absolute", left: 0, right: 0, bottom: 0, padding: spacing.lg },
  artistName: { color: colors.onSurface, fontSize: 44, fontWeight: "900", letterSpacing: 2, lineHeight: 46 },
  artistHandle: { color: colors.brand, fontSize: 14, fontWeight: "800", letterSpacing: 2, marginTop: 4 },
  metaRow: { flexDirection: "row", borderBottomWidth: 2, borderBottomColor: colors.borderStrong },
  metaCell: { flex: 1, alignItems: "center", paddingVertical: spacing.md, borderRightWidth: 1, borderRightColor: colors.divider },
  metaValue: { color: colors.onSurface, fontSize: 24, fontWeight: "900" },
  metaLabel: { color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 2, marginTop: 2 },
  studioRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  studioText: { color: colors.onSurface, fontSize: 12, fontWeight: "800", letterSpacing: 1.5 },
  block: { padding: spacing.lg, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  blockTitle: { color: colors.brand, fontSize: 12, fontWeight: "900", letterSpacing: 3 },
  bio: { color: colors.onSurfaceSecondary, fontSize: 14, lineHeight: 22 },
  stylesRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  styleTag: { borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: spacing.md, paddingVertical: 6 },
  styleTagText: { color: colors.onSurface, fontSize: 11, fontWeight: "900", letterSpacing: 1.5 },
  portfolioGrid: { flexDirection: "row", flexWrap: "wrap", gap: 2 },
  portItem: { width: "49.5%", aspectRatio: 1, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  reviewHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  writeReview: { color: colors.onSurface, fontSize: 12, fontWeight: "900", letterSpacing: 2 },
  noReviews: { color: colors.muted, fontSize: 12, fontWeight: "800", letterSpacing: 1 },
  reviewCard: { borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  reviewHeadRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  reviewer: { color: colors.onSurface, fontSize: 12, fontWeight: "900", letterSpacing: 1 },
  starsRow: { flexDirection: "row", gap: 2 },
  reviewText: { color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 18 },
  stickyBar: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, borderTopWidth: 2, borderTopColor: colors.borderStrong, padding: spacing.md },
  bookBtn: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.brand, paddingHorizontal: spacing.lg, paddingVertical: 16 },
  bookText: { color: colors.onBrand, fontSize: 16, fontWeight: "900", letterSpacing: 3 },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.85)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  modalCard: { width: "100%", backgroundColor: colors.surfaceSecondary, borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.lg, gap: spacing.md },
  modalTitle: { color: colors.onSurface, fontSize: 24, fontWeight: "900", letterSpacing: 2 },
  starsInputRow: { flexDirection: "row", gap: spacing.sm, justifyContent: "center", paddingVertical: spacing.md },
  reviewInput: { minHeight: 100, borderWidth: 2, borderColor: colors.border, color: colors.onSurface, padding: spacing.md, textAlignVertical: "top", fontSize: 14 },
  modalBtn: { paddingVertical: spacing.md, alignItems: "center", borderWidth: 2 },
  modalBtnText: { color: colors.onSurface, fontSize: 13, fontWeight: "900", letterSpacing: 2 },
});
