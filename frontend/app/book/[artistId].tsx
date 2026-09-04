import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import Icon from "@react-native-vector-icons/feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, Artist } from "../../src/api";
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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    (async () => {
      try { setArtist(await api<Artist>(`/artists/${artistId}`)); } catch {}
    })();
  }, [artistId]);

  const canStep1 = !!date && !!time;
  const canStep2 = desc.trim().length > 5;
  const total = (artist?.rate_per_hour ?? 0) * hours;
  const deposit = 50;

  const submit = async () => {
    setErr(""); setBusy(true);
    try {
      await api("/bookings", {
        method: "POST",
        body: JSON.stringify({ artist_id: artistId, date, time_slot: time, description: desc, estimated_hours: hours }),
      }, token);
      setDone(true);
    } catch (e: any) { setErr(e?.message ?? "Booking failed"); }
    finally { setBusy(false); }
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
          <Text style={styles.doneNote}>DEPOSIT ${deposit} · TOTAL ~${total}</Text>
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
            </View>
            <Text style={styles.mockNote}>*PAYMENT MOCKED — DEPOSIT WILL BE CAPTURED IN PRODUCTION.</Text>
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
            onPress={submit}
            disabled={busy}
            style={({ pressed }) => [styles.bookBtn, busy && { opacity: 0.5 }, pressed && { backgroundColor: colors.brandSecondary }]}
          >
            <Text style={styles.bookText}>{busy ? "PROCESSING..." : `CONFIRM · PAY $${deposit}`}</Text>
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
  textarea: { minHeight: 180, borderWidth: 2, borderColor: colors.border, color: colors.onSurface, padding: spacing.md, backgroundColor: colors.surfaceSecondary, textAlignVertical: "top", fontSize: 14, lineHeight: 20 },
  hint: { color: colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 1.5 },
  summary: { borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md, gap: spacing.sm },
  blockTitle: { color: colors.brand, fontSize: 12, fontWeight: "900", letterSpacing: 3, marginBottom: spacing.sm },
  sumRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 4 },
  sumK: { color: colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 1.5 },
  sumV: { color: colors.onSurface, fontSize: 14, fontWeight: "900", letterSpacing: 1 },
  divider: { height: 2, backgroundColor: colors.border, marginVertical: spacing.sm },
  notesText: { color: colors.onSurfaceSecondary, fontSize: 14, lineHeight: 20 },
  mockNote: { color: colors.warning, fontSize: 10, fontWeight: "800", letterSpacing: 1.5 },
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
