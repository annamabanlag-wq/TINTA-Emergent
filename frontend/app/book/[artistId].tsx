import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Image } from "expo-image";
import Icon from "@react-native-vector-icons/feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { api, Artist, uploadImage } from "../../src/api";
import { useSession } from "../../src/session";
import { useI18n } from "../../src/i18n";
import { colors, spacing } from "../../src/theme";
import { fmtPHP } from "../../src/currency";

const TIMES = ["10:00", "12:00", "14:00", "16:00", "18:00"];
const HOURS = [1, 2, 3, 4, 5, 6];
const DEPOSIT = 2900;

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
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [hours, setHours] = useState(2);
  const [desc, setDesc] = useState("");
  const [refUri, setRefUri] = useState<string | null>(null);
  const [refFile, setRefFile] = useState<any>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const [paid, setPaid] = useState(false);
  const [bookedSlots, setBookedSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [homeService, setHomeService] = useState(false);
  const [serviceAddress, setServiceAddress] = useState("");
  const [gcashReference, setGcashReference] = useState("");
  const [gcashReceiptUrl, setGcashReceiptUrl] = useState("");

  useEffect(() => {
    (async () => {
      try { setArtist(await api<Artist>(`/artists/${artistId}`)); } catch (e: any) { setErr(e?.message ?? "Could not load artist"); }
    })();
  }, [artistId]);

  useEffect(() => {
    if (!date) { setBookedSlots([]); return; }
    let cancelled = false;
    (async () => {
      setLoadingSlots(true);
      try {
        const res = await api<{ booked_slots: string[] }>(`/artists/${artistId}/availability?date=${date}`);
        if (!cancelled) setBookedSlots(res.booked_slots ?? []);
      } catch {
        if (!cancelled) setBookedSlots([]);
      } finally {
        if (!cancelled) setLoadingSlots(false);
      }
    })();
    return () => { cancelled = true; };
  }, [artistId, date]);

  useEffect(() => {
    if (time && bookedSlots.includes(time)) setTime("");
  }, [bookedSlots, time]);

  const serviceFee = homeService && artist?.home_service_available ? (artist.home_service_fee ?? 0) : 0;
  const total = (artist?.rate_per_hour ?? 0) * hours + serviceFee;
  const canStep1 = !!date && !!time;
  const canStep2 = desc.trim().length > 5 && (!homeService || serviceAddress.trim().length > 5);

  const pickImage = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { setErr("Photo library permission needed to add references"); return; }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7, allowsEditing: false });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (asset?.uri) { setRefUri(asset.uri); setRefFile(asset.file ?? null); }
    } catch (e: any) { setErr(e?.message ?? "Could not pick image"); }
  };

  const createBookingAndPay = async () => {
    if (!token) { setErr("Please sign in before booking."); return; }
    if (!gcashReference.trim()) { setErr("Please enter your GCash reference number."); return; }
    setErr(""); setBusy(true);
    try {
      let refUrl: string | null = refUri;
      if (refUrl && !refUrl.startsWith("http")) {
        setUploading(true);
        try {
          const up = await uploadImage(refUrl, token, "reference.jpg", refFile ?? undefined);
          refUrl = up.url;
        } finally { setUploading(false); }
      }

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

      await api("/payments/gcash/submit", {
        method: "POST",
        body: JSON.stringify({
          booking_id: booking.id,
          reference_number: gcashReference.trim(),
          receipt_url: gcashReceiptUrl.trim() || null,
        }),
      }, token);

      setPaid(false);
      setDone(true);
      Alert.alert("GCash Payment Submitted", "Your payment is now pending verification. We will confirm it after the admin reviews your GCash payment.");
    } catch (e: any) {
      setErr(e?.message ?? "Booking failed");
    } finally { setBusy(false); }
  };

  if (!artist) return <View style={styles.center}><ActivityIndicator color={colors.brand} size="large" /></View>;

  if (done) return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]}>
      <View style={styles.doneWrap}>
        <View style={styles.checkBox}><Icon name="check" size={48} color={colors.onBrand} /></View>
        <Text style={styles.doneTitle}>PAYMENT SUBMITTED</Text>
        <Text style={styles.doneMeta}>{artist.name.toUpperCase()} · {date} @ {time}</Text>
        <Text style={styles.doneNote}>{fmtPHP(DEPOSIT)} GCash deposit is PENDING VERIFICATION. · Total ~{fmtPHP(total)}</Text>
        <Pressable testID="done-view-bookings" onPress={() => router.replace("/(tabs)/bookings")} style={styles.doneCta}>
          <Text style={styles.doneCtaText}>VIEW MY BOOKINGS</Text>
        </Pressable>
        <Pressable testID="done-close" onPress={() => router.replace("/(tabs)")} style={[styles.doneCta, styles.secondaryCta]}>
          <Text style={[styles.doneCtaText, { color: colors.onSurface }]}>BACK TO DISCOVER</Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="book-back" onPress={() => step === 1 ? router.back() : setStep((step - 1) as 1 | 2 | 3)} style={styles.iconBtn}>
          <Icon name="arrow-left" size={20} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.stepLabel}>STEP {step} OF 3</Text>
          <Text style={styles.stepTitle}>{step === 1 ? "DATE & TIME" : step === 2 ? "YOUR TATTOO" : "CONFIRM & PAY"}</Text>
        </View>
      </View>
      <View style={styles.progressBar}><View style={[styles.progressFill, { width: `${(step / 3) * 100}%` }]} /></View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 + insets.bottom, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
        {step === 1 && <>
          <View>
            <Text style={styles.label}>DATE</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
              {nextDates().map(d => {
                const dt = new Date(d + "T00:00:00"); const active = d === date;
                return <Pressable key={d} testID={`date-${d}`} onPress={() => setDate(d)} style={[styles.dateChip, active && styles.active]}>
                  <Text style={[styles.dateDay, active && { color: colors.onBrand }]}>{dt.getDate()}</Text>
                  <Text style={[styles.dateWeek, active && { color: colors.onBrand }]}>{dt.toLocaleString("en", { weekday: "short" }).toUpperCase()}</Text>
                </Pressable>;
              })}
            </ScrollView>
          </View>
          <View>
            <View style={styles.labelRow}><Text style={styles.label}>TIME</Text>{loadingSlots && <Text style={styles.hint}>CHECKING...</Text>}</View>
            <View style={styles.timeGrid}>{TIMES.map(slot => {
              const taken = bookedSlots.includes(slot); const active = slot === time;
              return <Pressable key={slot} testID={`time-${slot}`} disabled={taken} onPress={() => setTime(slot)} style={[styles.timeChip, active && styles.active, taken && styles.taken]}>
                <Text style={[styles.timeText, active && { color: colors.onBrand }, taken && styles.takenText]}>{slot}</Text>
                {taken && <Text style={styles.hint}>BOOKED</Text>}
              </Pressable>;
            })}</View>
          </View>
          <View><Text style={styles.label}>HOURS</Text><View style={styles.timeGrid}>{HOURS.map(h => <Pressable key={h} testID={`hours-${h}`} onPress={() => setHours(h)} style={[styles.timeChip, h === hours && styles.active]}><Text style={[styles.timeText, h === hours && { color: colors.onBrand }]}>{h}H</Text></Pressable>)}</View></View>
        </>}

        {step === 2 && <>
          <Text style={styles.label}>LOCATION</Text>
          <View style={styles.locRow}>
            <Pressable testID="location-studio" onPress={() => setHomeService(false)} style={[styles.locBtn, !homeService && styles.active]}><Icon name="home" size={16} color={!homeService ? colors.onBrand : colors.onSurface} /><Text style={[styles.locText, !homeService && { color: colors.onBrand }]}>AT STUDIO</Text></Pressable>
            <Pressable testID="location-home" onPress={() => artist.home_service_available && setHomeService(true)} disabled={!artist.home_service_available} style={[styles.locBtn, homeService && styles.active, !artist.home_service_available && { opacity: 0.5 }]}><Icon name="truck" size={16} color={homeService ? colors.onBrand : colors.onSurface} /><Text style={[styles.locText, homeService && { color: colors.onBrand }]}>HOME SERVICE</Text></Pressable>
          </View>
          {artist.home_service_available && <Text style={styles.hint}>HOME SERVICE FEE: +{fmtPHP(artist.home_service_fee ?? 0)}</Text>}
          {homeService && <View><Text style={styles.label}>SERVICE ADDRESS</Text><TextInput testID="book-service-address-input" value={serviceAddress} onChangeText={setServiceAddress} placeholder="Enter service address" placeholderTextColor={colors.muted} style={styles.input} multiline /></View>}
          <Text style={styles.label}>DESCRIBE YOUR TATTOO</Text>
          <TextInput testID="book-description-input" value={desc} onChangeText={setDesc} multiline placeholder="Tell the artist what you want..." placeholderTextColor={colors.muted} style={styles.textarea} />
          <Text style={styles.hint}>Minimum 6 characters.</Text>
          <Text style={styles.label}>REFERENCE IMAGE</Text>
          {refUri ? <View style={styles.refWrap}><Image source={refUri} style={StyleSheet.absoluteFill} contentFit="cover" /><Pressable testID="remove-ref-image" onPress={() => { setRefUri(null); setRefFile(null); }} style={styles.refRemove}><Icon name="x" size={16} color={colors.onSurface} /></Pressable></View> : <Pressable testID="pick-ref-image" onPress={pickImage} style={styles.pickBtn}><Icon name="image" size={24} color={colors.brand} /><Text style={styles.pickText}>ADD REFERENCE IMAGE</Text></Pressable>}
        </>}

        {step === 3 && <>
          <View style={styles.summary}><Text style={styles.blockTitle}>BOOKING SUMMARY</Text><SummaryRow k="ARTIST" v={artist.name} /><SummaryRow k="DATE" v={date} /><SummaryRow k="TIME" v={time} /><SummaryRow k="HOURS" v={`${hours}H`} /><SummaryRow k="RATE" v={`${fmtPHP(artist.rate_per_hour)}/HR`} />{serviceFee > 0 && <SummaryRow k="HOME SERVICE" v={`+${fmtPHP(serviceFee)}`} />}<View style={styles.divider} /><SummaryRow k="ESTIMATED TOTAL" v={fmtPHP(total)} big /><SummaryRow k="GCASH DEPOSIT DUE" v={fmtPHP(DEPOSIT)} accent /></View>
          <View style={styles.summary}><Text style={styles.blockTitle}>GCASH PAYMENT</Text><Text style={styles.paymentTitle}>SEND {fmtPHP(DEPOSIT)} TO</Text><Image source={require("../../assets/GCash-MyQR-12092026210418.PNG.jpg")} style={styles.qr} contentFit="contain" /><Text style={styles.merchant}>TINTA</Text><Text style={styles.phone}>GCash: 09381447214</Text><Text style={styles.payInstruction}>Send the required GCash deposit, then enter your reference number below. Your payment will remain pending until an admin verifies it.</Text><TextInput testID="gcash-reference-input" value={gcashReference} onChangeText={setGcashReference} placeholder="GCash Reference Number *" placeholderTextColor={colors.muted} style={styles.input} autoCapitalize="characters" /><TextInput testID="gcash-receipt-input" value={gcashReceiptUrl} onChangeText={setGcashReceiptUrl} placeholder="Receipt URL (optional)" placeholderTextColor={colors.muted} style={styles.input} autoCapitalize="none" /></View>
          {!!err && <Text style={styles.err}>{err.toUpperCase()}</Text>}
        </>}
      </ScrollView>

      <View style={[styles.stickyBar, { paddingBottom: insets.bottom + spacing.md }]}>
        {step < 3 ? <Pressable testID="book-next-button" onPress={() => setStep((step + 1) as 2 | 3)} disabled={step === 1 ? !canStep1 : !canStep2} style={[styles.bookBtn, (step === 1 ? !canStep1 : !canStep2) && { opacity: 0.5 }]}><Text style={styles.bookText}>CONTINUE</Text><Icon name="arrow-right" size={20} color={colors.onBrand} /></Pressable> : <Pressable testID="book-confirm-button" onPress={createBookingAndPay} disabled={busy} style={[styles.bookBtn, busy && { opacity: 0.5 }]}><Text style={styles.bookText}>{busy ? (uploading ? "UPLOADING..." : "SUBMITTING...") : `SUBMIT GCash ${fmtPHP(DEPOSIT)}`}</Text><Icon name="lock" size={18} color={colors.onBrand} /></Pressable>}
      </View>
    </KeyboardAvoidingView>
  );
}

function SummaryRow({ k, v, big, accent }: { k: string; v: string; big?: boolean; accent?: boolean }) {
  return <View style={styles.sumRow}><Text style={styles.sumK}>{k}</Text><Text style={[styles.sumV, big && { fontSize: 20 }, accent && { color: colors.brand }]}>{v}</Text></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface }, center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 2, borderBottomColor: colors.borderStrong }, iconBtn: { width: 40, height: 40, borderWidth: 2, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" }, stepLabel: { color: colors.brand, fontSize: 11, fontWeight: "900", letterSpacing: 2 }, stepTitle: { color: colors.onSurface, fontSize: 20, fontWeight: "900", letterSpacing: 1, marginTop: 2 }, progressBar: { height: 4, backgroundColor: colors.surfaceSecondary }, progressFill: { height: 4, backgroundColor: colors.brand }, label: { color: colors.brand, fontSize: 11, fontWeight: "900", letterSpacing: 2, marginBottom: spacing.md }, labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, hint: { color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 1.2 }, dateChip: { width: 64, height: 80, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surface }, active: { backgroundColor: colors.brand, borderColor: colors.brand }, dateDay: { color: colors.onSurface, fontSize: 28, fontWeight: "900" }, dateWeek: { color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 1.5, marginTop: 2 }, timeGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, timeChip: { minWidth: 76, paddingHorizontal: spacing.md, height: 44, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surface }, timeText: { color: colors.onSurface, fontSize: 13, fontWeight: "900", letterSpacing: 1.5 }, taken: { opacity: 0.5, backgroundColor: colors.surfaceSecondary }, takenText: { color: colors.muted, textDecorationLine: "line-through" }, locRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm, marginBottom: spacing.sm }, locBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingVertical: 14, borderWidth: 2, borderColor: colors.border }, locText: { color: colors.onSurface, fontSize: 11, fontWeight: "900", letterSpacing: 1.2 }, input: { backgroundColor: colors.surfaceSecondary, borderWidth: 2, borderColor: colors.border, color: colors.onSurface, paddingVertical: 12, paddingHorizontal: spacing.md, fontSize: 14, minHeight: 52, marginBottom: spacing.sm }, textarea: { minHeight: 140, borderWidth: 2, borderColor: colors.border, color: colors.onSurface, padding: spacing.md, backgroundColor: colors.surfaceSecondary, textAlignVertical: "top", fontSize: 14 }, pickBtn: { borderWidth: 2, borderColor: colors.border, borderStyle: "dashed", paddingVertical: spacing.xl, alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary }, pickText: { color: colors.onSurface, fontSize: 12, fontWeight: "900", letterSpacing: 1.5 }, refWrap: { aspectRatio: 4 / 3, backgroundColor: colors.surfaceSecondary, borderWidth: 2, borderColor: colors.borderStrong }, refRemove: { position: "absolute", top: spacing.sm, right: spacing.sm, width: 32, height: 32, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(10,10,10,0.85)" }, summary: { borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md, gap: spacing.sm }, blockTitle: { color: colors.brand, fontSize: 12, fontWeight: "900", letterSpacing: 3 }, sumRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 4 }, sumK: { color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 1.4 }, sumV: { color: colors.onSurface, fontSize: 14, fontWeight: "900", letterSpacing: 1, textAlign: "right", maxWidth: "65%" }, divider: { height: 2, backgroundColor: colors.border, marginVertical: spacing.sm }, paymentTitle: { color: colors.onSurface, fontWeight: "900", textAlign: "center", letterSpacing: 2 }, qr: { width: 220, height: 220, alignSelf: "center", marginVertical: spacing.sm }, merchant: { color: colors.onSurface, textAlign: "center", fontWeight: "900", fontSize: 16 }, phone: { color: colors.muted, textAlign: "center", marginTop: 4, marginBottom: spacing.sm }, payInstruction: { color: colors.muted, fontSize: 11, lineHeight: 18, marginBottom: spacing.sm }, err: { color: colors.error, fontSize: 12, fontWeight: "800", letterSpacing: 1.2 }, stickyBar: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, borderTopWidth: 2, borderTopColor: colors.borderStrong, padding: spacing.md }, bookBtn: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.brand, paddingHorizontal: spacing.lg, paddingVertical: 16 }, bookText: { color: colors.onBrand, fontSize: 14, fontWeight: "900", letterSpacing: 1.5 }, doneWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.lg }, checkBox: { width: 96, height: 96, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center", borderWidth: 4, borderColor: colors.borderStrong }, doneTitle: { color: colors.onSurface, fontSize: 34, fontWeight: "900", letterSpacing: 2, textAlign: "center" }, doneMeta: { color: colors.brand, fontSize: 12, fontWeight: "900", letterSpacing: 1.5, textAlign: "center" }, doneNote: { color: colors.muted, fontSize: 12, fontWeight: "800", letterSpacing: 1.2, textAlign: "center" }, doneCta: { alignSelf: "stretch", backgroundColor: colors.brand, paddingVertical: spacing.md, alignItems: "center", borderWidth: 2, borderColor: colors.brand }, secondaryCta: { backgroundColor: colors.surface, borderColor: colors.borderStrong }, doneCtaText: { color: colors.onBrand, fontSize: 12, fontWeight: "900", letterSpacing: 2 }
});