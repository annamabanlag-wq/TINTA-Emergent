import { useEffect, useState } from "react";
import { ScrollView, View, Text, TextInput, Pressable, StyleSheet, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useSession } from "../../src/session";
import { api } from "../../src/api";
import { colors, spacing } from "../../src/theme";

export default function ArtistApply() {
  const router = useRouter();
  const { token, loading: sessionLoading } = useSession();
  const [status, setStatus] = useState("loading");
  const [name, setName] = useState(""); const [handle, setHandle] = useState("");
  const [city, setCity] = useState(""); const [studio, setStudio] = useState("");
  const [stylesText, setStylesText] = useState(""); const [bio, setBio] = useState("");
  const [rate, setRate] = useState(""); const [avatar, setAvatar] = useState("");
  const [hero, setHero] = useState(""); const [portfolio, setPortfolio] = useState("");
  const [phone, setPhone] = useState(""); const [serviceArea, setServiceArea] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (sessionLoading) return;
    if (!token) { setStatus("signed_out"); return; }
    let cancelled = false;
    setStatus("loading");
    api<any>("/artist-applications/me", {}, token)
      .then((r) => {
        if (cancelled) return;
        setStatus(r.status || "not_started");
        if (r.status === "rejected" || r.status === "approved") {
          setName(r.name || ""); setHandle(r.handle || ""); setCity(r.city || "");
          setStudio(r.studio || ""); setBio(r.bio || ""); setRate(r.rate_per_hour ? String(r.rate_per_hour) : "");
        }
      })
      .catch(() => { if (!cancelled) setStatus("not_started"); });
    return () => { cancelled = true; };
  }, [token, sessionLoading]);

  const submit = async () => {
    if (!token) return router.replace({ pathname: "/(auth)/sign-up", params: { role: "artist" } });
    if (!name || !handle || !city || !studio || bio.length < 10 || !rate) {
      return Alert.alert("Missing information", "Please complete the required fields.");
    }
    setBusy(true);
    try {
      const r = await api<any>("/artist-applications", {
        method: "POST",
        body: JSON.stringify({
          name, handle, city, studio,
          styles: stylesText.split(",").map(x => x.trim()).filter(Boolean),
          bio, rate_per_hour: Number(rate), avatar, hero,
          portfolio: portfolio.split(",").map(x => x.trim()).filter(Boolean),
          phone, service_area: serviceArea,
          home_service_available: false, home_service_fee: 0
        })
      }, token);
      setStatus(r.status || "pending");
      Alert.alert("Application submitted", "Your artist profile is now pending admin verification.");
    } catch (e: any) { Alert.alert("Could not submit", e?.message || "Please try again."); }
    finally { setBusy(false); }
  };

  if (sessionLoading || status === "loading") {
    return <View style={styles.center}><Text style={styles.title}>LOADING...</Text></View>;
  }

  if (status === "signed_out") {
    return <View style={styles.center}>
      <Text style={styles.title}>BECOME A TINTA ARTIST</Text>
      <Text style={styles.muted}>Create your dedicated artist account first. Verify your email, sign in, then complete your artist profile for admin approval.</Text>
      <Pressable style={styles.cta} onPress={() => router.replace({ pathname: "/(auth)/sign-up", params: { role: "artist" } })}>
        <Text style={styles.ctaText}>CREATE ARTIST ACCOUNT</Text>
      </Pressable>
      <Pressable style={styles.secondary} onPress={() => router.replace("/(auth)/artist-sign-in")}>
        <Text style={styles.secondaryText}>ALREADY HAVE AN ACCOUNT? SIGN IN</Text>
      </Pressable>
      <Pressable style={styles.secondary} onPress={() => router.back()}>
        <Text style={styles.secondaryText}>GO BACK</Text>
      </Pressable>
    </View>;
  }

  if (status === "pending") return <View style={styles.center}><Text style={styles.title}>APPLICATION PENDING</Text><Text style={styles.muted}>Your artist profile is waiting for admin verification.</Text><Pressable style={styles.secondary} onPress={() => router.back()}><Text style={styles.secondaryText}>GO BACK</Text></Pressable></View>;
  if (status === "approved") return <View style={styles.center}><Text style={styles.title}>APPROVED</Text><Text style={styles.muted}>Your artist profile is live and visible to customers.</Text><Pressable style={styles.secondary} onPress={() => router.back()}><Text style={styles.secondaryText}>GO BACK</Text></Pressable></View>;

  return <ScrollView style={styles.root} contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
    <Text style={styles.title}>BECOME AN{"\n"}ARTIST</Text><Text style={styles.subtitle}>SUBMIT YOUR PROFILE FOR VERIFICATION</Text>
    {[["NAME",name,setName],["HANDLE",handle,setHandle],["CITY",city,setCity],["STUDIO",studio,setStudio],["STYLES (COMMA SEPARATED)",stylesText,setStylesText],["BIO",bio,setBio],["RATE PER HOUR (PHP)",rate,setRate],["PHONE",phone,setPhone],["SERVICE AREA",serviceArea,setServiceArea],["AVATAR URL",avatar,setAvatar],["HERO IMAGE URL",hero,setHero],["PORTFOLIO URLS (COMMA SEPARATED)",portfolio,setPortfolio]].map(([label,value,setter]: any) => <View key={label}><Text style={styles.label}>{label}</Text><TextInput value={value} onChangeText={setter} multiline={label === "BIO"} keyboardType={label.includes("RATE") ? "numeric" : "default"} placeholder={label} placeholderTextColor={colors.muted} style={[styles.input, label === "BIO" && styles.bio]} /></View>)}
    <Pressable disabled={busy} onPress={submit} style={[styles.cta, busy && { opacity: .5 }]}><Text style={styles.ctaText}>{busy ? "SUBMITTING..." : "SUBMIT FOR VERIFICATION"}</Text></Pressable>
    <Pressable style={styles.secondary} onPress={() => router.back()}><Text style={styles.secondaryText}>CANCEL</Text></Pressable>
  </ScrollView>;
}
const styles = StyleSheet.create({ root:{flex:1,backgroundColor:colors.surface}, form:{padding:spacing.lg,gap:spacing.md}, center:{flex:1,backgroundColor:colors.surface,alignItems:"center",justifyContent:"center",padding:spacing.lg,gap:spacing.md}, title:{color:colors.onSurface,fontSize:38,fontWeight:"900",letterSpacing:2,lineHeight:40,textAlign:"center"}, subtitle:{color:colors.brand,fontSize:11,fontWeight:"800",letterSpacing:2,marginBottom:spacing.lg}, label:{color:colors.muted,fontSize:10,fontWeight:"800",letterSpacing:1.5,marginTop:spacing.sm}, input:{backgroundColor:colors.surfaceSecondary,borderWidth:2,borderColor:colors.border,color:colors.onSurface,padding:14,fontSize:15},bio:{minHeight:110,textAlignVertical:"top"},cta:{backgroundColor:colors.brand,padding:18,alignItems:"center",marginTop:spacing.lg},ctaText:{color:colors.onBrand,fontSize:14,fontWeight:"900",letterSpacing:2,textAlign:"center"},secondary:{borderWidth:2,borderColor:colors.borderStrong,padding:15,alignItems:"center",width:"100%"},secondaryText:{color:colors.onSurface,fontWeight:"800",letterSpacing:2,textAlign:"center"},muted:{color:colors.muted,textAlign:"center",fontSize:15,lineHeight:24} });