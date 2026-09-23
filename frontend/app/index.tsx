import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useSession } from "../src/session";
import { colors } from "../src/theme";

const APP_ROLE = process.env.EXPO_PUBLIC_APP_ROLE ?? "customer";

function isArtistDeployment() {
  if (APP_ROLE === "artist") return true;
  if (typeof window !== "undefined") {
    return window.location.hostname.toLowerCase().includes("tinta-artist");
  }
  return false;
}

export default function Index() {
  const { user, loading } = useSession();
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.brand} size="large" />
      </View>
    );
  }

  // The dedicated public TINTA-Artist domain must open directly to the
  // artist application page. Requiring sign-in at the domain root makes a
  // shared registration link appear inaccessible to new artists.
  if (isArtistDeployment()) {
    return <Redirect href="/artist/apply" />;
  }

  if (APP_ROLE === "admin") {
    return <Redirect href={user ? "/admin/payments" : "/(auth)/sign-in?next=admin"} />;
  }

  return <Redirect href={user ? "/(tabs)" : "/(auth)/sign-in"} />;
}
