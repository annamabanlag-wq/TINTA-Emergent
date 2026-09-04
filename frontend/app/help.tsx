import { View, Text, StyleSheet, ScrollView, Pressable, Linking } from "react-native";
import { useRouter } from "expo-router";
import Icon from "@react-native-vector-icons/feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing } from "../src/theme";

export default function HelpScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable onPress={() => router.back()} testID="back" hitSlop={12}>
          <Icon name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>HELP CENTER</Text>
        <View style={{ width: 22 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}>
        <Text style={styles.h1}>Get Ink’d, We’ve Got You</Text>

        <Faq q="How do I book a tattoo session?" a="Open Discover, tap an artist, then Book Session. Pick a date and time, describe your idea, add a reference photo if you like, then pay the ₱2,900 deposit." />
        <Faq q="Can the artist come to me?" a="Yes — for artists that offer HOME SERVICE, toggle it in Step 2 of the booking flow and enter your address. A travel fee is added on top." />
        <Faq q="How do refunds work?" a="Cancel more than 48 hours before your session and we auto-refund your deposit. Within 48 hours the deposit is non-refundable." />
        <Faq q="How do I message my artist?" a="After booking, open the Messages tab or the chat button on the artist's page. They reply within a day, usually much sooner." />
        <Faq q="Where are my past sessions?" a="Bookings tab → Past. Tap Book Again to rebook the same artist in one tap." />
        <Faq q="How do I change the language?" a="Profile → Language. Toggle between English and Tagalog any time." />

        <Text style={styles.h2}>Still stuck?</Text>
        <Pressable
          testID="email-support"
          onPress={() => Linking.openURL("mailto:support@inked.dev")}
          style={styles.cta}
        >
          <Icon name="mail" size={14} color={colors.onBrand} />
          <Text style={styles.ctaText}>EMAIL SUPPORT</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <View style={styles.faq}>
      <Text style={styles.q}>{q}</Text>
      <Text style={styles.a}>{a}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 2, borderBottomColor: colors.borderStrong },
  title: { color: colors.onSurface, fontSize: 16, fontWeight: "900", letterSpacing: 2 },
  h1: { color: colors.onSurface, fontSize: 28, fontWeight: "900", letterSpacing: 2, marginBottom: spacing.lg },
  h2: { color: colors.brand, fontSize: 12, fontWeight: "900", letterSpacing: 2, marginTop: spacing.xl, marginBottom: spacing.sm },
  faq: { marginTop: spacing.md, padding: spacing.md, borderWidth: 2, borderColor: colors.borderStrong, backgroundColor: colors.surfaceSecondary },
  q: { color: colors.onSurface, fontSize: 13, fontWeight: "900", letterSpacing: 0.5, marginBottom: 6 },
  a: { color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 20 },
  cta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brand, paddingVertical: spacing.md, borderWidth: 2, borderColor: colors.borderStrong },
  ctaText: { color: colors.onBrand, fontSize: 13, fontWeight: "900", letterSpacing: 2 },
});
