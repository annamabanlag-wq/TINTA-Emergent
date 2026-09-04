import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useSession } from "../src/session";
import { colors } from "../src/theme";

export default function Index() {
  const { user, loading } = useSession();
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.brand} size="large" />
      </View>
    );
  }
  return <Redirect href={user ? "/(tabs)" : "/(auth)/sign-in"} />;
}
