import React, { useEffect } from "react";
import { View, Modal, Pressable, StyleSheet, Text, Dimensions, Platform, ScrollView } from "react-native";
import { Image } from "expo-image";
import Icon from "@react-native-vector-icons/feather";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import { colors, spacing } from "./theme";

type Props = {
  images: string[];
  index: number;
  visible: boolean;
  onClose: () => void;
  caption?: string;
};

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

function ZoomableImage({ uri }: { uri: string }) {
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
      if (scale.value <= 1.05) {
        reset();
      }
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
      if (scale.value > 1) {
        reset();
      } else {
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

  // Web fallback: no gesture handler zoom, just show image
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
        <Image source={uri} style={styles.webImage} contentFit="contain" />
      </ScrollView>
    );
  }

  return (
    <GestureDetector gesture={composed}>
      <Animated.View style={[styles.imageWrap, animatedStyle]}>
        <Image source={uri} style={styles.image} contentFit="contain" />
      </Animated.View>
    </GestureDetector>
  );
}

export default function ImageViewer({ images, index, visible, onClose, caption }: Props) {
  const [current, setCurrent] = React.useState(index);
  useEffect(() => { if (visible) setCurrent(index); }, [visible, index]);
  if (!visible) return null;
  const total = images.length;
  const goPrev = () => setCurrent((c) => (c - 1 + total) % total);
  const goNext = () => setCurrent((c) => (c + 1) % total);

  return (
    <Modal visible={visible} transparent={false} animationType="fade" onRequestClose={onClose}>
      <View style={styles.container} testID="image-viewer">
        <ZoomableImage key={current} uri={images[current]} />
        <Pressable testID="viewer-close" onPress={onClose} style={styles.closeBtn}>
          <Icon name="x" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={styles.footer}>
          <Pressable testID="viewer-prev" onPress={goPrev} style={styles.navBtn} disabled={total <= 1}>
            <Icon name="chevron-left" size={20} color={total <= 1 ? colors.muted : colors.onSurface} />
          </Pressable>
          <Text style={styles.caption} numberOfLines={1}>
            {current + 1} / {total}{caption ? ` · ${caption}` : ""}
          </Text>
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
