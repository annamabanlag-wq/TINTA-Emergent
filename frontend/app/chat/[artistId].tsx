import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Image } from "expo-image";
import Icon from "@react-native-vector-icons/feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, Message, Artist } from "../../src/api";
import { useSession } from "../../src/session";
import { colors, spacing } from "../../src/theme";

export default function ChatScreen() {
  const { artistId } = useLocalSearchParams<{ artistId: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token, user } = useSession();
  const [artist, setArtist] = useState<Artist | null>(null);
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<Message>>(null);

  const load = useCallback(async () => {
    try {
      const [a, m] = await Promise.all([
        api<Artist>(`/artists/${artistId}`),
        api<Message[]>(`/threads/${artistId}/messages`, {}, token),
      ]);
      setArtist(a);
      setMsgs(m);
    } finally { setLoading(false); }
  }, [artistId, token]);

  useEffect(() => { load(); }, [load]);

  const send = async () => {
    if (!text.trim() || sending) return;
    const t = text.trim();
    setText("");
    setSending(true);
    try {
      await api("/messages", { method: "POST", body: JSON.stringify({ artist_id: artistId, text: t }) }, token);
      const m = await api<Message[]>(`/threads/${artistId}/messages`, {}, token);
      setMsgs(m);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    } finally { setSending(false); }
  };

  if (loading || !artist) {
    return <View style={styles.center}><ActivityIndicator color={colors.brand} size="large" /></View>;
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={0}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="chat-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Icon name="arrow-left" size={20} color={colors.onSurface} />
        </Pressable>
        <Image source={artist.avatar} style={styles.headerAvatar} contentFit="cover" />
        <View style={{ flex: 1 }}>
          <Text style={styles.headerName}>{artist.name.toUpperCase()}</Text>
          <Text style={styles.headerSub}>{artist.handle}</Text>
        </View>
        <Pressable testID="chat-view-profile" onPress={() => router.push(`/artist/${artist.id}`)} style={styles.iconBtn}>
          <Icon name="info" size={20} color={colors.onSurface} />
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        data={msgs}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xl }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={
          <View style={{ padding: spacing.xl, alignItems: "center" }}>
            <Text style={styles.emptyText}>START THE CONVERSATION</Text>
            <Text style={styles.emptySub}>SAY HI TO {artist.name.toUpperCase()}</Text>
          </View>
        }
        renderItem={({ item }) => {
          const mine = item.from_role === "user";
          return (
            <View style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs]}>
              <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                <Text style={[styles.bubbleText, mine && { color: colors.onBrand }]}>{item.text}</Text>
              </View>
            </View>
          );
        }}
      />

      <View style={[styles.inputBar, { paddingBottom: insets.bottom + spacing.sm }]}>
        <TextInput
          testID="chat-input"
          value={text}
          onChangeText={setText}
          placeholder="TYPE MESSAGE..."
          placeholderTextColor={colors.muted}
          style={styles.input}
          multiline
          maxLength={500}
        />
        <Pressable testID="chat-send" onPress={send} disabled={!text.trim() || sending} style={[styles.sendBtn, (!text.trim() || sending) && { opacity: 0.5 }]}>
          <Icon name="send" size={20} color={colors.onBrand} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, paddingBottom: spacing.md, borderBottomWidth: 2, borderBottomColor: colors.borderStrong },
  iconBtn: { width: 40, height: 40, borderWidth: 2, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  headerAvatar: { width: 40, height: 40, borderWidth: 2, borderColor: colors.borderStrong },
  headerName: { color: colors.onSurface, fontSize: 14, fontWeight: "900", letterSpacing: 1 },
  headerSub: { color: colors.brand, fontSize: 11, fontWeight: "800", letterSpacing: 1.5 },
  bubbleRow: { flexDirection: "row" },
  rowMine: { justifyContent: "flex-end" },
  rowTheirs: { justifyContent: "flex-start" },
  bubble: { maxWidth: "80%", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 2 },
  bubbleMine: { backgroundColor: colors.brand, borderColor: colors.brand },
  bubbleTheirs: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
  bubbleText: { color: colors.onSurface, fontSize: 14, lineHeight: 20 },
  emptyText: { color: colors.onSurface, fontSize: 20, fontWeight: "900", letterSpacing: 2 },
  emptySub: { color: colors.muted, fontSize: 12, fontWeight: "800", letterSpacing: 1.5, marginTop: 4 },
  inputBar: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, padding: spacing.sm, borderTopWidth: 2, borderTopColor: colors.borderStrong, backgroundColor: colors.surface },
  input: { flex: 1, minHeight: 44, maxHeight: 120, backgroundColor: colors.surfaceSecondary, borderWidth: 2, borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: 14 },
  sendBtn: { width: 44, height: 44, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.brand },
});
