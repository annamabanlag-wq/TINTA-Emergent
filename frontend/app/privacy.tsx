import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import Icon from "@react-native-vector-icons/feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing } from "../src/theme";

export default function PrivacyScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable onPress={() => router.back()} testID="back" hitSlop={12}>
          <Icon name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>PRIVACY & TERMS</Text>
        <View style={{ width: 22 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}>
        <Text style={styles.h1}>Our Promise</Text>
        <Text style={styles.body}>
          INKED is a booking marketplace for tattoo clients and artists. We only collect the data we
          need to run the app: your email and name for your account, your bookings history, chat
          messages you send to artists, and payment metadata (deposits, refunds, commission share).
        </Text>

        <Text style={styles.h2}>What We Collect</Text>
        <Bullet text="Account details: email, hashed password (bcrypt), display name." />
        <Bullet text="Booking data: artist, date, description, reference photo you upload, payment status." />
        <Bullet text="Messages you send to artists in the in-app chat." />
        <Bullet text="Favorites, reviews and preferences (language, wishlist)." />

        <Text style={styles.h2}>How We Use It</Text>
        <Bullet text="To run bookings, deposits, refunds and messaging." />
        <Bullet text="To compute artist earnings and INKED's 15% platform commission." />
        <Bullet text="To provide personalized recommendations (Artist of the Week)." />

        <Text style={styles.h2}>Payments</Text>
        <Text style={styles.body}>
          Payments run through Stripe. INKED never sees or stores your card number. In test/demo
          mode, no real money moves — bookings are marked paid via our sandbox flow only.
        </Text>

        <Text style={styles.h2}>Your Rights</Text>
        <Bullet text="You can delete your account any time from Profile → Delete My Account. That permanently removes your account, bookings, messages, favorites and reviews from our systems." />
        <Bullet text="You can toggle language (English / Tagalog) any time from Profile." />
        <Bullet text="You can email support@inked.dev for any data question." />

        <Text style={styles.h2}>Terms of Use</Text>
        <Bullet text="You must be 18+ to book a tattoo session on INKED." />
        <Bullet text="Deposits are refundable if you cancel more than 48 hours before your session." />
        <Bullet text="You are responsible for the accuracy of the address you provide for home service." />

        <Text style={styles.footer}>INKED · v1.0.0</Text>
      </ScrollView>
    </View>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={styles.bullet}>
      <View style={styles.dot} />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 2, borderBottomColor: colors.borderStrong },
  title: { color: colors.onSurface, fontSize: 16, fontWeight: "900", letterSpacing: 2 },
  h1: { color: colors.onSurface, fontSize: 28, fontWeight: "900", letterSpacing: 2, marginBottom: spacing.md },
  h2: { color: colors.brand, fontSize: 12, fontWeight: "900", letterSpacing: 2, marginTop: spacing.xl, marginBottom: spacing.sm },
  body: { color: colors.onSurfaceSecondary, fontSize: 14, lineHeight: 22 },
  bullet: { flexDirection: "row", gap: spacing.sm, marginTop: 6 },
  dot: { width: 6, height: 6, backgroundColor: colors.brand, marginTop: 8 },
  bulletText: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 14, lineHeight: 22 },
  footer: { color: colors.muted, fontSize: 10, letterSpacing: 2, marginTop: spacing["2xl"], textAlign: "center" },
});
