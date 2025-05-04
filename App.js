import AsyncStorage from "@react-native-async-storage/async-storage";
import firestore from "@react-native-firebase/firestore";
import messaging from "@react-native-firebase/messaging";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View
} from "react-native";

// Import screens
import HomeScreen from "./src/screens/HomeScreen";
import LoginScreen from "./src/screens/LoginScreen";
import OrdersScreen from "./src/screens/OrdersScreen";

// Create stack navigator
const Stack = createNativeStackNavigator();

// Set up background message handler - this MUST be outside of any component
messaging().setBackgroundMessageHandler(async (remoteMessage) => {
  console.log(
    "✅ Message handled in the background!",
    JSON.stringify(remoteMessage)
  );
  // Handle background notification logic if needed
  return Promise.resolve();
});

// Function to calculate distance between two coordinates using Haversine formula
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  if (!lat1 || !lon1 || !lat2 || !lon2) return null;

  const R = 6371; // Radius of the earth in km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) *
      Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c; // Distance in km
  return distance.toFixed(1);
};

const deg2rad = (deg) => {
  return deg * (Math.PI / 180);
};

// Main App component with navigation
export default function App() {
  // State to track which screen to show
  const [initialRouteName, setInitialRouteName] = useState("Login");
  const [isLoading, setIsLoading] = useState(true);
  const [params, setParams] = useState({});
  const [error, setError] = useState(null);

  // When app starts, check login status and active orders
  useEffect(() => {
    const checkInitialScreen = async () => {
      try {
        // Check if user is logged in
        const phoneNumber = await AsyncStorage.getItem("courierPhoneNumber");

        if (!phoneNumber) {
          // Not logged in, go to login screen
          setInitialRouteName("Login");
          setIsLoading(false);
          return;
        }

        // User is logged in, check if they have active orders
        try {
          const activeOrdersSnapshot = await firestore()
            .collection("orders")
            .where("courier", "==", phoneNumber)
            .where("status", "==", "courier")
            .get();

          const hasActiveOrders = !activeOrdersSnapshot.empty;

          // Set initial route based on active orders
          if (hasActiveOrders) {
            // Get the orders to preload them
            const activeOrdersList = [];
            activeOrdersSnapshot.forEach((doc) => {
              activeOrdersList.push({
                id: doc.id,
                ...doc.data(),
              });
            });

            setInitialRouteName("Orders");
            setParams({
              phoneNumber,
              preloadOrders: activeOrdersList,
            });
          } else {
            setInitialRouteName("Home");
            setParams({ phoneNumber });
          }
        } catch (firestoreError) {
          console.error("Error querying Firestore:", firestoreError);
          // If Firestore query fails, default to Home screen
          setInitialRouteName("Home");
          setParams({ phoneNumber });
        }
      } catch (error) {
        console.error("Error determining initial screen:", error);
        setError(
          "Ilovani ishga tushirishda xatolik yuz berdi. Iltimos, qayta urinib ko'ring."
        );
        setInitialRouteName("Login");
      } finally {
        setIsLoading(false);
      }
    };

    checkInitialScreen();
  }, []);

  // Show loading indicator while determining initial screen
  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#3498db" />
      </View>
    );
  }

  // Show error message if there was a problem
  if (error) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable
          style={styles.retryButton}
          onPress={() => {
            setError(null);
            setIsLoading(true);
            // Force app to restart initialization
            setTimeout(() => {
              setInitialRouteName("Login");
              setParams({});
              setIsLoading(false);
            }, 500);
          }}
        >
          <Text style={styles.retryButtonText}>Qayta urinib ko'rish</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName={initialRouteName}
        screenOptions={{
          headerShown: false,
          gestureEnabled: false, // Disable swipe gestures for navigation
          presentation: "modal", // Use modal presentation to avoid back gesture
        }}
      >
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          initialParams={initialRouteName === "Home" ? params : undefined}
        />
        <Stack.Screen
          name="Orders"
          component={OrdersScreen}
          initialParams={initialRouteName === "Orders" ? params : undefined}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f7f7f7",
  },
  errorText: {
    color: "#e74c3c",
    fontSize: 16,
    textAlign: "center",
    marginHorizontal: 20,
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: "#3498db",
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 5,
  },
  retryButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
});
