import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useSession } from "../src/session";
import { colors } from "../src/theme";

const APP_ROLE = process.env.EXPO_PUBLIC_APP_ROLE ?? "customer";

export default function Index() {
  const { user, loading } = useSession();
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.brand} size="large" />
      </View>
    );
  }

  if (APP_ROLE === "artist") {
    return <Redirect href={user ? "/artist/apply" : "/(auth)/sign-up?role=artist"} />;
  }

  if (APP_ROLE === "admin") {
    return <Redirect href={user ? "/admin/payments" : "/(auth)/sign-in?next=admin"} />;
  }

  return <Redirect href={user ? "/(tabs)" : "/(auth)/sign-in"} />;
}
