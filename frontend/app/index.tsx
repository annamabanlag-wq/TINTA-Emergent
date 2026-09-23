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

function ArtistEntry() {
  return <Redirect href="/artist/apply" />;
}

function AppEntry() {
  const { user, loading } = useSession();
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.brand} size="large" />
      </View>
    );
  }

  if (APP_ROLE === "admin") {
    return <Redirect href={user ? "/admin/payments" : "/(auth)/sign-in?next=admin"} />;
  }

  return <Redirect href={user ? "/(tabs)" : "/(auth)/sign-in"} />;
}

export default function Index() {
  // IMPORTANT: the public Artist domain must not initialize the normal
  // customer/admin session before routing. That session check was the source
  // of the indefinite loading screen on the dedicated artist URL.
  return isArtistDeployment() ? <ArtistEntry /> : <AppEntry />;
}
