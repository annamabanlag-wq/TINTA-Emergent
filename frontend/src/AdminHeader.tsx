import { View, Text, StyleSheet, Pressable } from "react-native";
import { useRouter } from "expo-router";
import Icon from "@react-native-vector-icons/feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing } from "./theme";

export default function AdminHeader({ title, right, testID }: { title: string; right?: React.ReactNode; testID?: string }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const goToAdminDashboard = () => {
    if (typeof window !== "undefined") { window.location.assign("/admin"); return; }
    router.replace("/(tabs)/admin");
  };
  return <View style={[styles.header,{paddingTop:insets.top+spacing.md}]}>
    <Pressable onPress={goToAdminDashboard} style={styles.back} testID="admin-back" hitSlop={12} accessibilityRole="button" accessibilityLabel="Back to admin dashboard"><Icon name="arrow-left" size={22} color={colors.onSurface}/></Pressable>
    <Text style={styles.title} testID={testID??"admin-header-title"} numberOfLines={1}>{title}</Text>
    <View style={styles.actions}><Pressable onPress={()=>router.push("/admin/messages")} style={styles.chat} accessibilityLabel="Open admin messages"><Icon name="message-square" size={19} color={colors.brand}/></Pressable>{right}</View>
  </View>;
}
const styles=StyleSheet.create({header:{flexDirection:"row",alignItems:"center",gap:spacing.md,paddingHorizontal:spacing.lg,paddingBottom:spacing.md,borderBottomWidth:2,borderBottomColor:colors.borderStrong,backgroundColor:colors.surface},back:{padding:4},title:{flex:1,color:colors.onSurface,fontSize:22,fontWeight:"900",letterSpacing:2},actions:{flexDirection:"row",alignItems:"center",gap:spacing.sm},chat:{width:38,height:38,borderWidth:2,borderColor:colors.borderStrong,alignItems:"center",justifyContent:"center"}});
