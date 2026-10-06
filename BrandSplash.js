import React, { useEffect, useRef } from "react";
import { View, StyleSheet, Animated, Image, Text } from "react-native";
import { StatusBar } from "expo-status-bar";

const DARK_BLUE = "#0F2140";

export default function BrandSplash({ onFinish }) {
  const logoScale = useRef(new Animated.Value(0.6)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(logoOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.spring(logoScale, { toValue: 1, friction: 5, useNativeDriver: true }),
      ]),
      Animated.delay(400),
    ]).start(() => onFinish && onFinish());
  }, []);

  return (
    <View style={styles.splash}>
      <StatusBar style="light" />
      <Animated.View style={{ opacity: logoOpacity, transform: [{ scale: logoScale }], alignItems: "center" }}>
        <Image source={require("./assets/logo.png")} style={{ width: 130, height: 130, borderRadius: 65 }} />
        <Text style={styles.splashText}>MARBA DRIVERS</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: DARK_BLUE },
  splashText: { color: "#fff", fontWeight: "900", fontStyle: "italic", fontSize: 16, letterSpacing: 2, marginTop: 16 },
});
