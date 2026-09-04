import { Tabs, Redirect } from "expo-router";
import { Platform } from "react-native";
import Icon from "@react-native-vector-icons/feather";
import { useSession } from "../../src/session";
import { colors } from "../../src/theme";

export default function TabsLayout() {
  const { user, loading } = useSession();
  if (loading) return null;
  if (!user) return <Redirect href="/(auth)/sign-in" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopWidth: 2,
          borderTopColor: colors.borderStrong,
          ...(Platform.OS === "web" ? { height: 64 } : {}),
        },
        tabBarItemStyle: { alignSelf: "center" },
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 10, fontWeight: "800", letterSpacing: 1.5 },
        sceneStyle: { backgroundColor: colors.surface },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "DISCOVER",
          tabBarIcon: ({ color, size }) => <Icon name="search" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="bookings"
        options={{
          title: "BOOKINGS",
          tabBarIcon: ({ color, size }) => <Icon name="calendar" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: "MESSAGES",
          tabBarIcon: ({ color, size }) => <Icon name="message-square" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "PROFILE",
          tabBarIcon: ({ color, size }) => <Icon name="user" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
