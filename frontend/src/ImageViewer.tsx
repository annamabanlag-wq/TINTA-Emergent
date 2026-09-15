import React, { useEffect } from "react";
import { View, Modal, Pressable, StyleSheet, Text, Dimensions, Platform, ScrollView, Text as RNText } from "react-native";
import { Image } from "expo-image";
import Icon from "@react-native-vector-icons/feather";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";
import { colors, spacing } from "./theme";
import { API_URL } from "./api";

type Props = {
  images: string[];
  index: number;
  visible: boolean;
  onClose: () => void;
  caption?: string;
  token?: string | null;
};

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

// Uploaded files are protected by the backend /api/files endpoint. The endpoint
// accepts the session token as ?token= because browser image requests cannot add
// an Authorization header. Preserve absolute public URLs, but attach the token
// when the URL points at TINTA's protected file endpoint.
function resolveImageUri(uri: string, token?: string | null): string {
  const value = String(uri || "").trim();
  if (!value) return "";

  let resolved = value;
  if (!/^https?:\/\//i.test(value) && !value.startsWith("data:") && !value.startsWith("blob:")) {
    if (value.startsWith("/")) {
      resolved = `${API_URL}${value.startsWith("/api/") ? value.slice(4) : value}`;
    } else {
      resolved = `${API_URL}/${value.replace(/^\/+/, "")}`;
    }
  }

  if (token && /\/api\/files\//i.test(resolved) && !/[?&]token=/.test(resolved)) {
    resolved += `${resolved.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
  }
  return resolved;
}

function ZoomableImage({ uri, token }: { uri: string; token?: string | null }) {
  const sourceUri = resolveImageUri(uri, token);
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  const reset = () => {
    "worklet";
    scale.value = withTiming(1);
    savedScale.value = 1;
    translateX.value = withTiming(0);
    translateY.value = withTiming(0);
    savedTx.value = 0;
    savedTy.value = 0;
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.max(1, Math.min(4, savedScale.value * e.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= 1.05) reset();
    });

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      if (scale.value > 1) {
        translateX.value = savedTx.value + e.translationX;
        translateY.value = savedTy.value + e.translationY;
      }
    })
    .onEnd(() => {
      savedTx.value = translateX.value;
      savedTy.value = translateY.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) reset();
      else {
        scale.value = withTiming(2.5);
        savedScale.value = 2.5;
      }
    });

  const composed = Gesture.Simultaneous(pinch, pan, doubleTap);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const fallback = (
    <View style={styles.errorWrap}>
      <Icon name="image-off" size={36} color={colors.muted} />
      <RNText style={styles.errorTitle}>RECEIPT COULD NOT BE LOADED</RNText>
      <RNText style={styles.errorText}>The uploaded receipt URL is unavailable.</RNText>
    </View>
  );

  if (!sourceUri) return fallback;

  if (Platform.OS === "web") {
    return (
      <ScrollView
        style={styles.webScroll}
        contentContainerStyle={styles.webScrollContent}
        maximumZoomScale={4}
        minimumZoomScale={1}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
      >
        <Image
          source={{ uri: sourceUri }}
          style={styles.webImage}
          contentFit="contain"
        />
      </ScrollView>
    );
  }

  return (
    <GestureDetector gesture={composed}>
      <Animated.View style={[styles.imageWrap, animatedStyle]}>
        <Image source={{ uri: sourceUri }} style={styles.image} contentFit="contain" />
      </Animated.View>
    </GestureDetector>
  );
}

export default function ImageViewer({ images, index, visible, onClose, caption, token }: Props) {
  const [current, setCurrent] = React.useState(index);
  useEffect(() => { if (visible) setCurrent(index); }, [visible, index]);
  if (!visible) return null;
  const total = images.length;
  const goPrev = () => setCurrent((c) => (c - 1 + total) % total);
  const goNext = () => setCurrent((c) => (c + 1) % total);

  return (
    <Modal visible={visible} transparent={false} animationType="fade" onRequestClose={onClose}>
      <View style={styles.container} testID="image-viewer">
        <ZoomableImage key={current} uri={images[current]} token={token} />
        <Pressable testID="viewer-close" onPress={onClose} style={styles.closeBtn}>
          <Icon name="x" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={styles.footer}>
          <Pressable testID="viewer-prev" onPress={goPrev} style={styles.navBtn} disabled={total <= 1}>
            <Icon name="chevron-left" size={20} color={total <= 1 ? colors.muted : colors.onSurface} />
          </Pressable>
          <RNText style={styles.caption} numberOfLines={1}>
            {current + 1} / {total}{caption ? ` · ${caption}` : ""}
          </RNText>
          <Pressable testID="viewer-next" onPress={goNext} style={styles.navBtn} disabled={total <= 1}>
            <Icon name="chevron-right" size={20} color={total <= 1 ? colors.muted : colors.onSurface} />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  imageWrap: { width: SCREEN_W, height: SCREEN_H, alignItems: "center", justifyContent: "center" },
  image: { width: SCREEN_W, height: SCREEN_H },
  webScroll: { flex: 1, width: SCREEN_W },
  webScrollContent: { flexGrow: 1, alignItems: "center", justifyContent: "center" },
  webImage: { width: SCREEN_W, height: SCREEN_H * 0.8 },
  errorWrap: { width: SCREEN_W, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  errorTitle: { color: colors.onSurface, fontSize: 14, fontWeight: "900", letterSpacing: 1, marginTop: spacing.md, textAlign: "center" },
  errorText: { color: colors.muted, fontSize: 12, marginTop: spacing.sm, textAlign: "center" },
  closeBtn: {
    position: "absolute", top: 48, right: spacing.lg,
    width: 44, height: 44, backgroundColor: "rgba(10,10,10,0.7)",
    borderWidth: 2, borderColor: colors.borderStrong,
    alignItems: "center", justifyContent: "center",
  },
  footer: {
    position: "absolute", bottom: 32, left: spacing.lg, right: spacing.lg,
    flexDirection: "row", alignItems: "center", gap: spacing.md,
  },
  navBtn: {
    width: 44, height: 44, borderWidth: 2, borderColor: colors.borderStrong,
    backgroundColor: "rgba(10,10,10,0.7)", alignItems: "center", justifyContent: "center",
  },
  caption: { flex: 1, textAlign: "center", color: colors.onSurface, fontSize: 12, fontWeight: "800", letterSpacing: 2 },
});
