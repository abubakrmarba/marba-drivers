import React, { useEffect, useState, useRef } from "react";
import { View, ActivityIndicator, StyleSheet, Animated, Image, Text } from "react-native";
import * as SecureStore from "expo-secure-store";
import { StatusBar } from "expo-status-bar";
import DriverLoginScreen from "./screens/DriverLoginScreen";
import DriverMainScreen from "./screens/DriverMainScreen";

const DARK_BLUE = "#0F2140";

export default function App() {
  const [loading, setLoading] = useState(true);
  const [driverEmail, setDriverEmail] = useState(null);
  const [showSplash, setShowSplash] = useState(true);

  const logoScale = useRef(new Animated.Value(0.6)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(logoOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.spring(logoScale, { toValue: 1, friction: 5, useNativeDriver: true }),
      ]),
      Animated.delay(400),
    ]).start(() => setShowSplash(false));

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
    return (
      <View style={styles.splash}>
        <StatusBar style="light" />
        <Animated.View style={{ opacity: logoOpacity, transform: [{ scale: logoScale }], alignItems: "center" }}>
          <Image source={require("./assets/logo.png")} style={{ width: 130, height: 130, borderRadius: 65 }} />
          <Text style={styles.splashText}>MARBA DRIVERS</Text>
        </Animated.View>
        {loading && <ActivityIndicator color="#fff" style={{ marginTop: 30 }} />}
      </View>
    );
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

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: DARK_BLUE },
  splashText: { color: "#fff", fontWeight: "900", fontStyle: "italic", fontSize: 16, letterSpacing: 2, marginTop: 16 },
});
