import { useCallback, useEffect, useState } from "react";
import { ScrollView, View, Text, Pressable, StyleSheet, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import Icon from "@react-native-vector-icons/feather";
import { useSession } from "../../src/session";
import { api } from "../../src/api";
import { colors, spacing } from "../../src/theme";

type PortalData = {
  artist: { name: string; handle: string; city: string; studio: string; rate_per_hour: number; rating: number; reviews_count: number; blocked_dates?: string[] };
  pending_earnings: number;
  pending_count: number;
  paid_out: number;
  paid_count: number;
};
type ArtistBooking = { id: string; date: string; time_slot: string; description: string; estimated_hours: number; customer_name: string; status: string; payment_status: string; artist_earnings?: number };

const php = (n: number) => `₱${Number(n || 0).toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;

export default function ArtistPortal() {
  const router = useRouter();
  const { token, user, signOut } = useSession();
  const [data, setData] = useState<PortalData | null>(null);
  const [bookings, setBookings] = useState<ArtistBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setError("");
    try {
      const [me, bs] = await Promise.all([
        api<PortalData>("/artist/me", {}, token),
        api<ArtistBooking[]>("/artist/bookings", {}, token),
      ]);
      setData(me);
      setBookings(bs);
    } catch (e: any) {
      setError(e?.message || "Could not load artist portal.");
    }
  }, [token]);

  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]);

  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };
  const upcoming = bookings.filter(b => b.status !== "cancelled").slice(0, 5);

  if (!token) {
    return <View style={styles.center}><Text style={styles.title}>ARTIST SIGN IN REQUIRED</Text><Pressable style={styles.cta} onPress={() => router.replace("/(auth)/artist-sign-in")}><Text style={styles.ctaText}>SIGN IN AS ARTIST</Text></Pressable></View>;
  }
  if (loading) return <View style={styles.center}><Text style={styles.title}>LOADING ARTIST PORTAL...</Text></View>;

  return <ScrollView style={styles.root} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
    <View style={styles.header}>
      <View><Text style={styles.kicker}>TINTA ARTIST</Text><Text style={styles.titleLeft}>ARTIST PORTAL</Text><Text style={styles.muted}>{data?.artist?.name || user?.name || "Artist"}</Text></View>
      <Pressable accessibilityRole="button" onPress={() => signOut()} style={styles.iconButton}><Icon name="log-out" size={20} color={colors.onSurface} /></Pressable>
    </View>

    {error ? <View style={styles.error}><Text style={styles.errorText}>{error}</Text><Pressable onPress={refresh}><Text style={styles.link}>RETRY</Text></Pressable></View> : null}

    <View style={styles.heroCard}><View><Text style={styles.small}>STATUS</Text><Text style={styles.approved}>APPROVED · LIVE</Text><Text style={styles.handle}>@{data?.artist?.handle || "artist"} · {data?.artist?.city || ""}</Text></View><Icon name="check-circle" size={34} color={colors.brand} /></View>

    <View style={styles.grid}>
      <View style={styles.stat}><Text style={styles.small}>PENDING EARNINGS</Text><Text style={styles.statValue}>{php(data?.pending_earnings || 0)}</Text><Text style={styles.muted}>{data?.pending_count || 0} paid booking(s)</Text></View>
      <View style={styles.stat}><Text style={styles.small}>PAID OUT</Text><Text style={styles.statValue}>{php(data?.paid_out || 0)}</Text><Text style={styles.muted}>{data?.paid_count || 0} payout entry(s)</Text></View>
    </View>

    <Text style={styles.section}>QUICK ACTIONS</Text>
    <View style={styles.actions}>
      <Action icon="calendar" label="BOOKINGS" onPress={() => router.push("/artist/bookings")} />
      <Action icon="clock" label="AVAILABILITY" onPress={() => router.push("/artist/availability")} />
      <Action icon="message-square" label="MESSAGES" onPress={() => router.push("/artist/messages")} />
      <Action icon="user" label="MY PROFILE" onPress={() => router.push("/artist/profile")} />
      <Action icon="dollar-sign" label="EARNINGS" onPress={() => router.push("/artist/earnings")} />
    </View>

    <Text style={styles.section}>UPCOMING BOOKINGS</Text>
    {upcoming.length === 0 ? <View style={styles.empty}><Text style={styles.muted}>NO UPCOMING BOOKINGS</Text></View> : upcoming.map(b => <View key={b.id} style={styles.booking}><View style={styles.bookingTop}><Text style={styles.bookingDate}>{b.date} · {b.time_slot}</Text><Text style={styles.badge}>{b.status.toUpperCase()}</Text></View><Text style={styles.customer}>{b.customer_name}</Text><Text style={styles.muted} numberOfLines={2}>{b.description}</Text><Text style={styles.bookingMeta}>{b.estimated_hours} HR · PAYMENT {b.payment_status.toUpperCase()}</Text></View>)}

    <Text style={styles.section}>PROFILE SNAPSHOT</Text>
    <View style={styles.profile}><Text style={styles.profileName}>{data?.artist?.name}</Text><Text style={styles.muted}>{data?.artist?.studio} · {php(data?.artist?.rate_per_hour || 0)}/HR</Text><Text style={styles.muted}>★ {data?.artist?.rating || 0} ({data?.artist?.reviews_count || 0} reviews)</Text></View>
  </ScrollView>;
}

function Action({ icon, label, onPress }: { icon: any; label: string; onPress: () => void }) {
  return <Pressable style={styles.action} onPress={onPress}><Icon name={icon} size={20} color={colors.brand} /><Text style={styles.actionText}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  root:{flex:1,backgroundColor:colors.surface}, content:{padding:spacing.lg,gap:spacing.md,maxWidth:1100,width:"100%",alignSelf:"center",paddingBottom:60},
  header:{flexDirection:"row",justifyContent:"space-between",alignItems:"flex-start",paddingBottom:spacing.md,borderBottomWidth:2,borderBottomColor:colors.borderStrong},
  kicker:{color:colors.brand,fontSize:11,fontWeight:"900",letterSpacing:2}, titleLeft:{color:colors.onSurface,fontSize:34,fontWeight:"900",letterSpacing:2,lineHeight:38},
  title:{color:colors.onSurface,fontSize:28,fontWeight:"900",letterSpacing:2,textAlign:"center"}, muted:{color:colors.muted,fontSize:13,lineHeight:20}, iconButton:{borderWidth:2,borderColor:colors.borderStrong,padding:12},
  heroCard:{borderWidth:2,borderColor:colors.brand,padding:18,flexDirection:"row",justifyContent:"space-between",alignItems:"center",backgroundColor:colors.surfaceSecondary}, small:{color:colors.muted,fontSize:9,fontWeight:"900",letterSpacing:1.5}, approved:{color:colors.brand,fontSize:18,fontWeight:"900",letterSpacing:1.5,marginTop:4}, handle:{color:colors.onSurface,fontSize:13,marginTop:5},
  grid:{flexDirection:"row",gap:spacing.md,flexWrap:"wrap"}, stat:{flex:1,minWidth:220,borderWidth:2,borderColor:colors.border,padding:18}, statValue:{color:colors.onSurface,fontSize:28,fontWeight:"900",marginVertical:5},
  section:{color:colors.brand,fontSize:11,fontWeight:"900",letterSpacing:2,marginTop:spacing.md}, actions:{flexDirection:"row",flexWrap:"wrap",gap:spacing.sm}, action:{borderWidth:2,borderColor:colors.borderStrong,padding:15,flexDirection:"row",alignItems:"center",gap:10,minWidth:160,flexGrow:1}, actionText:{color:colors.onSurface,fontWeight:"900",letterSpacing:1.3,fontSize:11},
  booking:{borderWidth:2,borderColor:colors.border,padding:16,gap:7}, bookingTop:{flexDirection:"row",justifyContent:"space-between",gap:10}, bookingDate:{color:colors.onSurface,fontWeight:"900",fontSize:14}, badge:{color:colors.brand,fontSize:9,fontWeight:"900",letterSpacing:1}, customer:{color:colors.onSurface,fontSize:17,fontWeight:"900"}, bookingMeta:{color:colors.muted,fontSize:10,fontWeight:"800",letterSpacing:1}, empty:{borderWidth:2,borderColor:colors.border,padding:30,alignItems:"center"}, profile:{borderWidth:2,borderColor:colors.border,padding:18,gap:5}, profileName:{color:colors.onSurface,fontSize:20,fontWeight:"900"}, error:{borderWidth:2,borderColor:colors.brand,padding:14,gap:8}, errorText:{color:colors.onSurface}, link:{color:colors.brand,fontWeight:"900",letterSpacing:1.5}, center:{flex:1,backgroundColor:colors.surface,alignItems:"center",justifyContent:"center",padding:spacing.lg,gap:spacing.md}, cta:{backgroundColor:colors.brand,padding:17,alignItems:"center"}, ctaText:{color:colors.onBrand,fontWeight:"900",letterSpacing:2}
});
