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
import { useI18n } from "../../src/i18n";
import { colors, spacing } from "../../src/theme";
import { fmtPHP } from "../../src/currency";

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
  const { t } = useI18n();
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
  const [bookedSlots, setBookedSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"card" | "gcash" | "maya">("card");
  const [homeService, setHomeService] = useState(false);
  const [serviceAddress, setServiceAddress] = useState("");

  useEffect(() => {
    (async () => {
      try { setArtist(await api<Artist>(`/artists/${artistId}`)); } catch {}
    })();
  }, [artistId]);

  // Load booked slots when date changes
  useEffect(() => {
    if (!date) { setBookedSlots([]); return; }
    let cancelled = false;
    (async () => {
      setLoadingSlots(true);
      try {
        const res = await api<{ booked_slots: string[] }>(`/artists/${artistId}/availability?date=${date}`);
        if (!cancelled) setBookedSlots(res.booked_slots);
      } catch {
        if (!cancelled) setBookedSlots([]);
      } finally {
        if (!cancelled) setLoadingSlots(false);
      }
    })();
    return () => { cancelled = true; };
  }, [artistId, date]);

  // Reset time if it becomes unavailable
  useEffect(() => {
    if (time && bookedSlots.includes(time)) setTime("");
  }, [bookedSlots, time]);

  const canStep1 = !!date && !!time;
  const canStep2 = desc.trim().length > 5 && (!homeService || serviceAddress.trim().length > 5);
  const serviceFee = homeService && artist?.home_service_available ? (artist.home_service_fee ?? 0) : 0;
  const total = (artist?.rate_per_hour ?? 0) * hours + serviceFee;
  const deposit = 2900;

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
          home_service: homeService && !!artist?.home_service_available,
          service_address: homeService ? serviceAddress.trim() : null,
        }),
      }, token);
      setBookingId(booking.id);

      // 3. Create checkout session (pass deep-link return URL so native Stripe can round-trip)
      const platform = Platform.OS === "web" ? "web" : "native";
      const return_url = Platform.OS === "web"
        ? (typeof window !== "undefined" ? `${window.location.origin}/payment/return` : undefined)
        : Linking.createURL("payment/return");
      const session = await api<CheckoutSessionOut>("/payments/checkout-session", {
        method: "POST",
        body: JSON.stringify({ booking_id: booking.id, platform, payment_method: paymentMethod, return_url }),
      }, token);

      // 4. Handle checkout
      if (session.mock) {
        // Mock flow — confirm directly (with a small confirmation)
        const confirmed = await new Promise<boolean>((resolve) => {
          if (Platform.OS === "web") {
            const ok = typeof window !== "undefined"
              ? window.confirm(`Pay ${fmtPHP(deposit)} deposit? (mock payment — no real charge)`)
              : true;
            resolve(ok);
          } else {
            Alert.alert(
              "Confirm Payment",
              `Pay ${fmtPHP(deposit)} deposit? (Mock payment — real Stripe key not configured)`,
              [
                { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
                { text: `Pay ${fmtPHP(deposit)}`, style: "default", onPress: () => resolve(true) },
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
          <Text style={styles.doneTitle}>{t("book.confirmed")}</Text>
          <Text style={styles.doneMeta}>{artist.name.toUpperCase()} · {date} @ {time}</Text>
          <Text style={styles.doneNote}>
            {paid ? `${t("book.deposit")} ${fmtPHP(deposit)} ${t("book.paid")}` : `${t("book.deposit")} ${fmtPHP(deposit)} ${t("book.pending")}`} · {t("book.total")} ~{fmtPHP(total)}
          </Text>
          <Pressable testID="done-view-bookings" onPress={() => router.replace("/(tabs)/bookings")} style={styles.doneCta}>
            <Text style={styles.doneCtaText}>{t("book.viewBookings")}</Text>
          </Pressable>
          <Pressable testID="done-close" onPress={() => router.replace("/(tabs)")} style={[styles.doneCta, { backgroundColor: colors.surface, borderColor: colors.borderStrong }]}>
            <Text style={[styles.doneCtaText, { color: colors.onSurface }]}>{t("book.backDiscover")}</Text>
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
          <Text style={styles.stepLabel}>{t("book.step")} {step} {t("book.of")} 3</Text>
          <Text style={styles.stepTitle}>{step === 1 ? t("book.step1") : step === 2 ? t("book.step2") : t("book.step3")}</Text>
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
              <Text style={styles.label}>{t("book.date")}</Text>
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
              <View style={styles.labelRow}>
                <Text style={styles.label}>{t("book.time")}</Text>
                {loadingSlots ? <Text style={styles.slotLoading}>{t("book.checking")}</Text> : null}
              </View>
              <View style={styles.timeGrid}>
                {TIMES.map((slot) => {
                  const active = slot === time;
                  const taken = bookedSlots.includes(slot);
                  return (
                    <Pressable
                      key={slot}
                      testID={`time-${slot}`}
                      onPress={() => !taken && setTime(slot)}
                      disabled={taken}
                      style={[styles.timeChip, active && styles.timeChipActive, taken && styles.timeChipTaken]}
                    >
                      <Text style={[styles.timeText, active && { color: colors.onBrand }, taken && styles.timeTextTaken]}>{slot}</Text>
                      {taken && <Text style={styles.takenLabel}>{t("book.booked")}</Text>}
                    </Pressable>
                  );
                })}
              </View>
              {bookedSlots.length > 0 && bookedSlots.length === TIMES.length && (
                <Text style={styles.slotWarn}>{t("book.fullyBooked")}</Text>
              )}
            </View>
            <View>
              <Text style={styles.label}>{t("book.hours")}</Text>
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
            <Text style={styles.label}>{t("book.location")}</Text>
            <View style={styles.locRow}>
              <Pressable
                testID="location-studio"
                onPress={() => setHomeService(false)}
                style={[styles.locBtn, !homeService && styles.locBtnActive]}
              >
                <Icon name="home" size={16} color={!homeService ? colors.onBrand : colors.onSurface} />
                <Text style={[styles.locText, !homeService && styles.locTextActive]}>{t("book.atStudio")}</Text>
              </Pressable>
              <Pressable
                testID="location-home"
                onPress={() => artist.home_service_available && setHomeService(true)}
                disabled={!artist.home_service_available}
                style={[styles.locBtn, homeService && styles.locBtnActive, !artist.home_service_available && styles.locBtnDisabled]}
              >
                <Icon name="truck" size={16} color={!artist.home_service_available ? colors.muted : homeService ? colors.onBrand : colors.onSurface} />
                <Text style={[styles.locText, homeService && styles.locTextActive, !artist.home_service_available && { color: colors.muted }]}>
                  {t("book.homeService")}
                </Text>
              </Pressable>
            </View>
            {artist.home_service_available ? (
              <Text style={styles.hint}>{t("book.homeService.hint")} · +{fmtPHP(artist.home_service_fee ?? 0)}</Text>
            ) : (
              <Text style={styles.hint}>{t("book.homeService.unavailable")}</Text>
            )}

            {homeService && (
              <View style={{ marginTop: spacing.md }}>
                <Text style={styles.label}>{t("book.homeService.address")}</Text>
                <TextInput
                  testID="book-service-address-input"
                  value={serviceAddress}
                  onChangeText={setServiceAddress}
                  placeholder={t("book.homeService.addressPlaceholder")}
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                  multiline
                />
              </View>
            )}

            <Text style={[styles.label, { marginTop: spacing.md }]}>{t("book.describe")}</Text>
            <TextInput
              testID="book-description-input"
              value={desc}
              onChangeText={setDesc}
              multiline
              placeholder={t("book.describe.placeholder")}
              placeholderTextColor={colors.muted}
              style={styles.textarea}
            />
            <Text style={styles.hint}>{t("book.describe.hint")}</Text>

            <View style={{ marginTop: spacing.md }}>
              <Text style={styles.label}>{t("book.reference")}</Text>
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
                  <Text style={styles.pickText}>{t("book.reference.cta")}</Text>
                  <Text style={styles.pickSub}>{t("book.reference.hint")}</Text>
                </Pressable>
              )}
            </View>
          </>
        )}

        {step === 3 && (
          <>
            <View style={styles.summary}>
              <Text style={styles.blockTitle}>{t("book.summary")}</Text>
              <SummaryRow k={t("book.artist")} v={artist.name} />
              <SummaryRow k={t("book.date")} v={date} />
              <SummaryRow k={t("book.time")} v={time} />
              <SummaryRow k={t("book.hours")} v={`${hours}H`} />
              <SummaryRow k={t("book.rate")} v={`${fmtPHP(artist.rate_per_hour)}/HR`} />
              {homeService && serviceFee > 0 && (
                <SummaryRow k={t("book.homeService.fee")} v={`+${fmtPHP(serviceFee)}`} />
              )}
              <View style={styles.divider} />
              <SummaryRow k={t("book.total")} v={fmtPHP(total)} big />
              <SummaryRow k={t("book.depositDue")} v={fmtPHP(deposit)} accent />
            </View>
            <View style={styles.summary}>
              <Text style={styles.blockTitle}>{t("book.notes")}</Text>
              <Text style={styles.notesText}>{desc}</Text>
              {refUri && (
                <View style={styles.refPreview}>
                  <Image source={refUri} style={StyleSheet.absoluteFill} contentFit="cover" />
                </View>
              )}
            </View>
            <View style={styles.summary}>
              <Text style={styles.blockTitle}>{t("book.paymentMethod")}</Text>
              <View style={styles.methodRow}>
                {([
                  { id: "card", label: "CARD", icon: "credit-card", brand: null },
                  { id: "gcash", label: "GCASH", icon: "smartphone", brand: "#0066FF" },
                  { id: "maya", label: "MAYA", icon: "smartphone", brand: "#01D775" },
                ] as const).map((m) => {
                  const active = paymentMethod === m.id;
                  return (
                    <Pressable
                      key={m.id}
                      testID={`payment-method-${m.id}`}
                      onPress={() => setPaymentMethod(m.id)}
                      style={[styles.methodBtn, active && styles.methodBtnActive]}
                    >
                      <View style={[styles.methodDot, m.brand ? { backgroundColor: m.brand } : { backgroundColor: colors.onSurface }]}>
                        <Icon name={m.icon} size={12} color={m.brand ? "#FFFFFF" : colors.surface} />
                      </View>
                      <Text style={[styles.methodText, active && styles.methodTextActive]}>{m.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.securedRow}>
              <Icon name="lock" size={14} color={colors.muted} />
              <Text style={styles.securedText}>{t("book.secured")}</Text>
              <Pressable
                testID="view-cancellation-policy"
                onPress={() => router.push("/cancellation-policy")}
                hitSlop={8}
              >
                <Text style={styles.policyLink}>{t("book.policy")}</Text>
              </Pressable>
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
            <Text style={styles.bookText}>{t("book.continue")}</Text>
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
              {busy ? (uploading ? t("book.uploading") : t("book.processing")) : `${t("book.pay")} ${fmtPHP(deposit)} ${t("book.deposit")}`}
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
  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  slotLoading: { color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 1.5 },
  slotWarn: { color: colors.warning, fontSize: 11, fontWeight: "800", letterSpacing: 1.5, marginTop: spacing.sm },
  dateChip: { width: 64, height: 80, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surface, flexShrink: 0 },
  dateChipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  dateDay: { color: colors.onSurface, fontSize: 28, fontWeight: "900" },
  dateWeek: { color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 1.5, marginTop: 2 },
  timeGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  timeChip: { paddingHorizontal: spacing.lg, height: 44, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surface },
  timeChipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  timeChipTaken: { backgroundColor: colors.surfaceSecondary, borderColor: colors.info, opacity: 0.65 },
  timeText: { color: colors.onSurface, fontSize: 13, fontWeight: "900", letterSpacing: 1.5 },
  timeTextTaken: { color: colors.muted, textDecorationLine: "line-through" },
  takenLabel: { color: colors.muted, fontSize: 8, fontWeight: "900", letterSpacing: 1.5, marginTop: 2 },
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
  policyLink: { color: colors.brand, fontSize: 11, fontWeight: "900", letterSpacing: 2 },
  err: { color: colors.error, fontSize: 12, fontWeight: "800", letterSpacing: 1.5 },
  methodRow: { flexDirection: "row", gap: spacing.sm },
  methodBtn: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.xs, paddingVertical: spacing.md, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surface },
  methodBtnActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  methodDot: { width: 28, height: 28, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.borderStrong },
  methodText: { color: colors.onSurface, fontSize: 11, fontWeight: "900", letterSpacing: 1.5 },
  methodTextActive: { color: colors.onBrand },
  locRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  locBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingVertical: 14, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surface },
  locBtnActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  locBtnDisabled: { opacity: 0.5 },
  locText: { color: colors.onSurface, fontSize: 12, fontWeight: "900", letterSpacing: 1.5 },
  locTextActive: { color: colors.onBrand },
  input: { backgroundColor: colors.surfaceSecondary, borderWidth: 2, borderColor: colors.border, color: colors.onSurface, paddingVertical: 12, paddingHorizontal: spacing.md, fontSize: 14, minHeight: 60, textAlignVertical: "top" },
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
