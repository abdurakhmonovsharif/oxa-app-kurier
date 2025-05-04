import React, { useState, useEffect } from "react";
import {
  Alert,
  StyleSheet,
  Text,
  View,
  Pressable,
  TextInput,
  ActivityIndicator,
  Image,
  ImageBackground,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  Animated,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import firestore from "@react-native-firebase/firestore";
import { Ionicons } from "@expo/vector-icons";

function LoginScreen({ navigation }) {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [shakeAnimation] = useState(new Animated.Value(0));

  // Animation for error state
  const startShakeAnimation = () => {
    Animated.sequence([
      Animated.timing(shakeAnimation, {
        toValue: 10,
        duration: 50,
        useNativeDriver: true,
      }),
      Animated.timing(shakeAnimation, {
        toValue: -10,
        duration: 50,
        useNativeDriver: true,
      }),
      Animated.timing(shakeAnimation, {
        toValue: 10,
        duration: 50,
        useNativeDriver: true,
      }),
      Animated.timing(shakeAnimation, {
        toValue: 0,
        duration: 50,
        useNativeDriver: true,
      }),
    ]).start();
  };

  useEffect(() => {
    // Check if user is already logged in
    const checkLoginStatus = async () => {
      try {
        const storedPhoneNumber = await AsyncStorage.getItem(
          "courierPhoneNumber"
        );
        if (storedPhoneNumber) {
          // If phone number exists in storage, navigate to home screen
          navigation.replace("Home", { phoneNumber: storedPhoneNumber });
        }
      } catch (error) {
        console.error("Error checking login status:", error);
      }
    };

    checkLoginStatus();
  }, []);

  const handleLogin = async () => {
    // Validate phone number format - no + needed, just 9 digits
    if (!phoneNumber || phoneNumber.length < 9 || !/^\d+$/.test(phoneNumber)) {
      setError("To'g'ri telefon raqam kiriting");
      startShakeAnimation();
      return;
    }

    setLoading(true);
    setError("");

    try {
      // Check if the phone number exists in the couriers collection
      const querySnapshot = await firestore()
        .collection("couriers")
        .where("phoneNumber", "==", phoneNumber)
        .limit(1)
        .get();

      if (querySnapshot.empty) {
        setError("Bu telefon raqam ro'yhatdan o'tmagan");
        startShakeAnimation();
        setLoading(false);
        return;
      }

      // Store phone number in AsyncStorage
      await AsyncStorage.setItem("courierPhoneNumber", phoneNumber);

      // Navigate to home screen
      navigation.replace("Home", { phoneNumber });
    } catch (error) {
      console.error("Login error:", error);
      setError("Kirishda xatolik yuz berdi");
      startShakeAnimation();
    } finally {
      setLoading(false);
    }
  };

  // Format phone number for display
  const formatPhoneForDisplay = (input) => {
    // Format: XX XXX XX XX
    if (!input) return "";

    // Remove any non-digit characters
    const cleaned = input.replace(/\D/g, "");

    // Check if it's at least 2 digits
    if (cleaned.length < 2) return cleaned;

    // Apply formatting pattern
    let formatted = cleaned.slice(0, 2);

    if (cleaned.length > 2) {
      formatted += " " + cleaned.slice(2, 5);
    }

    if (cleaned.length > 5) {
      formatted += " " + cleaned.slice(5, 7);
    }

    if (cleaned.length > 7) {
      formatted += " " + cleaned.slice(7);
    }

    return formatted;
  };

  const handlePhoneNumberChange = (text) => {
    // Only keep digits
    const digitsOnly = text.replace(/\D/g, "");
    // Limit to 9 digits (excluding country code)
    const trimmed = digitsOnly.slice(0, 9);
    setPhoneNumber(trimmed);
  };

  return (
    <View style={styles.container}>
      <View style={styles.logoContainer}>
        <View style={styles.logoCircle}>
          <Ionicons name="bicycle" size={50} color="#4CAF50" />
        </View>
        <Text style={styles.appName}>Oxa Kuryer</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.loginTitle}>Ilovaga kirish</Text>

        <Text style={styles.welcomeText}>
          Buyurtmalar yetkazish tizimining kuryer ilovasiga xush kelibsiz
        </Text>

        <View style={styles.inputContainer}>
          <Text style={styles.inputLabel}>Telefon raqamingiz:</Text>

          <View
            style={[
              styles.inputWrapper,
              error ? styles.inputWrapperError : null,
            ]}
          >
            <View style={styles.prefixContainer}>
              <Text style={styles.prefix}>+998</Text>
            </View>

            <Animated.View
              style={{ transform: [{ translateX: shakeAnimation }] }}
            >
              <TextInput
                style={styles.input}
                placeholder="XX XXX XX XX"
                value={formatPhoneForDisplay(phoneNumber)}
                onChangeText={handlePhoneNumberChange}
                keyboardType="phone-pad"
                maxLength={11} // Including spaces: XX XXX XX XX
              />
            </Animated.View>
          </View>

          {error ? (
            <View style={styles.errorContainer}>
              <Ionicons name="alert-circle-outline" size={16} color="#e74c3c" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
        </View>

        <TouchableOpacity
          style={[styles.loginButton, loading && styles.loginButtonDisabled]}
          disabled={loading}
          onPress={handleLogin}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <View style={styles.buttonContent}>
              <Text style={styles.loginButtonText}>Kirish</Text>
              <Ionicons name="arrow-forward" size={20} color="#fff" />
            </View>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.illustrationContainer}>
        <Ionicons name="bicycle" size={80} color="#4CAF50" />
      </View>
    </View>
  );
}

const { width, height } = Dimensions.get("window");

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f6f9fe",
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "space-between",
  },
  logoContainer: {
    alignItems: "center",
    marginTop: height * 0.08,
  },
  logoCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: "#ffffff",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  appName: {
    fontSize: 24,
    fontWeight: "700",
    color: "#2c3e50",
    marginTop: 10,
  },
  card: {
    width: "100%",
    backgroundColor: "#ffffff",
    borderRadius: 20,
    padding: 25,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
  },
  loginTitle: {
    fontSize: 26,
    fontWeight: "bold",
    color: "#2c3e50",
    marginBottom: 10,
  },
  welcomeText: {
    fontSize: 14,
    color: "#7f8c8d",
    marginBottom: 25,
    lineHeight: 20,
  },
  inputContainer: {
    width: "100%",
    marginBottom: 25,
  },
  inputLabel: {
    fontSize: 14,
    marginBottom: 8,
    color: "#34495e",
    fontWeight: "600",
  },
  inputWrapper: {
    flexDirection: "row",
    borderWidth: 1.5,
    borderColor: "#e0e0e0",
    borderRadius: 10,
    overflow: "hidden",
  },
  inputWrapperError: {
    borderColor: "#e74c3c",
  },
  prefixContainer: {
    backgroundColor: "#f7f9fc",
    paddingHorizontal: 12,
    justifyContent: "center",
    borderRightWidth: 1,
    borderRightColor: "#e0e0e0",
  },
  prefix: {
    fontSize: 16,
    color: "#7f8c8d",
    fontWeight: "500",
  },
  input: {
    backgroundColor: "#ffffff",
    paddingVertical: 14,
    paddingHorizontal: 15,
    fontSize: 16,
    color: "#2c3e50",
    width: width * 0.5,
    fontWeight: "600",
  },
  errorContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
  },
  errorText: {
    color: "#e74c3c",
    fontSize: 12,
    marginLeft: 4,
  },
  loginButton: {
    backgroundColor: "#4CAF50",
    paddingVertical: 16,
    borderRadius: 10,
    width: "100%",
    alignItems: "center",
    shadowColor: "#4CAF50",
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
    elevation: 8,
  },
  loginButtonDisabled: {
    backgroundColor: "#a5d6a7",
    shadowOpacity: 0.1,
  },
  buttonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  loginButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
    marginRight: 8,
  },
  illustrationContainer: {
    alignItems: "center",
    marginBottom: 30,
  },
});
