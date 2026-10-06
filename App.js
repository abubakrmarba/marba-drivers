import React, { useEffect, useState } from "react";
import { View } from "react-native";
import * as SecureStore from "expo-secure-store";
import { StatusBar } from "expo-status-bar";
import BrandSplash from "./BrandSplash";
import DriverLoginScreen from "./screens/DriverLoginScreen";
import DriverMainScreen from "./screens/DriverMainScreen";

const DARK_BLUE = "#0F2140";

export default function App() {
  const [loading, setLoading] = useState(true);
  const [driverEmail, setDriverEmail] = useState(null);
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    SecureStore.getItemAsync("marba_driver_email").then((e) => {
      setDriverEmail(e);
      setLoading(false);
    });
  }, []);

  async function handleLogin(email) {
    await SecureStore.setItemAsync("marba_driver_email", email);
    setDriverEmail(email);
  }
  async function handleLogout() {
    await SecureStore.deleteItemAsync("marba_driver_email");
    setDriverEmail(null);
  }

  if (showSplash || loading) {
    return <BrandSplash onFinish={() => setShowSplash(false)} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: DARK_BLUE }}>
      <StatusBar style="light" />
      {driverEmail ? (
        <DriverMainScreen driverEmail={driverEmail} onLogout={handleLogout} />
      ) : (
        <DriverLoginScreen onLogin={handleLogin} />
      )}
    </View>
  );
}