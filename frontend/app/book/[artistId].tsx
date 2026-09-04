import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Image } from "expo-image";
import Icon from "@react-native-vector-icons/feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { api, Artist, uploadImage, CheckoutSessionOut, VerifyOut } from "../../src/api";
import { useSession } from "../../src/session";
import { colors, spacing } from "../../src/theme";

const TIMES = ["10:00", "12:00", "14:00", "16:00", "18:00"];
const HOURS = [1, 2, 3, 4, 5, 6];

function nextDates(count = 14) {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < count; i++) {
    const cur = new Date(d);
    cur.setDate(d.getDate() + i);
    out.push(cur.toISOString().slice(0, 10));
  }
  return out;
}

export default function BookScreen() {
  const { artistId } = useLocalSearchParams<{ artistId: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token } = useSession();
  const [artist, setArtist] = useState<Artist | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [date, setDate] = useState<string>("");
  const [time, setTime] = useState<string>("");
  const [hours, setHours] = useState<number>(2);
  const [desc, setDesc] = useState("");
  const [refUri, setRefUri] = useState<string | null>(null); // local URI or remote URL
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);

  useEffect(() => {
    (async () => {
      try { setArtist(await api<Artist>(`/artists/${artistId}`)); } catch {}
    })();
  }, [artistId]);

  const canStep1 = !!date && !!time;
  const canStep2 = desc.trim().length > 5;
  const total = (artist?.rate_per_hour ?? 0) * hours;
  const deposit = 50;

  const pickImage = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setErr("Photo library permission needed to add references");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.7,
        allowsEditing: false,
      });
      if (result.canceled) return;
      const uri = result.assets?.[0]?.uri;
      if (uri) setRefUri(uri);
    } catch (e: any) {
      setErr(e?.message ?? "Could not pick image");
    }
  };

  const removeImage = () => setRefUri(null);

  const createBookingAndPay = async () => {
    setErr(""); setBusy(true);
    try {
      // 1. Upload reference image if selected & still local
      let refUrl: string | null = null;
      if (refUri && !refUri.startsWith("http")) {
        setUploading(true);
        try {
          const up = await uploadImage(refUri, token!, "reference.jpg");
          refUrl = up.url;
        } catch (e: any) {
          throw new Error(`Upload failed: ${e?.message ?? e}`);
        } finally { setUploading(false); }
      } else if (refUri) {
        refUrl = refUri;
      }

      // 2. Create booking
      const booking: any = await api("/bookings", {
        method: "POST",
        body: JSON.stringify({
          artist_id: artistId,
          date,
          time_slot: time,
          description: desc,
          estimated_hours: hours,
          reference_image: refUrl,
        }),
      }, token);
      setBookingId(booking.id);

      // 3. Create checkout session
      const platform = Platform.OS === "web" ? "web" : "native";
      const session = await api<CheckoutSessionOut>("/payments/checkout-session", {
        method: "POST",
        body: JSON.stringify({ booking_id: booking.id, platform }),
      }, token);

      // 4. Handle checkout
      if (session.mock) {
        // Mock flow — confirm directly (with a small confirmation)
        const confirmed = await new Promise<boolean>((resolve) => {
          if (Platform.OS === "web") {
            const ok = typeof window !== "undefined"
              ? window.confirm(`Pay $${deposit} deposit? (mock payment — no real charge)`)
              : true;
            resolve(ok);
          } else {
            Alert.alert(
              "Confirm Payment",
              `Pay $${deposit} deposit? (Mock payment — real Stripe key not configured)`,
              [
                { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
                { text: `Pay $${deposit}`, style: "default", onPress: () => resolve(true) },
              ]
            );
          }
        });
        if (!confirmed) { setBusy(false); return; }
        await api("/payments/mock-confirm", {
          method: "POST",
          body: JSON.stringify({ session_id: session.session_id }),
        }, token);
        setPaid(true);
        setDone(true);
        return;
      }

      // Real Stripe checkout via web browser
      const redirect = Platform.OS === "web"
        ? (typeof window !== "undefined" ? `${window.location.origin}/payment/return` : "")
        : Linking.createURL("payment/return");

      const result = await WebBrowser.openAuthSessionAsync(session.checkout_url, redirect);
      if (result.type !== "success" || !("url" in result) || !result.url) {
        // User cancelled or dismissed
        setBusy(false);
        return;
      }
      const parsed = Linking.parse(result.url);
      const sid = parsed.queryParams?.session_id as string | undefined;
      if (!sid) { setErr("Payment cancelled"); setBusy(false); return; }

      const verify = await api<VerifyOut>(`/payments/verify/${encodeURIComponent(sid)}`, {}, token);
      if (verify.paid) {
        setPaid(true);
        setDone(true);
      } else {
        setErr("Payment not completed");
      }
    } catch (e: any) {
      setErr(e?.message ?? "Booking failed");
    } finally {
      setBusy(false);
    }
  };

  if (!artist) {
    return <View style={styles.center}><ActivityIndicator color={colors.brand} size="large" /></View>;
  }

  if (done) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={styles.doneWrap}>
          <View style={styles.checkBox}><Icon name="check" size={48} color={colors.onBrand} /></View>
          <Text style={styles.doneTitle}>BOOKING{"\n"}CONFIRMED</Text>
          <Text style={styles.doneMeta}>{artist.name.toUpperCase()} · {date} @ {time}</Text>
          <Text style={styles.doneNote}>
            {paid ? `DEPOSIT $${deposit} PAID` : `DEPOSIT $${deposit} PENDING`} · TOTAL ~${total}
          </Text>
          <Pressable testID="done-view-bookings" onPress={() => router.replace("/(tabs)/bookings")} style={styles.doneCta}>
            <Text style={styles.doneCtaText}>VIEW MY BOOKINGS</Text>
          </Pressable>
          <Pressable testID="done-close" onPress={() => router.replace("/(tabs)")} style={[styles.doneCta, { backgroundColor: colors.surface, borderColor: colors.borderStrong }]}>
            <Text style={[styles.doneCtaText, { color: colors.onSurface }]}>BACK TO DISCOVER</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="book-back" onPress={() => (step === 1 ? router.back() : setStep((s) => (s - 1) as any))} style={styles.iconBtn}>
          <Icon name="arrow-left" size={20} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.stepLabel}>STEP {step} OF 3</Text>
          <Text style={styles.stepTitle}>{step === 1 ? "SELECT DATE & TIME" : step === 2 ? "DESCRIBE PIECE" : "REVIEW & PAY"}</Text>
        </View>
      </View>

      {/* Progress bar */}
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${(step / 3) * 100}%` }]} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 + insets.bottom, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
        {step === 1 && (
          <>
            <View>
              <Text style={styles.label}>DATE</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingRight: spacing.lg }}>
                {nextDates().map((d) => {
                  const dt = new Date(d + "T00:00:00");
                  const active = d === date;
                  return (
                    <Pressable
                      key={d}
                      testID={`date-${d}`}
                      onPress={() => setDate(d)}
                      style={[styles.dateChip, active && styles.dateChipActive]}
                    >
                      <Text style={[styles.dateDay, active && { color: colors.onBrand }]}>{dt.getDate()}</Text>
                      <Text style={[styles.dateWeek, active && { color: colors.onBrand }]}>{dt.toLocaleString("en", { weekday: "short" }).toUpperCase()}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
            <View>
              <Text style={styles.label}>TIME</Text>
              <View style={styles.timeGrid}>
                {TIMES.map((t) => {
                  const active = t === time;
                  return (
                    <Pressable key={t} testID={`time-${t}`} onPress={() => setTime(t)} style={[styles.timeChip, active && styles.timeChipActive]}>
                      <Text style={[styles.timeText, active && { color: colors.onBrand }]}>{t}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            <View>
              <Text style={styles.label}>ESTIMATED HOURS</Text>
              <View style={styles.timeGrid}>
                {HOURS.map((h) => {
                  const active = h === hours;
                  return (
                    <Pressable key={h} testID={`hours-${h}`} onPress={() => setHours(h)} style={[styles.timeChip, active && styles.timeChipActive]}>
                      <Text style={[styles.timeText, active && { color: colors.onBrand }]}>{h}H</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </>
        )}

        {step === 2 && (
          <>
            <Text style={styles.label}>DESCRIBE YOUR TATTOO</Text>
            <TextInput
              testID="book-description-input"
              value={desc}
              onChangeText={setDesc}
              multiline
              placeholder="SIZE, PLACEMENT, STYLE, INSPIRATION..."
              placeholderTextColor={colors.muted}
              style={styles.textarea}
            />
            <Text style={styles.hint}>MIN 6 CHARACTERS. THE ARTIST WILL FOLLOW UP TO CONFIRM DETAILS.</Text>

            <View style={{ marginTop: spacing.md }}>
              <Text style={styles.label}>REFERENCE IMAGE (OPTIONAL)</Text>
              {refUri ? (
                <View style={styles.refWrap}>
                  <Image source={refUri} style={StyleSheet.absoluteFill} contentFit="cover" />
                  <Pressable testID="remove-ref-image" onPress={removeImage} style={styles.refRemove}>
                    <Icon name="x" size={16} color={colors.onSurface} />
                  </Pressable>
                </View>
              ) : (
                <Pressable testID="pick-ref-image" onPress={pickImage} style={styles.pickBtn}>
                  <Icon name="image" size={24} color={colors.brand} />
                  <Text style={styles.pickText}>ADD INSPIRATION PHOTO</Text>
                  <Text style={styles.pickSub}>SO THE ARTIST CAN PREP THE DESIGN</Text>
                </Pressable>
              )}
            </View>
          </>
        )}

        {step === 3 && (
          <>
            <View style={styles.summary}>
              <Text style={styles.blockTitle}>SUMMARY</Text>
              <SummaryRow k="ARTIST" v={artist.name} />
              <SummaryRow k="DATE" v={date} />
              <SummaryRow k="TIME" v={time} />
              <SummaryRow k="HOURS" v={`${hours}H`} />
              <SummaryRow k="RATE" v={`$${artist.rate_per_hour}/HR`} />
              <View style={styles.divider} />
              <SummaryRow k="EST. TOTAL" v={`$${total}`} big />
              <SummaryRow k="DEPOSIT DUE NOW" v={`$${deposit}`} accent />
            </View>
            <View style={styles.summary}>
              <Text style={styles.blockTitle}>YOUR NOTES</Text>
              <Text style={styles.notesText}>{desc}</Text>
              {refUri && (
                <View style={styles.refPreview}>
                  <Image source={refUri} style={StyleSheet.absoluteFill} contentFit="cover" />
                </View>
              )}
            </View>
            <View style={styles.securedRow}>
              <Icon name="lock" size={14} color={colors.muted} />
              <Text style={styles.securedText}>SECURED BY STRIPE · 100% REFUNDABLE 48H BEFORE APPOINTMENT</Text>
            </View>
            {!!err && <Text style={styles.err}>{err.toUpperCase()}</Text>}
          </>
        )}
      </ScrollView>

      <View style={[styles.stickyBar, { paddingBottom: insets.bottom + spacing.md }]}>
        {step < 3 ? (
          <Pressable
            testID="book-next-button"
            onPress={() => setStep((s) => (s + 1) as any)}
            disabled={step === 1 ? !canStep1 : !canStep2}
            style={({ pressed }) => [styles.bookBtn, ((step === 1 && !canStep1) || (step === 2 && !canStep2)) && { opacity: 0.5 }, pressed && { backgroundColor: colors.brandSecondary }]}
          >
            <Text style={styles.bookText}>CONTINUE</Text>
            <Icon name="arrow-right" size={20} color={colors.onBrand} />
          </Pressable>
        ) : (
          <Pressable
            testID="book-confirm-button"
            onPress={createBookingAndPay}
            disabled={busy}
            style={({ pressed }) => [styles.bookBtn, busy && { opacity: 0.5 }, pressed && { backgroundColor: colors.brandSecondary }]}
          >
            <Text style={styles.bookText}>
              {busy ? (uploading ? "UPLOADING..." : "PROCESSING...") : `PAY $${deposit} DEPOSIT`}
            </Text>
            <Icon name="lock" size={18} color={colors.onBrand} />
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function SummaryRow({ k, v, big, accent }: { k: string; v: string; big?: boolean; accent?: boolean }) {
  return (
    <View style={styles.sumRow}>
      <Text style={styles.sumK}>{k}</Text>
      <Text style={[styles.sumV, big && { fontSize: 20 }, accent && { color: colors.brand }]}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 2, borderBottomColor: colors.borderStrong },
  iconBtn: { width: 40, height: 40, borderWidth: 2, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  stepLabel: { color: colors.brand, fontSize: 11, fontWeight: "900", letterSpacing: 2 },
  stepTitle: { color: colors.onSurface, fontSize: 20, fontWeight: "900", letterSpacing: 1, marginTop: 2 },
  progressBar: { height: 4, backgroundColor: colors.surfaceSecondary },
  progressFill: { height: 4, backgroundColor: colors.brand },
  label: { color: colors.brand, fontSize: 11, fontWeight: "900", letterSpacing: 2, marginBottom: spacing.md },
  dateChip: { width: 64, height: 80, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surface, flexShrink: 0 },
  dateChipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  dateDay: { color: colors.onSurface, fontSize: 28, fontWeight: "900" },
  dateWeek: { color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 1.5, marginTop: 2 },
  timeGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  timeChip: { paddingHorizontal: spacing.lg, height: 44, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surface },
  timeChipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  timeText: { color: colors.onSurface, fontSize: 13, fontWeight: "900", letterSpacing: 1.5 },
  textarea: { minHeight: 140, borderWidth: 2, borderColor: colors.border, color: colors.onSurface, padding: spacing.md, backgroundColor: colors.surfaceSecondary, textAlignVertical: "top", fontSize: 14, lineHeight: 20 },
  hint: { color: colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 1.5 },
  pickBtn: { borderWidth: 2, borderColor: colors.border, borderStyle: "dashed", paddingVertical: spacing.xl, alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary },
  pickText: { color: colors.onSurface, fontSize: 13, fontWeight: "900", letterSpacing: 2 },
  pickSub: { color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 1.5 },
  refWrap: { aspectRatio: 4 / 3, backgroundColor: colors.surfaceSecondary, borderWidth: 2, borderColor: colors.borderStrong },
  refRemove: { position: "absolute", top: spacing.sm, right: spacing.sm, width: 32, height: 32, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(10,10,10,0.85)", borderWidth: 2, borderColor: colors.borderStrong },
  refPreview: { aspectRatio: 16 / 9, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, marginTop: spacing.sm },
  summary: { borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md, gap: spacing.sm },
  blockTitle: { color: colors.brand, fontSize: 12, fontWeight: "900", letterSpacing: 3, marginBottom: spacing.sm },
  sumRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 4 },
  sumK: { color: colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 1.5 },
  sumV: { color: colors.onSurface, fontSize: 14, fontWeight: "900", letterSpacing: 1 },
  divider: { height: 2, backgroundColor: colors.border, marginVertical: spacing.sm },
  notesText: { color: colors.onSurfaceSecondary, fontSize: 14, lineHeight: 20 },
  securedRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.sm },
  securedText: { color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 1.5, flex: 1 },
  err: { color: colors.error, fontSize: 12, fontWeight: "800", letterSpacing: 1.5 },
  stickyBar: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, borderTopWidth: 2, borderTopColor: colors.borderStrong, padding: spacing.md },
  bookBtn: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.brand, paddingHorizontal: spacing.lg, paddingVertical: 16 },
  bookText: { color: colors.onBrand, fontSize: 16, fontWeight: "900", letterSpacing: 2 },
  doneWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.lg },
  checkBox: { width: 96, height: 96, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center", borderWidth: 4, borderColor: colors.borderStrong },
  doneTitle: { color: colors.onSurface, fontSize: 44, fontWeight: "900", letterSpacing: 2, textAlign: "center", lineHeight: 48 },
  doneMeta: { color: colors.brand, fontSize: 13, fontWeight: "900", letterSpacing: 2 },
  doneNote: { color: colors.muted, fontSize: 12, fontWeight: "800", letterSpacing: 1.5 },
  doneCta: { alignSelf: "stretch", backgroundColor: colors.brand, paddingVertical: spacing.md, alignItems: "center", borderWidth: 2, borderColor: colors.brand },
  doneCtaText: { color: colors.onBrand, fontSize: 13, fontWeight: "900", letterSpacing: 2 },
});
