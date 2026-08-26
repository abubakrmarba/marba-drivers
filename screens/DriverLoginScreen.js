import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from "react-native";
import { supabase } from "../supabaseClient";

const ORANGE = "#E9642B";
const DARK_BLUE = "#0F2140";
const DARK_BLUE_LIGHT = "#1B335C";

const DRIVER_NAMES = ["Musoxon", "Alimardon", "Lazizxon", "Bilolxon", "Oybek", "Oybek Yangi", "Rustamjon", "Ruzmatjon", "Akramjon"];

export default function DriverLoginScreen({ onLogin }) {
  const [selected, setSelected] = useState(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function doLogin() {
    if (!selected) { setError("Ismingizni tanlang"); return; }
    setBusy(true);
    setError("");
    const slug = selected.toLowerCase().replace(/\s+/g, "");
    const email = `${slug}@marba-driver.internal`;
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (authError) { setError("Parol noto'g'ri"); return; }
    onLogin(email);
  }

  return (
    <View style={styles.container}>
      <View style={{ alignItems: "center", marginBottom: 32 }}>
        <Text style={styles.title}>MARBA</Text>
        <Text style={styles.subtitle}>DRIVERS</Text>
      </View>

      <Text style={styles.label}>Ismingizni tanlang</Text>
      <View style={styles.grid}>
        {DRIVER_NAMES.map((n) => (
          <TouchableOpacity
            key={n}
            style={[styles.nameBtn, { backgroundColor: selected === n ? ORANGE : DARK_BLUE_LIGHT }]}
            onPress={() => { setSelected(n); setError(""); }}
          >
            <Text style={styles.nameBtnText}>{n}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Parol</Text>
      <TextInput
        style={styles.input}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        placeholder="Parolni kiriting"
        placeholderTextColor="#8090b0"
      />
      {!!error && <Text style={styles.error}>{error}</Text>}

      <TouchableOpacity style={styles.loginBtn} onPress={doLogin} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.loginBtnText}>Kirish</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: DARK_BLUE, justifyContent: "center", padding: 24 },
  title: { color: "#fff", fontWeight: "900", fontStyle: "italic", fontSize: 28, letterSpacing: 1 },
  subtitle: { color: "#9FB0CC", fontWeight: "700", fontSize: 13, letterSpacing: 3, marginTop: 2 },
  label: { color: "#fff", fontWeight: "700", fontSize: 14, marginBottom: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20 },
  nameBtn: { width: "48%", paddingVertical: 12, borderRadius: 8, alignItems: "center" },
  nameBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  input: { backgroundColor: DARK_BLUE_LIGHT, color: "#fff", borderRadius: 8, padding: 12, fontSize: 14, marginBottom: 6 },
  error: { color: "#f0837f", fontSize: 13, marginBottom: 10 },
  loginBtn: { backgroundColor: ORANGE, borderRadius: 10, padding: 15, alignItems: "center", marginTop: 16 },
  loginBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
