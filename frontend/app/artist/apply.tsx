import { useEffect, useState } from "react";
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useSession } from "../../src/session";
import { API_URL, api, uploadImage } from "../../src/api";
import { colors, spacing } from "../../src/theme";

function fileUrl(path: string, token: string) {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return `${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
  }
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `${API_URL}/files/${encoded}?token=${encodeURIComponent(token)}`;
}

export default function ArtistApply() {
  const router = useRouter();
  const { token, loading: sessionLoading } = useSession();
  const [status, setStatus] = useState("loading");

  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [city, setCity] = useState("");
  const [studio, setStudio] = useState("");
  const [stylesText, setStylesText] = useState("");
  const [bio, setBio] = useState("");
  const [rate, setRate] = useState("");
  const [phone, setPhone] = useState("");
  const [serviceArea, setServiceArea] = useState("");
  const [avatar, setAvatar] = useState("");
  const [hero, setHero] = useState("");
  const [portfolio, setPortfolio] = useState("");

  const [governmentIdPath, setGovernmentIdPath] = useState("");
  const [completedWorkPaths, setCompletedWorkPaths] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploadingId, setUploadingId] = useState(false);
  const [uploadingWork, setUploadingWork] = useState(false);

  useEffect(() => {
    if (sessionLoading) return;
    if (!token) {
      setStatus("signed_out");
      return;
    }

    let cancelled = false;
    api<any>("/artist-applications/me", {}, token)
      .then((r) => {
        if (cancelled) return;
        if (r.status === "approved") {
          router.replace("/artist/portal");
          return;
        }
        setStatus(r.status || "not_started");
        if (r.status === "rejected") {
          setName(r.name || "");
          setHandle(r.handle || "");
          setCity(r.city || "");
          setStudio(r.studio || "");
          setStylesText((r.styles || []).join(", "));
          setBio(r.bio || "");
          setRate(r.rate_per_hour ? String(r.rate_per_hour) : "");
          setPhone(r.phone || "");
          setServiceArea(r.service_area || "");
          setAvatar(r.avatar || "");
          setHero(r.hero || "");
          setPortfolio((r.portfolio || []).join(", "));
          setGovernmentIdPath(r.government_id_path || "");
          setCompletedWorkPaths(Array.isArray(r.completed_work_paths) ? r.completed_work_paths : []);
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("not_started");
      });

    return () => {
      cancelled = true;
    };
  }, [router, sessionLoading, token]);

  const pickGovernmentId = async () => {
    if (!token || uploadingId || busy) return;
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted && typeof window === "undefined") {
        Alert.alert("Permission required", "Please allow photo library access to upload your government ID.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: false,
        quality: 0.9,
      });
      if (result.canceled || !result.assets?.[0]) return;

      setUploadingId(true);
      const asset = result.assets[0] as any;
      const filename = asset.file?.name || `government-id-${Date.now()}.jpg`;
      const out = await uploadImage(asset.uri, token, filename, asset.file);
      setGovernmentIdPath(out.path);
    } catch (e: any) {
      Alert.alert("ID upload failed", e?.message || "Please choose the ID photo again.");
    } finally {
      setUploadingId(false);
    }
  };

  const pickFinishedWork = async () => {
    if (!token || uploadingWork || busy) return;
    const remaining = 12 - completedWorkPaths.length;
    if (remaining <= 0) {
      Alert.alert("Portfolio limit", "You can upload up to 12 finished tattoo work photos.");
      return;
    }

    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted && typeof window === "undefined") {
        Alert.alert("Permission required", "Please allow photo library access to upload your tattoo work.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        selectionLimit: remaining,
        quality: 0.85,
      });
      if (result.canceled || !result.assets?.length) return;

      setUploadingWork(true);
      const uploaded: string[] = [];
      for (let i = 0; i < result.assets.length; i += 1) {
        const asset = result.assets[i] as any;
        const filename = asset.file?.name || `finished-tattoo-${Date.now()}-${i}.jpg`;
        const out = await uploadImage(asset.uri, token, filename, asset.file);
        if (out.path) uploaded.push(out.path);
      }
      if (!uploaded.length) throw new Error("No finished tattoo work images were uploaded.");
      setCompletedWorkPaths((current) => [...current, ...uploaded].slice(0, 12));
    } catch (e: any) {
      Alert.alert("Work upload failed", e?.message || "Please choose the tattoo photos again.");
    } finally {
      setUploadingWork(false);
    }
  };

  const removeWork = (index: number) => {
    setCompletedWorkPaths((current) => current.filter((_, i) => i !== index));
  };

  const submit = async () => {
    if (!token) {
      router.replace({ pathname: "/(auth)/sign-up", params: { role: "artist" } });
      return;
    }
    if (!name.trim() || !handle.trim() || !city.trim() || !studio.trim() || bio.trim().length < 10 || !rate) {
      Alert.alert("Missing information", "Please complete the required profile fields.");
      return;
    }
    if (!governmentIdPath) {
      Alert.alert("Government ID required", "Upload a clear photo of your government-issued ID before submitting.");
      return;
    }
    if (!completedWorkPaths.length) {
      Alert.alert("Finished tattoo work required", "Upload at least one photo of your finished tattoo work before submitting.");
      return;
    }

    setBusy(true);
    try {
      const result = await api<any>(
        "/artist-applications",
        {
          method: "POST",
          body: JSON.stringify({
            name: name.trim(),
            handle: handle.trim().replace(/^@/, ""),
            city: city.trim(),
            studio: studio.trim(),
            styles: stylesText.split(",").map((x) => x.trim()).filter(Boolean),
            bio: bio.trim(),
            rate_per_hour: Number(rate),
            phone: phone.trim(),
            service_area: serviceArea.trim(),
            avatar: avatar.trim(),
            hero: hero.trim(),
            portfolio: portfolio.split(",").map((x) => x.trim()).filter(Boolean),
            government_id_path: governmentIdPath,
            completed_work_paths: completedWorkPaths,
            home_service_available: false,
            home_service_fee: 0,
          }),
        },
        token,
      );
      setStatus(result.status || "pending");
      Alert.alert("Application submitted", "Your profile, government ID, and finished tattoo work are now pending TINTA admin verification.");
    } catch (e: any) {
      Alert.alert("Could not submit", e?.message || "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (sessionLoading || status === "loading") {
    return <View style={styles.center}><Text style={styles.title}>LOADING...</Text></View>;
  }

  if (status === "signed_out") {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>BECOME A TINTA ARTIST</Text>
        <Text style={styles.muted}>Create your dedicated artist account, then complete your profile for admin approval.</Text>
        <Pressable style={styles.cta} onPress={() => router.replace({ pathname: "/(auth)/sign-up", params: { role: "artist" } })}><Text style={styles.ctaText}>CREATE ARTIST ACCOUNT</Text></Pressable>
        <Pressable style={styles.secondary} onPress={() => router.replace("/(auth)/artist-sign-in")}><Text style={styles.secondaryText}>ALREADY HAVE AN ACCOUNT? SIGN IN</Text></Pressable>
      </View>
    );
  }

  if (status === "pending") {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>APPLICATION PENDING</Text>
        <Text style={styles.muted}>Your profile and verification documents are waiting for TINTA admin review.</Text>
        <Pressable style={styles.secondary} onPress={() => router.replace("/(auth)/artist-sign-in")}><Text style={styles.secondaryText}>GO BACK</Text></Pressable>
      </View>
    );
  }

  if (status === "approved") return null;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>BECOME AN{"\n"}ARTIST</Text>
      <Text style={styles.subtitle}>SUBMIT YOUR PROFILE FOR VERIFICATION</Text>
      <Text style={styles.notice}>TINTA requires a government-issued ID and proof of completed tattoo work. These verification documents are private and are shown only to authorized TINTA admins.</Text>

      {[
        ["NAME", name, setName],
        ["HANDLE", handle, setHandle],
        ["CITY", city, setCity],
        ["STUDIO", studio, setStudio],
        ["STYLES (COMMA SEPARATED)", stylesText, setStylesText],
        ["BIO", bio, setBio],
        ["RATE PER HOUR (PHP)", rate, setRate],
        ["PHONE", phone, setPhone],
        ["SERVICE AREA", serviceArea, setServiceArea],
        ["AVATAR URL (OPTIONAL)", avatar, setAvatar],
        ["HERO IMAGE URL (OPTIONAL)", hero, setHero],
        ["PORTFOLIO URLS (OPTIONAL, COMMA SEPARATED)", portfolio, setPortfolio],
      ].map(([label, value, setter]: any) => (
        <View key={label}>
          <Text style={styles.label}>{label}</Text>
          <TextInput
            value={value}
            onChangeText={setter}
            multiline={label === "BIO"}
            keyboardType={label.includes("RATE") ? "numeric" : "default"}
            placeholder={label}
            placeholderTextColor={colors.muted}
            style={[styles.input, label === "BIO" && styles.bio]}
          />
        </View>
      ))}

      <View style={styles.uploadCard}>
        <Text style={styles.uploadTitle}>GOVERNMENT-ISSUED ID *</Text>
        <Text style={styles.mutedSmall}>Upload one clear photo of a valid government ID. TINTA admin uses this only for identity verification.</Text>
        <Pressable disabled={uploadingId || busy} onPress={pickGovernmentId} style={[styles.secondary, (uploadingId || busy) && styles.disabled]}>
          <Text style={styles.secondaryText}>{uploadingId ? "UPLOADING ID..." : governmentIdPath ? "REPLACE GOVERNMENT ID" : "UPLOAD GOVERNMENT ID"}</Text>
        </Pressable>
        <Text style={governmentIdPath ? styles.success : styles.required}>{governmentIdPath ? "✓ GOVERNMENT ID UPLOADED" : "REQUIRED BEFORE SUBMIT"}</Text>
        {governmentIdPath && token ? <Image source={{ uri: fileUrl(governmentIdPath, token) }} style={styles.idPreview} resizeMode="contain" /> : null}
      </View>

      <View style={styles.uploadCard}>
        <Text style={styles.uploadTitle}>FINISHED TATTOO WORK *</Text>
        <Text style={styles.mutedSmall}>Upload at least 1 clear photo of your own completed tattoo work. Up to 12 photos.</Text>
        <Pressable disabled={uploadingWork || busy} onPress={pickFinishedWork} style={[styles.cta, (uploadingWork || busy) && styles.disabled]}>
          <Text style={styles.ctaText}>{uploadingWork ? "UPLOADING WORK..." : "UPLOAD FINISHED TATTOO WORK"}</Text>
        </Pressable>
        <Text style={completedWorkPaths.length ? styles.success : styles.required}>
          {completedWorkPaths.length ? `✓ ${completedWorkPaths.length} FINISHED WORK PHOTO${completedWorkPaths.length === 1 ? "" : "S"} READY` : "AT LEAST 1 PHOTO REQUIRED"}
        </Text>
        {!!completedWorkPaths.length && token ? (
          <View style={styles.workGrid}>
            {completedWorkPaths.map((path, index) => (
              <View key={`${path}-${index}`} style={styles.workCard}>
                <Image source={{ uri: fileUrl(path, token) }} style={styles.workImage} resizeMode="cover" />
                <Pressable disabled={busy} onPress={() => removeWork(index)} style={styles.removeButton}><Text style={styles.remove}>REMOVE</Text></Pressable>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      <Pressable disabled={busy || uploadingId || uploadingWork} onPress={submit} style={[styles.cta, (busy || uploadingId || uploadingWork) && styles.disabled]}>
        <Text style={styles.ctaText}>{busy ? "SUBMITTING..." : "SUBMIT FOR VERIFICATION"}</Text>
      </Pressable>
      <Pressable disabled={busy} style={styles.secondary} onPress={() => router.back()}><Text style={styles.secondaryText}>CANCEL</Text></Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  form: { padding: spacing.lg, gap: spacing.md },
  center: { flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", padding: spacing.lg, gap: spacing.md },
  title: { color: colors.onSurface, fontSize: 38, fontWeight: "900", letterSpacing: 2, lineHeight: 40, textAlign: "center" },
  subtitle: { color: colors.brand, fontSize: 11, fontWeight: "800", letterSpacing: 2, marginBottom: spacing.lg },
  notice: { color: colors.muted, fontSize: 13, lineHeight: 20, borderWidth: 1, borderColor: colors.border, padding: 14 },
  label: { color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 1.5, marginTop: spacing.sm },
  input: { backgroundColor: colors.surfaceSecondary, borderWidth: 2, borderColor: colors.border, color: colors.onSurface, padding: 14, fontSize: 15 },
  bio: { minHeight: 110, textAlignVertical: "top" },
  uploadCard: { borderWidth: 2, borderColor: colors.border, padding: 16, gap: 10 },
  uploadTitle: { color: colors.onSurface, fontSize: 14, fontWeight: "900", letterSpacing: 1.5 },
  muted: { color: colors.muted, textAlign: "center", fontSize: 15, lineHeight: 24 },
  mutedSmall: { color: colors.muted, fontSize: 12, lineHeight: 19 },
  required: { color: colors.brand, fontSize: 10, fontWeight: "900", letterSpacing: 1.2 },
  success: { color: colors.onSurface, fontSize: 10, fontWeight: "900", letterSpacing: 1.2 },
  cta: { backgroundColor: colors.brand, padding: 18, alignItems: "center", marginTop: spacing.lg },
  ctaText: { color: colors.onBrand, fontSize: 14, fontWeight: "900", letterSpacing: 2 },
  secondary: { borderWidth: 2, borderColor: colors.borderStrong, padding: 15, alignItems: "center", width: "100%" },
  secondaryText: { color: colors.onSurface, fontWeight: "800", letterSpacing: 2, textAlign: "center" },
  disabled: { opacity: 0.5 },
  idPreview: { width: "100%", height: 220, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  workGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  workCard: { width: 145, borderWidth: 1, borderColor: colors.border, padding: 6, gap: 6 },
  workImage: { width: "100%", height: 145, backgroundColor: colors.surfaceSecondary },
  removeButton: { borderWidth: 1, borderColor: colors.borderStrong, padding: 8, alignItems: "center" },
  remove: { color: colors.brand, fontWeight: "900", fontSize: 9, letterSpacing: 1, textAlign: "center" },
});
