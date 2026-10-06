import React, { useEffect, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView,
} from "react-native";
import * as SecureStore from "expo-secure-store";
import { supabase } from "../supabaseClient";

const ORANGE = "#E9642B";
const DARK_BLUE = "#0F2140";
const DARK_BLUE_LIGHT = "#1B335C";
const LAST_LOGIN_KEY = "marba_driver_last_login";
const LOGIN_TIMEOUT_MS = 15000;

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

export default function DriverLoginScreen({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Oxirgi kirgan loginni eslab qolamiz
  useEffect(() => {
    SecureStore.getItemAsync(LAST_LOGIN_KEY)
      .then((v) => { if (v) setUsername(v); })
      .catch(() => {});
  }, []);

  async function doLogin() {
    const slug = username.trim().toLowerCase().replace(/\s+/g, "");
    if (!slug) { setError("Loginni kiriting"); return; }
    if (!password) { setError("Parolni kiriting"); return; }

    setBusy(true);
    setError("");
    const email = `${slug}@marba-driver.internal`;

    try {
      const { error: authError } = await withTimeout(
        supabase.auth.signInWithPassword({ email, password }),
        LOGIN_TIMEOUT_MS
      );
      if (authError) {
        const wrong = /invalid login credentials/i.test(authError.message || "");
        setError(wrong ? "Login yoki parol noto'g'ri" : "Xatolik: " + authError.message);
        setBusy(false);
        return;
      }
      try { await SecureStore.setItemAsync(LAST_LOGIN_KEY, username.trim()); } catch (e) {}
      setBusy(false);
      onLogin(email);
    } catch (e) {
      setBusy(false);
      setError(
        e && e.message === "timeout"
          ? "Ulanish uzoq davom etdi. Internetni tekshirib, qayta urinib ko'ring."
          : "Tarmoq xatoligi. Internetni tekshiring."
      );
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}>
          <Text style={styles.title}>MARBA</Text>
          <Text style={styles.subtitle}>DRIVERS</Text>
        </View>

        <Text style={styles.label}>Login</Text>
        <TextInput
          style={styles.input}
          value={username}
          onChangeText={(t) => { setUsername(t); setError(""); }}
          placeholder="Masalan: musoxon"
          placeholderTextColor="#8090b0"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="next"
        />

        <Text style={styles.label}>Parol</Text>
        <View style={styles.passRow}>
          <TextInput
            style={[styles.input, { flex: 1, marginBottom: 0 }]}
            value={password}
            onChangeText={(t) => { setPassword(t); setError(""); }}
            secureTextEntry={!showPass}
            placeholder="Parolni kiriting"
            placeholderTextColor="#8090b0"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="go"
            onSubmitEditing={doLogin}
          />
          <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPass(!showPass)}>
            <Text style={styles.eyeText}>{showPass ? "Yashirish" : "Ko'rsatish"}</Text>
          </TouchableOpacity>
        </View>

        {!!error && <Text style={styles.error}>{error}</Text>}

        <TouchableOpacity style={[styles.loginBtn, busy && { opacity: 0.7 }]} onPress={doLogin} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.loginBtnText}>Kirish</Text>}
        </TouchableOpacity>

        <Text style={styles.hint}>Login va parolni administratordan oling.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: DARK_BLUE },
  inner: { flexGrow: 1, justifyContent: "center", padding: 24 },
  brand: { alignItems: "center", marginBottom: 36 },
  title: { color: "#fff", fontWeight: "900", fontStyle: "italic", fontSize: 30, letterSpacing: 1 },
  subtitle: { color: "#9FB0CC", fontWeight: "700", fontSize: 13, letterSpacing: 3, marginTop: 2 },
  label: { color: "#fff", fontWeight: "700", fontSize: 14, marginBottom: 8 },
  input: { backgroundColor: DARK_BLUE_LIGHT, color: "#fff", borderRadius: 10, padding: 14, fontSize: 15, marginBottom: 16 },
  passRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  eyeBtn: { backgroundColor: DARK_BLUE_LIGHT, borderRadius: 10, paddingVertical: 14, paddingHorizontal: 12 },
  eyeText: { color: "#9FB0CC", fontSize: 12, fontWeight: "700" },
  error: { color: "#f0837f", fontSize: 13, marginBottom: 10 },
  loginBtn: { backgroundColor: ORANGE, borderRadius: 12, padding: 16, alignItems: "center", marginTop: 8 },
  loginBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  hint: { color: "#9FB0CC", fontSize: 12, textAlign: "center", marginTop: 18 },
});