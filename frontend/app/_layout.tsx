import { Stack } from "expo-router";
import { LogBox, StatusBar } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider } from "../src/session";
import { colors } from "../src/theme";

LogBox.ignoreAllLogs(true);

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.surface }}>
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" backgroundColor={colors.surface} />
        <SessionProvider>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.surface },
              animation: "fade",
            }}
          />
        </SessionProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
