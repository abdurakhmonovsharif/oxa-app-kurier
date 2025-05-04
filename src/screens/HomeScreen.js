import React, {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from "react";
import {
  Alert,
  StyleSheet,
  Text,
  View,
  FlatList,
  ActivityIndicator,
  Pressable,
  BackHandler,
  Platform,
  PermissionsAndroid,
  AppState,
  TouchableOpacity,
  Linking,
  Vibration,
  NativeModules,
  ScrollView,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import messaging from "@react-native-firebase/messaging";
import firestore from "@react-native-firebase/firestore";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import {
  calculateDistance,
  getCurrentLocation,
  checkLocationPermission,
  getDistanceBetweenPoints,
} from "../utils/locationUtils";
import * as Location from "expo-location";
import Constants from "expo-constants";

// Try to import Audio from expo-av with a fallback
let Audio;
try {
  Audio = require("expo-av").Audio;
} catch (e) {
  console.warn("expo-av import failed, audio will not be available:", e);
  Audio = null;
}

// Get SoundModule safely
let SoundModule = null;
try {
  if (NativeModules && NativeModules.SoundModule) {
    SoundModule = NativeModules.SoundModule;
    console.log("Native SoundModule loaded successfully");
  } else {
    console.warn("Native SoundModule not found in NativeModules");
  }
} catch (e) {
  console.warn("Error accessing SoundModule:", e);
}

// Add direct Sound implementation for Android
const CustomSound =
  Platform.OS === "android" ? NativeModules.SoundManager : null;

// Add a direct way to play notification sounds for Android
if (Platform.OS === "android") {
  // Create a native module interface that we can use when the SoundPlayer isn't working
  class DirectSound {
    static play() {
      try {
        // Try using the notification API directly
        if (NativeModules.NotificationModule) {
          NativeModules.NotificationModule.playSound();
          return true;
        }

        // Try using the MediaPlayer
        if (NativeModules.MediaPlayerModule) {
          NativeModules.MediaPlayerModule.playSound("alert.mp3");
          return true;
        }

        // Vibrate as a last resort
        Vibration.vibrate(500);
        return false;
      } catch (e) {
        console.warn("Direct sound play failed:", e);
        return false;
      }
    }
  }

  // Add it as a global
  global.DirectSound = DirectSound;
}

function HomeScreen({ navigation, route }) {
  const { phoneNumber, resetState, fromOrders } = route.params || {};
  const [fcmToken, setFcmToken] = useState(null);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [restaurants, setRestaurants] = useState({});
  const [restaurantLocations, setRestaurantLocations] = useState({});
  const [processingOrder, setProcessingOrder] = useState(null);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [locationError, setLocationError] = useState(null);
  const [activeOrders, setActiveOrders] = useState([]);
  const [hasActiveOrders, setHasActiveOrders] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isAccepting, setIsAccepting] = useState(false);
  const [isOnActiveRoute, setIsOnActiveRoute] = useState(false);
  const [distanceCalculated, setDistanceCalculated] = useState(false);
  const [distance, setDistance] = useState(null);
  const [isAcceptingThis, setIsAcceptingThis] = useState(false);
  const [orderDistances, setOrderDistances] = useState({});
  const [orderRouteStatus, setOrderRouteStatus] = useState({});
  const [calculatingOrders, setCalculatingOrders] = useState({});
  const [showAllOrdersDebug, setShowAllOrdersDebug] = useState(false);
  const [acceptedOrderId, setAcceptedOrderId] = useState(null);
  const [isAcceptingId, setIsAcceptingId] = useState(null);
  const calculatingOrdersRef = React.useRef(null);
  const navigationInProgress = React.useRef(false);
  const unsubscribeOrdersListenerRef = React.useRef(null);
  // Sound player and sound object ref
  const soundRef = React.useRef(null);
  // Add a flag to track if notification is currently playing
  const isNotificationPlaying = useRef(false);

  // Reset routes status at initialization
  useEffect(() => {
    // Boshlang'ich route status qiymatlarini clear qilish
    setOrderRouteStatus({});
  }, []);

  console.log(
    "HomeScreen rendered with phoneNumber:",
    phoneNumber,
    "resetState:",
    resetState,
    "fromOrders:",
    fromOrders
  );

  // Request permission from user
  const requestUserPermission = async () => {
    const authStatus = await messaging().requestPermission({
      sound: true,
      alert: true,
      badge: true,
      provisional: true,
    });

    const enabled =
      authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
      authStatus === messaging.AuthorizationStatus.PROVISIONAL;

    if (enabled) {
      console.log("✅ Authorization status:", authStatus);
      return true;
    } else {
      console.log("❌ Permission not granted");
      return false;
    }
  };

  // Function to manually subscribe to the topic
  const manuallySubscribe = async () => {
    try {
      if (!fcmToken) {
        console.log("No FCM token available");
        return;
      }

      await messaging().subscribeToTopic("new_orders");
      console.log("✅ Manually subscribed to 'new_orders' topic");
      setIsSubscribed(true);

      // Send test notification
      Alert.alert(
        "Obuna bo'ldi",
        "Endi yangi buyurtmalar haqida bildirishnomalar olasiz"
      );
    } catch (error) {
      console.error("Error subscribing to topic:", error);
    }
  };

  // Function to fetch restaurant names and locations
  const fetchRestaurantNames = async (restaurantIds) => {
    try {
      if (!restaurantIds || restaurantIds.length === 0) {
        console.log("No restaurant IDs provided to fetch");
        return;
      }

      console.log("HomeScreen fetching data for restaurants:", restaurantIds);

      const uniqueIds = [...new Set(restaurantIds)];
      const restaurantData = { ...restaurants };
      const locationData = { ...restaurantLocations };

      // Only fetch the restaurants we don't already have
      const idsToFetch = uniqueIds.filter(
        (id) => !restaurantData[id] || !locationData[id]?.lat
      );

      if (idsToFetch.length === 0) {
        console.log("All restaurant data already cached");
        return; // All data already exists in state
      }

      console.log("Fetching data for restaurants:", idsToFetch);

      await Promise.all(
        idsToFetch.map(async (id) => {
          if (id) {
            try {
              const doc = await firestore()
                .collection("restaurants")
                .doc(id)
                .get();
              if (doc.exists) {
                const data = doc.data();
                restaurantData[id] = data?.name || "Noma'lum restoran";
                // Store location data for distance calculation
                if (data?.location && data.location.lat && data.location.long) {
                  locationData[id] = data.location;
                  console.log(
                    `Restaurant ${id} location loaded: ${data.location.lat}, ${data.location.long}`
                  );
                } else {
                  console.warn(
                    `Restaurant ${id} has missing or invalid location data`
                  );
                  // Use a default location or flag it as invalid
                  locationData[id] = { invalid: true };
                }
              } else {
                restaurantData[id] = "Noma'lum restoran";
                console.warn(`Restaurant ${id} document does not exist`);
              }
            } catch (error) {
              console.error(
                `Error fetching restaurant ${id} in HomeScreen:`,
                error
              );
              restaurantData[id] = "Xatolik yuz berdi";
            }
          }
        })
      );

      console.log(
        "HomeScreen restaurant data fetched:",
        Object.keys(restaurantData).length
      );
      console.log(
        "HomeScreen restaurant locations fetched:",
        Object.keys(locationData).length
      );
      setRestaurants(restaurantData);
      setRestaurantLocations(locationData);
    } catch (error) {
      console.error("Error fetching restaurant data in HomeScreen:", error);
    }
  };

  // Fetch active orders for the current courier
  const fetchActiveOrders = async () => {
    if (!phoneNumber) return;

    try {
      console.log("Fetching active orders for courier:", phoneNumber);

      const activeOrdersSnapshot = await firestore()
        .collection("orders")
        .where("courier", "==", phoneNumber)
        .where("status", "in", ["courier", "delivering"])
        .get();

      if (activeOrdersSnapshot.empty) {
        console.log("No active orders found for courier");
        setActiveOrders([]);
        setHasActiveOrders(false);
        return [];
      }

      const activeOrdersList = [];
      activeOrdersSnapshot.forEach((doc) => {
        activeOrdersList.push({
          id: doc.id,
          ...doc.data(),
        });
      });

      const hasActiveOrdersValue = activeOrdersList.length > 0;
      console.log(
        `Active orders found: ${activeOrdersList.length}, hasActiveOrders: ${hasActiveOrdersValue}`
      );

      setActiveOrders(activeOrdersList);
      setHasActiveOrders(hasActiveOrdersValue);

      // Load restaurant data for active orders
      const restaurantIds = activeOrdersList.map((order) => order.restaurantId);
      if (restaurantIds.length > 0) {
        await fetchRestaurantNames(restaurantIds);
      }

      return activeOrdersList;
    } catch (error) {
      console.error("Error fetching active orders:", error);
      setHasActiveOrders(false);
      return [];
    }
  };

  // Check if a new order is in the route of any active order
  const isOrderInActiveRoute = async (newOrder, activeOrdersList) => {
    try {
      // Quick validation of inputs
      if (!newOrder?.id) {
        console.log("Invalid order object received - no ID");
        return false;
      }

      // If no active orders, no routes to check against
      if (
        !activeOrdersList ||
        !Array.isArray(activeOrdersList) ||
        activeOrdersList.length === 0
      ) {
        console.log("No active orders to check against");
        return false;
      }

      // Debug info
      console.log(`⭐ ROUTE CHECK START for order ${newOrder.id}`);
      console.log(`Active orders count: ${activeOrdersList.length}`);

      // New order must have valid delivery location data
      if (
        !newOrder.location ||
        !newOrder.location.lat ||
        !newOrder.location.long
      ) {
        console.log(`Order ${newOrder.id} has no valid delivery location data`);
        return false;
      }

      // Get coordinates for the new order customer location
      const newDeliveryLocation = newOrder.location;
      const newDelLat = parseFloat(newDeliveryLocation.lat);
      const newDelLong = parseFloat(newDeliveryLocation.long);

      // Validate coordinates before proceeding
      if (isNaN(newDelLat) || isNaN(newDelLong)) {
        console.log(`Order ${newOrder.id} has invalid delivery coordinates`);
        return false;
      }

      console.log(`🔍 Checking if order ${newOrder.id} is on route`);
      console.log(
        `New order delivery coordinates: ${newDelLat}, ${newDelLong}`
      );

      // Define the maximum distance in kilometers for an order to be considered "on route"
      const MAX_ROUTE_DISTANCE = 2;

      // Check against each active order's customer location
      for (const activeOrder of activeOrdersList) {
        if (!activeOrder || !activeOrder.id) {
          continue;
        }

        console.log(`Checking against active order ${activeOrder.id}`);

        // Skip if active order doesn't have required location data
        if (
          !activeOrder.location ||
          !activeOrder.location.lat ||
          !activeOrder.location.long
        ) {
          console.log(
            `Active order ${activeOrder.id} missing valid location data, skipping.`
          );
          continue;
        }

        // Get active order delivery location coordinates
        const activeDeliveryLocation = activeOrder.location;
        const activeDelLat = parseFloat(activeDeliveryLocation.lat);
        const activeDelLong = parseFloat(activeDeliveryLocation.long);

        // Verify coordinates are valid
        if (isNaN(activeDelLat) || isNaN(activeDelLong)) {
          console.log(
            `Active order ${activeOrder.id} has invalid delivery coordinates, skipping`
          );
          continue;
        }

        console.log(
          `Active order ${activeOrder.id} delivery coords: ${activeDelLat}, ${activeDelLong}`
        );

        // Calculate distance between delivery locations (customer locations)
        const deliveryLocationsDistance = calculateDistance(
          activeDelLat,
          activeDelLong,
          newDelLat,
          newDelLong
        );

        console.log(
          `🔍 Customer locations distance: ${deliveryLocationsDistance} km`
        );

        // Check if the distance is within our threshold
        if (deliveryLocationsDistance <= MAX_ROUTE_DISTANCE) {
          console.log(
            `✅✅✅ Order ${newOrder.id} IS on route with order ${activeOrder.id}`,
            `Customer distance: ${deliveryLocationsDistance}km`
          );
          return true; // Return true if customer locations are within range
        }
      }

      // If we get here, the order is not on any active route
      console.log(`❌❌❌ Order ${newOrder.id} is not on any active route`);
      return false;
    } catch (error) {
      console.error(
        `Error in isOrderInActiveRoute for order ${newOrder?.id}:`,
        error
      );
      return false; // Return false explicitly on error
    }
  };

  // Function to fetch orders with status "search_courier"
  const fetchSearchCourierOrders = async () => {
    // Don't fetch orders if phone number is not available yet
    if (!phoneNumber) return () => {};

    try {
      setLoading(true);

      // First, fetch active orders to know the courier's current routes
      const activeOrdersList = await fetchActiveOrders();

      // Important: Ensure we have restaurant locations for all active orders immediately
      if (activeOrdersList && activeOrdersList.length > 0) {
        console.log("Fetching restaurant locations for active orders");
        const activeRestaurantIds = activeOrdersList
          .map((order) => order.restaurantId)
          .filter(Boolean);

        // This will ensure we have location data for active orders
        if (activeRestaurantIds.length > 0) {
          await fetchRestaurantNames(activeRestaurantIds);
        }

        // Double check we have valid location data for all active orders
        let missingLocations = false;
        activeOrdersList.forEach((order) => {
          if (
            !order.restaurantId ||
            !restaurantLocations[order.restaurantId] ||
            restaurantLocations[order.restaurantId]?.invalid ||
            !order.location ||
            !order.location.lat ||
            !order.location.long
          ) {
            console.warn(
              `Active order ${order.id} from restaurant ${order.restaurantId} is missing location data`
            );
            missingLocations = true;
          }
        });

        if (missingLocations) {
          console.warn(
            "Some active orders are missing location data - route filtering may not work correctly"
          );
        }
      }

      // Set hasActiveOrders based on the fetched orders
      const hasActiveOrdersValue =
        Array.isArray(activeOrdersList) && activeOrdersList.length > 0;
      setHasActiveOrders(hasActiveOrdersValue);

      console.log(
        `Active orders for filtering: ${
          activeOrdersList?.length || 0
        }, hasActiveOrders: ${hasActiveOrdersValue}`
      );

      // Listen for real-time updates to orders with status "search_courier"
      const unsubscribeFunc = firestore()
        .collection("orders")
        .where("status", "==", "search_courier")
        .onSnapshot(
          async (querySnapshot) => {
            // O'zgarishlar yuz berganda tozaroq log yozish
            console.log(
              "Yangi Firestore o'zgarishlar:",
              querySnapshot.docChanges().length
            );

            setLoading(true); // Yangilanish boshlandi

            let allOrdersList = [];

            querySnapshot.forEach((documentSnapshot) => {
              allOrdersList.push({
                id: documentSnapshot.id,
                ...documentSnapshot.data(),
              });
            });

            console.log(
              "Fetched all search_courier orders:",
              allOrdersList.length
            );

            // Ensure allOrdersList is not empty to prevent index errors
            if (allOrdersList.length === 0) {
              console.log(
                "No search_courier orders found, setting empty array"
              );
              setOrders([]);
              setLoading(false);
              return;
            }

            // Get restaurant names for all orders
            const allRestaurantIds = allOrdersList
              .map((order) => order.restaurantId)
              .filter(Boolean);

            if (allRestaurantIds.length > 0) {
              try {
                await fetchRestaurantNames(allRestaurantIds);
              } catch (error) {
                console.error("Error fetching restaurant data:", error);
              }
            }

            // Check if we have all the location data we need
            let missingLocationCount = 0;
            allOrdersList.forEach((order) => {
              if (
                !order.restaurantId ||
                !restaurantLocations[order.restaurantId] ||
                restaurantLocations[order.restaurantId]?.invalid
              ) {
                missingLocationCount++;
              }
            });

            if (missingLocationCount > 0) {
              console.warn(
                `${missingLocationCount} orders are missing restaurant location data`
              );
            } else {
              console.log("All orders have valid restaurant location data");
            }

            try {
              // Create arrays to store filtered orders
              let ordersOnRoute = [];
              let ordersNotOnRoute = [];

              // Debug all orders before filtering
              console.log(
                `DEBUG: Processing ${allOrdersList.length} total orders for route status...`
              );
              console.log(
                `DEBUG: Active orders count: ${activeOrdersList?.length || 0}`
              );

              // Force refresh orderRouteStatus
              const newRouteStatus = {};

              // Initialize status tracking
              allOrdersList.forEach((order) => {
                if (order && order.id) {
                  newRouteStatus[order.id] = false;
                  calculatingOrders[order.id] = true;
                }
              });

              // Update calculating state first
              setCalculatingOrders({ ...calculatingOrders });

              // Aktiv order bo'lmasa, barcha orderlarni ko'rsatish
              if (!activeOrdersList || activeOrdersList.length === 0) {
                console.log("No active orders, showing all available orders");

                // Update route status for all orders
                allOrdersList.forEach((order) => {
                  if (order && order.id) {
                    calculatingOrders[order.id] = false;
                  }
                });

                // Immediately update state
                setCalculatingOrders({ ...calculatingOrders });
                setOrderRouteStatus(newRouteStatus);
                setOrders(allOrdersList);
                setLoading(false);
                return;
              }

              // Aktiv order bo'lganda, yo'l yo'lakay orderlarni hisoblash
              console.log(
                `Filtering orders based on active routes. Active orders: ${activeOrdersList.length}, All orders: ${allOrdersList.length}`
              );

              // Go through each order and check if it's on route
              for (let i = 0; i < allOrdersList.length; i++) {
                const order = allOrdersList[i];
                if (!order || !order.id) continue;

                try {
                  // Check if order has valid location data
                  if (
                    !order.location ||
                    !order.location.lat ||
                    !order.location.long
                  ) {
                    console.warn(
                      `Order ${order.id} missing location data, marking as not on route.`
                    );
                    newRouteStatus[order.id] = false;
                    calculatingOrders[order.id] = false;
                    ordersNotOnRoute.push(order);
                    continue;
                  }

                  // Check if this order is on any active route
                  console.log(`Checking if order ${order.id} is on route...`);
                  const isOnRoute = await isOrderInActiveRoute(
                    order,
                    activeOrdersList
                  );

                  // Ensure the value is exactly true, not just truthy
                  const routeStatus = isOnRoute === true;

                  // Update route status
                  newRouteStatus[order.id] = routeStatus;
                  calculatingOrders[order.id] = false;

                  // Sort the order based on route status
                  if (routeStatus === true) {
                    ordersOnRoute.push(order);
                    console.log(`✅ Order ${order.id} IS ON ROUTE`);
                  } else {
                    ordersNotOnRoute.push(order);
                    console.log(`❌ Order ${order.id} is NOT on route`);
                  }
                } catch (error) {
                  console.error(
                    `Error checking order ${order.id} route status:`,
                    error
                  );
                  newRouteStatus[order.id] = false;
                  calculatingOrders[order.id] = false;
                  ordersNotOnRoute.push(order);
                }
              }

              // Update states
              setOrderRouteStatus({ ...newRouteStatus });
              setCalculatingOrders({ ...calculatingOrders });

              console.log(
                `Found ${ordersOnRoute.length} orders on route, ${ordersNotOnRoute.length} not on route`
              );

              // Always show some orders - either on route or debug mode
              if (ordersOnRoute.length > 0) {
                // Show orders that are on route
                console.log(
                  `DISPLAYING ${ordersOnRoute.length} orders that are on route`
                );
                setOrders(ordersOnRoute);
              } else if (showAllOrdersDebug) {
                // Debug mode - show all orders
                console.log(
                  `DEBUG MODE: Showing all ${allOrdersList.length} orders`
                );
                setOrders(allOrdersList);
              } else {
                // No orders on route - show empty list
                console.log("No orders on route");
                setOrders([]);
              }

              // Loading complete
              setLoading(false);
            } catch (error) {
              console.error("Error during order filtering:", error);
              // In case of error, show all available orders
              setOrders(allOrdersList);
              setLoading(false);
            }
          },
          (error) => {
            console.error("Error fetching orders:", error);
            setOrders([]); // Explicitly set empty array on error
            setLoading(false);
          }
        );

      // Return unsubscribe function
      return typeof unsubscribeFunc === "function" ? unsubscribeFunc : () => {};
    } catch (error) {
      console.error("Error setting up orders listener:", error);
      setOrders([]); // Explicitly set empty array on error
      setLoading(false);
      return () => {}; // Return empty function in case of error
    }
  };

  // View courier orders
  const viewCourierOrders = async () => {
    try {
      // Don't allow navigation while loading or if navigation already in progress
      if (loading || navigationInProgress.current) {
        return;
      }

      // Mark navigation as in progress
      navigationInProgress.current = true;

      // Set loading state to true while we fetch the data
      setLoading(true);

      console.log("Preparing to navigate to Orders screen");

      // Force fetch fresh active orders before navigating
      let freshOrders = await fetchActiveOrders();
      console.log(
        `Fetched ${freshOrders?.length || 0} orders before navigation`
      );

      // Make sure we have the phone number
      const effectivePhoneNumber =
        phoneNumber || (await AsyncStorage.getItem("courierPhoneNumber"));

      if (!effectivePhoneNumber) {
        navigation.replace("Login");
        navigationInProgress.current = false;
        return;
      }

      // Deep clone orders to prevent reference issues
      let safeOrders = [];

      if (Array.isArray(freshOrders) && freshOrders.length > 0) {
        // Deep clone the array to completely separate from original
        safeOrders = JSON.parse(JSON.stringify(freshOrders));
      }

      // Use separate object for params to avoid reference issues
      const params = {
        phoneNumber: effectivePhoneNumber,
        timestamp: Date.now(),
        ordersCount: safeOrders.length,
        preloadOrders: safeOrders, // Safe copy of orders array
      };

      console.log(`Navigating to Orders with ${safeOrders.length} orders`);

      // Clean up any existing listeners to prevent memory leaks
      if (
        unsubscribeOrdersListenerRef.current &&
        typeof unsubscribeOrdersListenerRef.current === "function"
      ) {
        console.log("Cleaning up orders listener before navigation");
        unsubscribeOrdersListenerRef.current();
        unsubscribeOrdersListenerRef.current = null;
      }

      // Use replace with a small delay to prevent UI glitches
      setTimeout(() => {
        // Using replace is more reliable than navigate
        navigation.replace("Orders", params);
        navigationInProgress.current = false;
      }, 200);
    } catch (error) {
      console.error("Error navigating to orders screen:", error);
      Alert.alert(
        "Xatolik",
        "Buyurtmalar sahifasiga o'tishda xatolik yuz berdi"
      );
      navigationInProgress.current = false;
      setLoading(false);
    }
  };

  // Logout function
  const handleLogout = async () => {
    try {
      await AsyncStorage.removeItem("courierPhoneNumber");
      navigation.replace("Login");
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const initLocationTracking = useCallback(() => {
    console.log("Starting location tracking");
    let locationInterval = null;

    // Track if component is mounted to prevent state updates after unmount
    let isMounted = true;

    const cleanup = () => {
      console.log("Cleaning up location tracking");
      if (locationInterval) {
        clearInterval(locationInterval);
        locationInterval = null;
      }
    };

    const updateLocation = async () => {
      try {
        const hasPermission = await checkLocationPermission();

        if (!hasPermission) {
          console.log("No location permission granted");
          if (isMounted) {
            setLocationError("Lokatsiya ruxsati berilmagan");
          }
          return;
        }

        // Get current location
        console.log("Getting current location...");

        try {
          const location = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
            timeInterval: 5000,
            distanceInterval: 100,
          });

          if (!location || !location.coords) {
            console.log("Invalid location data received");
            if (isMounted) {
              setLocationError("Joylashuv ma'lumotini olib bo'lmadi");
            }
            return;
          }

          const { latitude, longitude } = location.coords;

          // Validate coordinates
          if (
            typeof latitude !== "number" ||
            typeof longitude !== "number" ||
            isNaN(latitude) ||
            isNaN(longitude)
          ) {
            console.log("Invalid coordinates:", { latitude, longitude });
            if (isMounted) {
              setLocationError("Joylashuv koordinatalari noto'g'ri");
            }
            return;
          }

          console.log("Current location:", { latitude, longitude });

          // Set current location in state
          if (isMounted) {
            setCurrentLocation({ lat: latitude, long: longitude });
            setLocationError(null); // Clear any previous error
          }

          // Get courier phone number from AsyncStorage
          const storedPhoneNumber = await AsyncStorage.getItem(
            "courierPhoneNumber"
          );
          const courierPhone = phoneNumber || storedPhoneNumber;

          if (!courierPhone) {
            console.log("No phone number found, cannot update location");
            return;
          }

          // Update location in Firestore
          await firestore()
            .collection("couriers")
            .doc(courierPhone)
            .set(
              {
                location: {
                  lat: latitude,
                  long: longitude,
                  timestamp: firestore.FieldValue.serverTimestamp(),
                },
                online: true,
              },
              { merge: true }
            );

          console.log("Location updated in Firestore");
        } catch (locationError) {
          console.error("Error getting location:", locationError);
          if (isMounted) {
            setLocationError("Joylashuv ma'lumotini olishda xatolik yuz berdi");
          }
        }
      } catch (error) {
        console.error("Error in location service:", error);
        if (isMounted) {
          setLocationError("Lokatsiya servisida xatolik yuz berdi");
        }
      }
    };

    // Immediately get and update location
    updateLocation();

    // Set interval for location updates (every 30 seconds)
    locationInterval = setInterval(() => {
      updateLocation();
    }, 30000);

    return () => {
      isMounted = false;
      cleanup();
    };
  }, [phoneNumber]);

  // Initialize location tracking when the component mounts
  useEffect(() => {
    const cleanupFn = initLocationTracking();
    return cleanupFn;
  }, [initLocationTracking]);

  // Initialize FCM and handlers
  const initFirebaseMessaging = async () => {
    // Ensure we have permissions
    const hasPermission = await requestUserPermission();

    if (!hasPermission) {
      console.log("Notification permissions not granted");
      return;
    }

    try {
      // Get the FCM token
      const token = await messaging().getToken();
      console.log("📲 FCM Token:", token);
      setFcmToken(token);

      // Subscribe to the 'new_orders' topic
      await messaging().subscribeToTopic("new_orders");
      console.log("✅ Subscribed to 'new_orders' topic on initialization");
      setIsSubscribed(true);
    } catch (error) {
      console.error("Error in FCM initialization:", error);
    }

    // Handle token refresh
    const unsubscribeTokenRefresh = messaging().onTokenRefresh(
      async (newToken) => {
        console.log("New FCM token received:", newToken);
        setFcmToken(newToken);

        // Re-subscribe with the new token
        try {
          await messaging().subscribeToTopic("new_orders");
          console.log(
            "✅ Re-subscribed to 'new_orders' topic after token refresh"
          );
          setIsSubscribed(true);
        } catch (error) {
          console.error("Error re-subscribing after token refresh:", error);
        }
      }
    );

    // When the app is opened from a quit state by tapping on the notification
    messaging()
      .getInitialNotification()
      .then((remoteMessage) => {
        if (remoteMessage) {
          console.log(
            "🔁 Notification caused app to open from quit state:",
            JSON.stringify(remoteMessage)
          );
        }
      })
      .catch((error) => {
        console.error("Error getting initial notification:", error);
      });

    // When the app is in the background and user taps the notification
    const unsubscribeBackground = messaging().onNotificationOpenedApp(
      (remoteMessage) => {
        console.log(
          "🔁 Notification caused app to open from background state:",
          JSON.stringify(remoteMessage)
        );
      }
    );

    // Foreground message listener
    const unsubscribeForeground = messaging().onMessage(
      async (remoteMessage) => {
        console.log(
          "📩 Foreground message received:",
          JSON.stringify(remoteMessage)
        );

        // Bildirishnoma ma'lumotlarini olish
        const title = remoteMessage?.notification?.title || "Yangi buyurtma";
        const body =
          remoteMessage?.notification?.body ||
          `Buyurtmaga kuryer qidirilmoqda: ${remoteMessage?.data?.deliveryPrice}`;

        // Extract order ID from notification data if available
        const orderId = remoteMessage?.data?.orderId;
        const orderStatus = remoteMessage?.data?.status;

        // Aktiv buyurtmalar borligini tekshirish
        const hasActiveOrdersNow = activeOrders && activeOrders.length > 0;
        let shouldPlaySound = true;

        // Agar buyurtma status-i "search_courier" bo'lsa va aktiv buyurtma bo'lsa
        if (orderStatus === "search_courier" && hasActiveOrdersNow && orderId) {
          console.log(
            "Yangi buyurtma bor va aktiv buyurtmalar mavjud:",
            orderId
          );

          try {
            // Yangi buyurtma ma'lumotlarini olish
            const orderDoc = await firestore()
              .collection("orders")
              .doc(orderId)
              .get();

            if (orderDoc.exists) {
              const orderData = orderDoc.data();

              // Buyurtma obyekti yaratish
              const newOrder = {
                id: orderId,
                ...orderData,
              };

              // Buyurtma yo'l yo'lakay ekanligini tekshirish
              const isOnRoute = await isOrderInActiveRoute(
                newOrder,
                activeOrders
              );

              console.log(`Buyurtma ${orderId} yo'l yo'lakay: ${isOnRoute}`);

              // Faqat yo'l yo'lakay buyurtmalarda ovoz chalinadi
              shouldPlaySound = isOnRoute === true;
            }
          } catch (error) {
            console.error("Buyurtma ma'lumotlarini olishda xatolik:", error);
            // Xatolik yuzaga kelsa, xavfsizlik uchun bildirish berish
            shouldPlaySound = true;
          }
        }

        console.log("Ovoz chalinishi kerakmi:", shouldPlaySound);

        // Faqat ovoz chalinishi kerak bo'lsa chalinadi
        if (shouldPlaySound) {
          // Prevent multiple sound playing
          if (isNotificationPlaying.current) {
            console.log("Notification already playing, showing alert only");
            if (Platform.OS === "ios") {
              Alert.alert(title, body);
            }
            return;
          }

          // Play notification sound
          try {
            const soundPlayed = await playNotificationSound();
            console.log("Notification sound played:", soundPlayed);

            // Show alert on iOS or if sound failed
            if (Platform.OS === "ios" || !soundPlayed) {
              Alert.alert(title, body);
            }
          } catch (soundError) {
            console.error("Error playing notification sound:", soundError);
            // Sound failed, show alert
            Alert.alert(title, body);
          }
        } else {
          // Yo'l yo'lakay bo'lmagan buyurtma - ovoz chalinmaydi faqat xabar ko'rsatiladi
          console.log("Buyurtma yo'l yo'lakay emas, ovoz chalinmaydi");
          Alert.alert(title, body);
        }
      }
    );

    // Clean up the listeners
    return () => {
      if (typeof unsubscribeForeground === "function") unsubscribeForeground();
      if (typeof unsubscribeBackground === "function") unsubscribeBackground();
      if (typeof unsubscribeTokenRefresh === "function")
        unsubscribeTokenRefresh();
    };
  };

  useEffect(() => {
    let unsubscribeOrdersListener = null;
    let locationCleanup = null;
    let backHandler = null;
    let unsubscribeFocus = null;

    // Initialize app
    const initializeApp = async () => {
      // 1. Get phone number if not provided
      if (!phoneNumber) {
        try {
          const storedPhoneNumber = await AsyncStorage.getItem(
            "courierPhoneNumber"
          );
          if (storedPhoneNumber) {
            navigation.setParams({ phoneNumber: storedPhoneNumber });
            return; // Exit early to let the effect run again with the phoneNumber
          } else {
            navigation.replace("Login");
            return;
          }
        } catch (error) {
          console.error("Error retrieving phone number:", error);
          navigation.replace("Login");
          return;
        }
      }

      // 2. Initialize location tracking
      try {
        const cleanup = await initLocationTracking();
        if (cleanup && typeof cleanup === "function") {
          locationCleanup = cleanup;
        }
      } catch (error) {
        console.error("Failed to initialize location tracking:", error);
      }

      // 3. Set up hardware back button handler
      backHandler = BackHandler.addEventListener("hardwareBackPress", () => {
        Alert.alert(
          "Chiqishni tasdiqlang",
          "Dasturdan chiqishni xohlaysizmi?",
          [
            { text: "Yo'q", style: "cancel" },
            { text: "Ha", onPress: () => BackHandler.exitApp() },
          ]
        );
        return true; // Prevent default behavior
      });

      // 4. Add navigation focus listener
      unsubscribeFocus = navigation.addListener("focus", async () => {
        console.log(
          "HomeScreen focused with fromOrders:",
          fromOrders,
          "isInitialized:",
          isInitialized
        );

        // Coming from Orders screen with fromOrders flag
        if (fromOrders) {
          console.log("Navigation from OrdersScreen detected");

          // Clear fromOrders param immediately to prevent re-running this code
          navigation.setParams({ fromOrders: null });

          // Reset initialization flag on the next frame
          setTimeout(() => {
            // Set initialized true only after we've processed this navigation event
            setIsInitialized(true);
          }, 0);

          // Reset all state
          setOrders([]);
          setActiveOrders([]);
          setHasActiveOrders(false);
          setOrderDistances({});
          setOrderRouteStatus({});
          setCalculatingOrders({});
          setLoading(true);

          // Clear any existing listeners
          if (
            unsubscribeOrdersListener &&
            typeof unsubscribeOrdersListener === "function"
          ) {
            console.log("Clearing previous order listeners");
            unsubscribeOrdersListener();
            unsubscribeOrdersListener = null;
          }

          // Fetch data with short delay
          setTimeout(async () => {
            try {
              // First fetch active orders
              const activeOrdersList = await fetchActiveOrders();
              console.log(
                `Fetched ${
                  activeOrdersList?.length || 0
                } active orders after navigation`
              );

              // Then fetch search courier orders
              const unsubFunc = await fetchSearchCourierOrders();

              if (typeof unsubFunc === "function") {
                unsubscribeOrdersListener = unsubFunc;
                console.log("Successfully set up new orders listener");
              }
            } catch (error) {
              console.error(
                "Error initializing data after Orders screen navigation:",
                error
              );
            } finally {
              setLoading(false);
            }
          }, 150);

          return;
        }

        // Reset state if needed (when coming from Orders screen with resetState flag)
        if (resetState) {
          console.log(
            "Resetting HomeScreen state after navigation from Orders"
          );
          setOrders([]);
          setLoading(true);

          // Refresh data
          try {
            const activeOrdersList = await fetchActiveOrders();
            const unsubFunc = await fetchSearchCourierOrders();

            if (typeof unsubFunc === "function") {
              // Clean up previous listener if exists
              if (
                unsubscribeOrdersListener &&
                typeof unsubscribeOrdersListener === "function"
              ) {
                unsubscribeOrdersListener();
              }

              unsubscribeOrdersListener = unsubFunc;
            }
          } catch (error) {
            console.error("Error refreshing data:", error);
          } finally {
            setLoading(false);
          }

          // Clear the resetState flag
          navigation.setParams({ resetState: false });
        }
      });

      // 5. Initialize Firebase messaging
      initFirebaseMessaging();

      // 6. Fetch initial orders data
      try {
        setLoading(true);

        // First fetch active orders
        await fetchActiveOrders();

        // Then fetch available orders
        const unsubFunc = await fetchSearchCourierOrders();

        if (typeof unsubFunc === "function") {
          unsubscribeOrdersListener = unsubFunc;
          // Store in ref for access in other functions
          unsubscribeOrdersListenerRef.current = unsubFunc;
        } else {
          console.log("Warning: unsubscribe is not a function", unsubFunc);
        }
      } catch (error) {
        console.error("Error fetching initial orders data:", error);
      } finally {
        setLoading(false);
      }
    };

    // Start initialization
    initializeApp();

    // Clean up function
    return () => {
      // Clean up Firestore listener
      if (
        unsubscribeOrdersListener &&
        typeof unsubscribeOrdersListener === "function"
      ) {
        unsubscribeOrdersListener();
        unsubscribeOrdersListenerRef.current = null;
      }

      // Clean up location tracking
      if (locationCleanup && typeof locationCleanup === "function") {
        locationCleanup();
      }

      // Clean up navigation focus listener
      if (unsubscribeFocus) {
        unsubscribeFocus();
      }

      // Clean up hardware back button handler
      if (backHandler) {
        backHandler.remove();
      }

      // Reset navigation flag
      navigationInProgress.current = false;
    };
  }, [navigation, phoneNumber, resetState, fromOrders]);

  // Calculate which orders are on the active route - only updates status objects, doesn't filter orders
  useEffect(() => {
    if (!activeOrders || !orders) return;

    // Debug active orders
    console.log(`Active orders updated: ${activeOrders.length} orders active`);
    if (activeOrders.length > 0) {
      console.log(
        "Active order restaurants:",
        activeOrders.map((o) => o.restaurantId)
      );
    }

    // Skip updating route status if there are no active orders
    if (activeOrders.length === 0) {
      console.log("No active orders, skipping route status update");
      return;
    }

    // Skip updating route status if there are no orders to check
    if (orders.length === 0) {
      console.log("No orders to check against active routes");
      return;
    }

    console.log(
      `Checking ${orders.length} orders for route status in useEffect`
    );

    // Important: Do NOT filter orders here - just update route status for UI display
    // This useEffect should only update the status objects, not filter the orders list
    // since fetchSearchCourierOrders already does the filtering

    // Create a clone of the current status objects
    const newRouteStatus = { ...orderRouteStatus };
    const newCalculating = { ...calculatingOrders };

    // Initialize status tracking for any orders we don't have yet
    orders.forEach((order) => {
      if (order && order.id) {
        // Only mark as calculating if we don't already have a status
        if (newRouteStatus[order.id] === undefined) {
          newCalculating[order.id] = true;
        }
      }
    });

    // Update the calculating state first
    setCalculatingOrders(newCalculating);

    // Define an async function inside the effect
    const checkOrdersInRoute = async () => {
      try {
        // Check each available order
        for (const order of orders) {
          if (!order || !order.id) continue;

          // Only check orders that are currently calculating or don't have a status
          if (
            newCalculating[order.id] === true ||
            newRouteStatus[order.id] === undefined
          ) {
            try {
              // CRITICAL FIX: Force boolean result here
              const isInRoute = await isOrderInActiveRoute(order, activeOrders);
              const booleanResult = isInRoute === true ? true : false;

              // Set status explicitly to boolean
              newRouteStatus[order.id] = booleanResult;
              newCalculating[order.id] = false;

              // Log status update
              console.log(
                `Order ${order.id} route status updated: ${booleanResult}, restaurant: ${order.restaurantId}`
              );
            } catch (error) {
              console.error(
                `Error checking route status for order ${order.id}:`,
                error
              );
              newRouteStatus[order.id] = false;
              newCalculating[order.id] = false;
            }
          }
        }

        // Update states with the new status objects
        setOrderRouteStatus({ ...newRouteStatus });
        setCalculatingOrders({ ...newCalculating });

        // Log updated status counts
        const onRouteCount = Object.values(newRouteStatus).filter(
          (status) => status === true
        ).length;
        console.log(
          `Updated route status: ${onRouteCount} orders on route out of ${orders.length}`
        );
      } catch (error) {
        console.error("Error in route status update effect:", error);
      }
    };

    // Call the async function
    checkOrdersInRoute();
  }, [activeOrders, orders]);

  // Handle order acceptance with error handling
  const handleAcceptOrder = async (orderId) => {
    try {
      setIsAcceptingId(orderId);
      setProcessingOrder(orderId);

      // First, verify that the order still exists and has the correct status
      try {
        const currentOrderDoc = await firestore()
          .collection("orders")
          .doc(orderId)
          .get();

        if (!currentOrderDoc.exists) {
          console.error(`Order ${orderId} no longer exists`);
          Alert.alert(
            "Buyurtma topilmadi",
            "Bu buyurtma endi mavjud emas. Sahifani yangilang."
          );
          setIsAcceptingId(null);
          setProcessingOrder(null);
          return;
        }

        const currentOrderData = currentOrderDoc.data();
        if (currentOrderData.status !== "search_courier") {
          console.error(
            `Order ${orderId} has incorrect status: ${currentOrderData.status}`
          );
          Alert.alert(
            "Buyurtma holati o'zgargan",
            "Bu buyurtma allaqachon boshqa kuryer tomonidan qabul qilingan yoki bekor qilingan."
          );
          setIsAcceptingId(null);
          setProcessingOrder(null);
          return;
        }

        console.log(`Order ${orderId} verified and available for acceptance`);
      } catch (verifyError) {
        console.error("Error verifying order status:", verifyError);
        // Continue with acceptance attempt despite verification error
      }

      // Check if courier's location is available
      if (!currentLocation || !currentLocation.lat || !currentLocation.long) {
        // Try to get current location once more before failing
        try {
          const location = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });

          if (location && location.coords) {
            setCurrentLocation({
              lat: location.coords.latitude,
              long: location.coords.longitude,
            });

            // Continue with order acceptance since we now have a location
            console.log("Successfully got location for order acceptance");
          } else {
            throw new Error("Joylashuv ma'lumoti olinmadi");
          }
        } catch (locationError) {
          console.error(
            "Error getting location for order acceptance:",
            locationError
          );

          // Show error message to user
          Alert.alert(
            "Joylashuv ma'lumoti mavjud emas",
            "Buyurtmani qabul qilish uchun joylashuv ma'lumotingizni yoqishingiz kerak. Lokatsiya xizmatlarini tekshiring.",
            [
              {
                text: "Lokatsiya sozlamalarini ochish",
                onPress: async () => {
                  // Open location settings
                  if (Platform.OS === "ios") {
                    Linking.openURL("app-settings:");
                  } else {
                    Linking.openSettings();
                  }
                },
              },
              { text: "Bekor qilish", style: "cancel" },
            ]
          );
          setProcessingOrder(null);
          setIsAcceptingId(null);
          return;
        }
      }

      // Proceed with order acceptance
      await acceptOrder(orderId);
    } catch (error) {
      console.error("Error accepting order:", error);
      Alert.alert(
        "Xatolik yuz berdi",
        "Buyurtmani qabul qilishda xatolik yuz berdi. Iltimos, qayta urinib ko'ring.",
        [{ text: "OK" }]
      );
    } finally {
      setProcessingOrder(null);
      setIsAcceptingId(null);
    }
  };

  // Accept an order by courier
  const acceptOrder = async (orderId) => {
    try {
      if (!phoneNumber) {
        Alert.alert(
          "Xatolik",
          "Telefon raqamingiz topilmadi. Iltimos, qayta tizimga kiring."
        );
        return;
      }

      if (!orderId) {
        console.error("Invalid order ID:", orderId);
        Alert.alert(
          "Xatolik",
          "Buyurtma identifikatori mavjud emas. Iltimos, qayta urinib ko'ring."
        );
        return;
      }

      console.log(`Buyurtma qabul qilinmoqda: ${orderId}`);

      // Firestore Transaction ishlatish orqali bir vaqtning o'zida
      // bir nechta kuryer bir xil buyurtmani olishini oldini olish
      try {
        // Create a timeout promise
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => {
            reject(new Error("Transaction timeout - operation took too long"));
          }, 15000); // 15 second timeout
        });

        // Run the transaction with a timeout
        await Promise.race([
          (async () => {
            // Transaction boshlash
            await firestore().runTransaction(async (transaction) => {
              try {
                // Buyurtma haqida ma'lumot olish
                const orderDoc = await transaction.get(
                  firestore().collection("orders").doc(orderId)
                );

                // Agar hujjat mavjud bo'lmasa, xato chiqaramiz
                if (!orderDoc.exists) {
                  console.error(`Order with ID ${orderId} not found`);
                  throw new Error("Buyurtma topilmadi");
                }

                // Buyurtma ma'lumotlari
                const orderData = orderDoc.data();
                console.log(`Order status: ${orderData.status}`);

                // Agar buyurtma status search_courier bo'lmasa, boshqa kuryer allaqachon olgan
                if (orderData.status !== "search_courier") {
                  console.error(
                    `Order with ID ${orderId} already accepted, status: ${orderData.status}`
                  );
                  throw new Error("Bu buyurtma allaqachon qabul qilingan");
                }

                // Buyurtma statusini yangilash
                transaction.update(
                  firestore().collection("orders").doc(orderId),
                  {
                    status: "courier",
                    courier: phoneNumber,
                    acceptedAt: firestore.FieldValue.serverTimestamp(),
                  }
                );

                console.log(
                  `Successfully updated order ${orderId} in transaction`
                );
              } catch (transactionError) {
                console.error("Transaction error:", transactionError);
                throw transactionError;
              }
            });
          })(),
          timeoutPromise,
        ]);

        console.log(`Transaction completed successfully for order ${orderId}`);

        // Transaction muvaffaqiyatli bo'lganidan keyin, yangilangan ma'lumotlarni olish
        const updatedOrderSnapshot = await firestore()
          .collection("orders")
          .doc(orderId)
          .get();

        if (updatedOrderSnapshot.exists) {
          const updatedOrderData = {
            id: updatedOrderSnapshot.id,
            ...updatedOrderSnapshot.data(),
          };

          console.log(
            `Navigating to Orders screen with accepted order ${orderId}`
          );

          // Kuryer buyurtmalar ekraniga o'tish
          navigation.replace("Orders", {
            phoneNumber,
            timestamp: Date.now(),
            acceptedOrderId: orderId,
            isNewlyAccepted: true,
            preloadOrders: [updatedOrderData],
          });
        } else {
          console.error(
            `Order ${orderId} not found after successful transaction`
          );
          throw new Error(
            "Buyurtma ma'lumotlari yangilanishdan keyin topilmadi"
          );
        }
      } catch (error) {
        if (error.message === "Bu buyurtma allaqachon qabul qilingan") {
          // Boshqa kuryer allaqachon olgan
          Alert.alert(
            "Buyurtma band",
            "Kechirasiz, bu buyurtma boshqa kuryer tomonidan allaqachon qabul qilingan."
          );
        } else if (error.message.includes("timeout")) {
          console.error("Transaction timeout:", error);
          Alert.alert(
            "Xatolik - Vaqt tugadi",
            "Amaliyot juda uzoq vaqt davom etdi. Iltimos, internet aloqangizni tekshirib, qayta urinib ko'ring."
          );
        } else {
          console.error("Firestore'da buyurtmani yangilashda xatolik:", error);
          Alert.alert(
            "Xatolik",
            `Buyurtmani qabul qilishda texnik xatolik yuz berdi: ${error.message}`
          );
        }
      }
    } catch (error) {
      console.error("Buyurtmani qabul qilishda xatolik:", error);
      Alert.alert(
        "Xatolik",
        `Buyurtmani qabul qilishda xatolik: ${error.message}`
      );
    }
  };

  // Render each order item on the home screen
  const renderOrder = ({ item, index }) => {
    if (!item || !item.id || item.hidden) {
      return null;
    }

    const isOnRoute = acceptedOrderId === item.id;

    // Calculate distance between restaurant and delivery locations
    let distance = null;
    if (
      item.location?.lat &&
      item.location?.long &&
      restaurantLocations[item.restaurantId]?.lat &&
      restaurantLocations[item.restaurantId]?.long
    ) {
      distance = calculateDistance(
        item.location.lat,
        item.location.long,
        restaurantLocations[item.restaurantId].lat,
        restaurantLocations[item.restaurantId].long
      );
    }

    return (
      <View
        style={[styles.orderCard, isOnRoute ? styles.onRouteOrderCard : null]}
      >
        {isOnRoute && (
          <View style={styles.routeBadge}>
            <Ionicons name="navigate" size={14} color="#fff" />
            <Text style={styles.routeBadgeText}>Yo'lda</Text>
          </View>
        )}

        <View style={styles.orderHeader}>
          <View style={styles.priceContainer}>
            <Text style={styles.orderPrice}>
              {item.deliveryPrice || 0} so'm
            </Text>
            <Text style={styles.priceLabel}>Yetkazib berish narxi</Text>
          </View>
          <View style={styles.restaurantContainer}>
            <Ionicons name="restaurant-outline" size={22} color="#f39c12" />
            <Text style={styles.restaurantName} numberOfLines={1}>
              {restaurants[item.restaurantId] || "Noma'lum restoran"}
            </Text>
          </View>
        </View>

        <View style={styles.orderDetails}>
          <View style={styles.detailRow}>
            <View style={styles.detailIcon}>
              <Ionicons name="cash-outline" size={18} color="#2ecc71" />
            </View>
            <Text style={styles.orderTotal}>
              Buyurtma: {(item.price || 0) + (item.servicePrice || 0) || 0} so'm
            </Text>
          </View>

          <View style={styles.detailRow}>
            <View style={styles.detailIcon}>
              <Ionicons name="navigate-outline" size={18} color="#e74c3c" />
            </View>
            <Text style={styles.distanceText}>
              Masofa: {distance ? `${distance} km` : "Ma'lumot yo'q"}
            </Text>
          </View>

          <View style={styles.detailRow}>
            <View style={styles.detailIcon}>
              <Ionicons name="call-outline" size={18} color="#9b59b6" />
            </View>
            <Text style={styles.phoneText}>
              Mijoz: +998{item.phoneNumber || "Ma'lumot yo'q"}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={[
            styles.acceptButton,
            isAcceptingId === item.id && styles.acceptingButton,
          ]}
          onPress={() =>
            isAcceptingId !== item.id && handleAcceptOrder(item.id)
          }
          disabled={isAcceptingId === item.id || isOnRoute}
          activeOpacity={0.8}
        >
          {isAcceptingId === item.id ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <>
              <Ionicons
                name="checkmark-circle-outline"
                size={22}
                color="#fff"
              />
              <Text style={styles.acceptButtonText}>
                {isOnRoute ? "Buyurtma yo'lda" : "Buyurtmani qabul qilish"}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  // Create key extractor function once rather than recreating it on each render
  const keyExtractor = useCallback((item, index) => {
    if (!item) return `empty-item-${index}`;
    return item.id ? `order-${item.id}` : `order-index-${index}`;
  }, []);

  // Memoize core UI components for better performance
  const OrdersList = useCallback(() => {
    if (loading) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#0000ff" />
          <Text style={styles.loadingText}>Yuklanyapti...</Text>
        </View>
      );
    }

    // Show location error if exists
    if (locationError) {
      return (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{locationError}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => {
              // Retry getting location
              initLocationTracking();
            }}
          >
            <Text style={styles.retryButtonText}>Qayta urinish</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.settingsButton}
            onPress={() => {
              // Open location settings
              if (Platform.OS === "ios") {
                Linking.openURL("app-settings:");
              } else {
                Linking.openSettings();
              }
            }}
          >
            <Text style={styles.settingsButtonText}>Sozlamalarni ochish</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (!orders || orders.length === 0) {
      return (
        <Text style={styles.noOrders}>
          {hasActiveOrders
            ? "Yo'l ustida qo'shimcha buyurtmalar mavjud emas. Faqat yo'l ustidagi buyurtmalar ko'rsatiladi (2 km radius)."
            : "Hozirda kutilayotgan buyurtmalar yo'q"}
        </Text>
      );
    }

    // Calculate a unique keyed value for extraData to force re-render on state changes
    const extraDataMemo = useMemo(() => {
      return {
        orderDistances,
        orderRouteStatus,
        calculatingOrders,
        processingOrder,
        restaurants,
        hasActiveOrders,
        timestamp: Date.now(),
      };
    }, [
      orderDistances,
      orderRouteStatus,
      calculatingOrders,
      processingOrder,
      restaurants,
      hasActiveOrders,
    ]);

    return (
      <FlatList
        key="orders-list-fixed"
        data={orders}
        renderItem={renderOrder}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.ordersList}
        initialNumToRender={3}
        maxToRenderPerBatch={3}
        windowSize={5}
        updateCellsBatchingPeriod={50}
        removeClippedSubviews={false}
        viewabilityConfig={{
          itemVisiblePercentThreshold: 50,
          minimumViewTime: 300,
        }}
        maintainVisibleContentPosition={{
          minIndexForVisible: 0,
          autoscrollToTopThreshold: 1,
        }}
        extraData={extraDataMemo}
        ListEmptyComponent={() => (
          <Text style={styles.noOrders}>
            Hozirda kutilayotgan buyurtmalar yo'q
          </Text>
        )}
        onError={(error) => {
          console.error("FlatList error:", error);
        }}
      />
    );
  }, [
    loading,
    orders,
    locationError,
    hasActiveOrders,
    orderDistances,
    orderRouteStatus,
    calculatingOrders,
    processingOrder,
    restaurants,
    keyExtractor,
    renderOrder,
    initLocationTracking,
  ]);

  // Initialize sound playing system - Expo Audio bilan ishlashga o'zgartirish
  useEffect(() => {
    // Set up audio session for Expo Audio
    async function setupAudio() {
      if (!Audio) {
        console.log("Expo Audio not available, skipping audio setup");
        return;
      }

      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          staysActiveInBackground: false,
          playsInSilentModeIOS: true,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        });
        console.log("Expo Audio mode configured successfully");

        // Ovoz faqat yangi buyurtma kelganda chalinadi
        // Test qism o'chirildi
        /* 
        if (__DEV__) {
          setTimeout(() => {
            try {
              console.log("Testing audio on initialization");
              playNotificationSound();
            } catch (e) {
              console.warn("Initial audio test failed:", e);
            }
          }, 2000);
        }
        */
      } catch (error) {
        console.error("Failed to configure Audio mode:", error);
      }
    }

    // Setup audio
    setupAudio();

    return () => {
      // Clean up any Expo Audio sounds on unmount
      if (soundRef.current) {
        try {
          soundRef.current.unloadAsync();
        } catch (e) {
          console.warn("Error unloading sound:", e);
        }
        soundRef.current = null;
      }
    };
  }, []);

  // Function to play notification sound using all available methods
  const playNotificationSound = async () => {
    // Prevent multiple simultaneous notifications
    if (isNotificationPlaying.current) {
      console.log("Notification sound already playing, skipping");
      return true;
    }

    console.log("Attempting to play notification sound");
    let soundPlayed = false;
    isNotificationPlaying.current = true;

    // First try vibration as it's most reliable
    try {
      Vibration.vibrate(500);
      console.log("Vibration triggered via React Native API");
    } catch (error) {
      console.warn("Vibration failed:", error);
    }

    try {
      // Use Expo Audio
      if (Audio) {
        try {
          console.log("Playing with Expo Audio");

          // Unload previous sound if exists
          if (soundRef.current) {
            await soundRef.current.unloadAsync();
            soundRef.current = null;
          }

          const sound = new Audio.Sound();

          if (Platform.OS === "android") {
            // Android uchun maxsus usul
            await sound.loadAsync(require("../assets/alert.mp3"));
          } else {
            await sound.loadAsync(require("../assets/alert.mp3"));
          }

          await sound.playAsync();

          soundRef.current = sound;

          // Store the sound reference and set up cleanup
          soundRef.current = sound;
          console.log("Expo Audio playback started successfully");
          soundPlayed = true;

          // Sound tugagandan keyin tozalash
          sound.setOnPlaybackStatusUpdate((status) => {
            if (status.didJustFinish) {
              console.log("Expo Audio finished playing");
              sound.unloadAsync().catch((e) => {
                console.warn("Error unloading sound:", e);
              });
              soundRef.current = null;
              // Reset notification playing flag after sound finishes
              setTimeout(() => {
                isNotificationPlaying.current = false;
              }, 100);
            }
          });
        } catch (loadError) {
          console.error("Error loading or playing sound:", loadError);
          isNotificationPlaying.current = false;
        }
      } else {
        console.warn("Expo Audio not available, no sound will be played");
        isNotificationPlaying.current = false;
      }
    } catch (error) {
      console.error("All sound methods failed:", error);
      isNotificationPlaying.current = false;
    }

    // If sound doesn't complete playing normally (error case), reset the flag after a timeout
    if (!soundPlayed) {
      setTimeout(() => {
        isNotificationPlaying.current = false;
      }, 1000);
    }

    return soundPlayed;
  };

  // Function to test sound playback
  const testSoundPlayback = () => {
    console.log("Testing sound playback...");
    playNotificationSound();
  };

  // Function to check if sound modules are available
  const checkSoundModulesAvailability = () => {
    const results = {
      nativeModuleAvailable: false,
      expoAudioAvailable: false,
    };

    // Check SoundModule (our native module)
    if (
      SoundModule &&
      typeof SoundModule.playNotificationSound === "function"
    ) {
      results.nativeModuleAvailable = true;
    }

    // Check Expo Audio
    if (Audio) {
      results.expoAudioAvailable = true;
    }

    console.log("Sound modules availability:", results);
    return results;
  };

  // Initialize sound modules check
  useEffect(() => {
    // Check sound modules availability
    const soundModulesStatus = checkSoundModulesAvailability();

    // Log the results
    if (
      !soundModulesStatus.nativeModuleAvailable &&
      !soundModulesStatus.expoAudioAvailable
    ) {
      console.warn(
        "WARNING: No sound modules are available. Notifications will be silent!"
      );
    } else {
      const availableMethods = [];
      if (soundModulesStatus.nativeModuleAvailable)
        availableMethods.push("Native Module");
      if (soundModulesStatus.expoAudioAvailable)
        availableMethods.push("Expo Audio");

      console.log(
        `Sound system initialized. Available methods: ${availableMethods.join(
          ", "
        )}`
      );
    }
  }, []);

  // Test functions for debugging
  async function testNativeSound() {
    try {
      console.log("Testing Native Sound Module - using Expo Audio instead");
      playNotificationSound();
    } catch (e) {
      console.error("Sound test error:", e);
    }
  }

  async function testExpoAudio() {
    try {
      console.log("Testing Expo Audio");
      const sound = new Audio.Sound();

      if (Platform.OS === "android") {
        // Android uchun maxsus usul
        await sound.loadAsync(require("../assets/alert.mp3"));
      } else {
        await sound.loadAsync(require("../assets/alert.mp3"));
      }

      await sound.playAsync();

      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.didJustFinish) {
          sound
            .unloadAsync()
            .catch((e) => console.log("Error unloading sound", e));
        }
      });
    } catch (e) {
      console.error("Expo Audio test error:", e);
    }
  }

  function testVibration() {
    console.log("Testing Vibration");
    Vibration.vibrate(500);
  }

  function testAllNotifications() {
    console.log("Testing all notification methods");
    playNotificationSound();
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerContainer}>
        <View style={styles.headerButtons}>
          <TouchableOpacity
            style={styles.myOrdersButton}
            onPress={() => viewCourierOrders()}
            disabled={loading}
            activeOpacity={0.8}
          >
            <Ionicons name="list" size={22} color="#fff" />
            <Text style={styles.myOrdersButtonText}>
              {loading ? "Yuklanmoqda..." : "Mening buyurtmalarim"}
            </Text>
          </TouchableOpacity>

          {hasActiveOrders && (
            <Text style={styles.activeOrdersText}>
              {activeOrders.length} ta faol buyurtmangiz bor
            </Text>
          )}
        </View>
        {locationError && (
          <Text style={styles.locationError}>
            Lokatsiya xatosi: {locationError}
          </Text>
        )}
        {currentLocation && (
          <Text style={styles.locationStatus}>Lokatsiya aniqlandi ✓</Text>
        )}
        <Pressable
          style={styles.refreshButtonContainer}
          onPress={async () => {
            setLoading(true);
            // Avval aktiv orderlardi yangilash
            await fetchActiveOrders();
            // Keyin kutilayotgan orderlarni ham yangilash
            await fetchSearchCourierOrders();
            // Loading tugadi
            setLoading(false);
          }}
        >
          <Ionicons
            name="refresh"
            size={24}
            color="white"
            style={styles.refreshButton}
          />
          <Text style={styles.refreshButtonText}>Yangilash</Text>
        </Pressable>
      </View>

      <Text style={styles.header}>
        {hasActiveOrders
          ? `🚚 Yo'l ustidagi buyurtmalar (${
              orders?.length > 0 ? orders.length : 0
            })`
          : "Barcha kutilayotgan buyurtmalar"}
      </Text>

      <OrdersList />

      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8f9fa",
    paddingTop: Constants.statusBarHeight,
  },
  headerContainer: {
    backgroundColor: "#fff",
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#eaecef",
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  headerButtons: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  myOrdersButton: {
    backgroundColor: "#3498db",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  myOrdersButtonText: {
    color: "#fff",
    fontWeight: "600",
    marginLeft: 8,
  },
  activeOrdersText: {
    color: "#e74c3c",
    fontWeight: "600",
    marginLeft: 10,
    flex: 1,
    textAlign: "right",
  },
  locationStatus: {
    color: "#2ecc71",
    fontSize: 14,
    marginTop: 5,
    fontWeight: "500",
    flexDirection: "row",
    alignItems: "center",
  },
  locationError: {
    color: "#e74c3c",
    fontSize: 14,
    marginTop: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "#fef5f5",
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#fadbd8",
    overflow: "hidden",
  },
  header: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#2c3e50",
    marginHorizontal: 15,
    marginBottom: 15,
  },
  routeExplanationContainer: {
    backgroundColor: "#fff8ec",
    borderRadius: 12,
    padding: 15,
    marginHorizontal: 15,
    marginBottom: 20,
    borderLeftWidth: 4,
    borderLeftColor: "#ff9800",
    shadowColor: "#ff9800",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  routeExplanation: {
    fontSize: 15,
    fontWeight: "bold",
    color: "#333333",
    marginBottom: 8,
  },
  routeExplanationDetail: {
    fontSize: 14,
    color: "#555555",
    marginLeft: 6,
    marginBottom: 5,
    lineHeight: 20,
  },
  ordersList: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 100,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 100,
  },
  loadingText: {
    marginTop: 15,
    fontSize: 16,
    color: "#7f8c8d",
    textAlign: "center",
  },
  noOrders: {
    fontSize: 16,
    color: "#7f8c8d",
    textAlign: "center",
    marginTop: 30,
    padding: 20,
    lineHeight: 24,
  },
  orderCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    borderWidth: 1,
    borderColor: "#eaecef",
  },
  onRouteOrderCard: {
    borderLeftWidth: 5,
    borderLeftColor: "#3498db",
  },
  orderHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  priceContainer: {
    flex: 1,
  },
  orderPrice: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#2c3e50",
  },
  priceLabel: {
    fontSize: 13,
    color: "#7f8c8d",
    marginTop: 2,
  },
  restaurantContainer: {
    flex: 1.5,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  restaurantName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#2c3e50",
    marginLeft: 8,
    textAlign: "right",
  },
  orderDetails: {
    backgroundColor: "#f8f9fa",
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  lastDetailRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 0,
  },
  detailIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#ecf0f1",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  orderTotal: {
    fontSize: 15,
    color: "#2c3e50",
    fontWeight: "500",
  },
  distanceText: {
    fontSize: 15,
    color: "#2c3e50",
  },
  phoneText: {
    fontSize: 15,
    color: "#2c3e50",
  },
  acceptButton: {
    backgroundColor: "#2ecc71",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  acceptingButton: {
    backgroundColor: "#27ae60",
  },
  acceptButtonText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 16,
    marginLeft: 8,
  },
  routeBadge: {
    position: "absolute",
    top: 12,
    right: 12,
    backgroundColor: "#3498db",
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 20,
    flexDirection: "row",
    alignItems: "center",
  },
  routeBadgeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "bold",
    marginLeft: 4,
  },
  orderLoadingContainer: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 15,
    marginVertical: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    height: 100,
  },
  errorText: {
    color: "#e74c3c",
    textAlign: "center",
    marginVertical: 8,
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  retryButton: {
    backgroundColor: "#3498db",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    marginTop: 15,
    marginBottom: 15,
    width: "80%",
    elevation: 3,
    shadowColor: "#3498db",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  retryButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
    textAlign: "center",
  },
  settingsButton: {
    backgroundColor: "#f39c12",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    width: "80%",
    elevation: 3,
    shadowColor: "#f39c12",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  settingsButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
    textAlign: "center",
  },
  locationErrorIcon: {
    marginBottom: 15,
  },
  debugButton: {
    position: "absolute",
    top: Platform.OS === "ios" ? 50 : 15,
    right: 10,
    backgroundColor: "#f39c12",
    padding: 8,
    borderRadius: 5,
    zIndex: 999,
  },
  debugButtonText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "bold",
  },
  backButton: {
    backgroundColor: "#3498db",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    marginTop: 15,
    marginBottom: 10,
    width: "80%",
    elevation: 3,
    shadowColor: "#3498db",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  backButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
    textAlign: "center",
  },
  refreshButtonContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#3498db",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginTop: 15,
    marginBottom: 5,
    shadowColor: "#3498db",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  refreshButton: {
    marginRight: 8,
  },
  refreshButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
    textAlign: "center",
  },
  devButtonsContainer: {
    position: "absolute",
    bottom: 25,
    left: 15,
    right: 15,
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 5,
    backgroundColor: "rgba(0,0,0,0.1)",
    borderRadius: 8,
  },
  devButton: {
    padding: 10,
    borderRadius: 5,
    alignItems: "center",
    flex: 1,
    marginHorizontal: 2,
  },
  devButtonText: {
    color: "white",
    fontWeight: "bold",
    fontSize: 10,
  },
  devButtonSoundPlayer: {
    backgroundColor: "#3498db",
  },
  devButtonExpoAudio: {
    backgroundColor: "#9b59b6",
  },
  debugContainer: {
    marginTop: 10,
    padding: 10,
    backgroundColor: "#f0f0f0",
    borderRadius: 5,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  debugTitle: {
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 5,
    textAlign: "center",
  },
  debugButtonRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginVertical: 5,
  },
  debugButton: {
    flex: 1,
    backgroundColor: "#2196F3",
    padding: 8,
    margin: 5,
    borderRadius: 4,
    alignItems: "center",
  },
  debugButtonText: {
    color: "white",
    fontWeight: "bold",
  },
});

export default HomeScreen;
