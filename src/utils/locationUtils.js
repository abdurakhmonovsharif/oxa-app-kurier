// Lokatsiya bilan bog'liq funksiyalar
import { Platform, PermissionsAndroid, Alert } from "react-native";
import * as Location from "expo-location";

// Google Maps API key - buni .env fayliga qo'yish yaxshiroq, lekin hozir shunday qo'yamiz
const GOOGLE_MAPS_API_KEY = "AIzaSyD3-AHUP5HeIJSQrACtcyNNTNejRAZ2YOU"; // TODO: Haqiqiy API key bilan almashtirish kerak

// Function to calculate distance between two coordinates using Haversine formula
export const calculateDistance = (lat1, lon1, lat2, lon2) => {
  try {
    // Check for valid inputs - must be numbers and not null/undefined
    if (
      !lat1 ||
      !lon1 ||
      !lat2 ||
      !lon2 ||
      isNaN(lat1) ||
      isNaN(lon1) ||
      isNaN(lat2) ||
      isNaN(lon2)
    ) {
      return null;
    }

    // Convert string values to numbers if needed
    const latitude1 = typeof lat1 === "string" ? parseFloat(lat1) : lat1;
    const longitude1 = typeof lon1 === "string" ? parseFloat(lon1) : lon1;
    const latitude2 = typeof lat2 === "string" ? parseFloat(lat2) : lat2;
    const longitude2 = typeof lon2 === "string" ? parseFloat(lon2) : lon2;

    const R = 6371; // Radius of the earth in km
    const dLat = deg2rad(latitude2 - latitude1);
    const dLon = deg2rad(longitude2 - longitude1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(deg2rad(latitude1)) *
        Math.cos(deg2rad(latitude2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c; // Distance in km
    return distance.toFixed(1);
  } catch (error) {
    console.error("Error calculating distance:", error);
    return null;
  }
};

// Convert degrees to radians
export const deg2rad = (deg) => {
  try {
    if (deg === null || deg === undefined || isNaN(deg)) {
      return 0;
    }
    return deg * (Math.PI / 180);
  } catch (error) {
    console.error("Error converting degrees to radians:", error);
    return 0;
  }
};

// Check location permissions
export const checkLocationPermission = async () => {
  try {
    console.log("Checking location permission...");
    const { status: foregroundStatus } =
      await Location.requestForegroundPermissionsAsync();

    console.log("Location permission status:", foregroundStatus);

    if (foregroundStatus !== "granted") {
      console.log("Location permission denied");
      Alert.alert(
        "Lokatsiya ruxsati kerak",
        "Ilovadan to'liq foydalanish uchun lokatsiya ruxsatini bering"
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error checking location permission:", error);
    return false;
  }
};

// Get current location
export const getCurrentLocation = async () => {
  try {
    // First check if we have permission
    const hasPermission = await checkLocationPermission();

    if (!hasPermission) {
      throw new Error("Lokatsiya uchun ruxsat berilmagan");
    }

    console.log("Getting current location...");
    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 5000,
      distanceInterval: 100,
    });

    console.log("Location received:", location.coords);

    return {
      lat: location.coords.latitude,
      long: location.coords.longitude,
    };
  } catch (error) {
    console.error("Error getting current location:", error);
    throw error;
  }
};

/**
 * Ikki nuqta orasidagi yo'l (route) masofasini Google Maps API orqali hisoblaydi
 * @param {number} startLat - Boshlang'ich nuqta kenglik koordinatasi
 * @param {number} startLong - Boshlang'ich nuqta uzunlik koordinatasi
 * @param {number} endLat - Yakuniy nuqta kenglik koordinatasi
 * @param {number} endLong - Yakuniy nuqta uzunlik koordinatasi
 * @returns {Promise<number|null>} - Masofa kilometrlarda yoki null (xatolik bo'lsa)
 */
export const calculateRouteDistance = async (
  startLat,
  startLong,
  endLat,
  endLong
) => {
  if (!startLat || !startLong || !endLat || !endLong) {
    console.error("calculateRouteDistance: Invalid coordinates provided");
    return null;
  }

  // API keyi hali to'g'ri qo'yilmagan bo'lsa, to'g'ri chiziq masofasini hisoblaymiz
  if (GOOGLE_MAPS_API_KEY === "YOUR_GOOGLE_MAPS_API_KEY") {
    console.log(
      "No valid Google Maps API key, using straight-line distance instead"
    );
    return calculateDistance(startLat, startLong, endLat, endLong);
  }

  try {
    // Google Maps Direction API so'rovi
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/directions/json?origin=${startLat},${startLong}&destination=${endLat},${endLong}&mode=driving&key=${GOOGLE_MAPS_API_KEY}`
    );

    const data = await response.json();

    // Javobni tekshirish
    if (data.status !== "OK") {
      throw new Error(`Google Maps API Error: ${data.status}`);
    }

    // Masofani olish (metrlarda) va kilometrga aylantirish
    const distanceInMeters = data.routes[0].legs[0].distance.value;
    const distanceInKm = distanceInMeters / 1000;

    console.log(`Route distance from API: ${distanceInKm.toFixed(2)} km`);
    return parseFloat(distanceInKm.toFixed(2));
  } catch (error) {
    console.error("Error calculating route distance:", error);

    // API xatolik bo'lganda to'g'ri chiziq masofasiga qaytamiz
    console.log("Falling back to straight-line distance calculation");
    return calculateDistance(startLat, startLong, endLat, endLong);
  }
};

// Fallback funksiya: Agar route API ishlamasa yoki API key yo'q bo'lsa
// (telefonning offline holatida ham ishlaydi)
export const getDistanceBetweenPoints = async (
  startLat,
  startLong,
  endLat,
  endLong,
  useRouteIfPossible = true
) => {
  // API xatolik bo'lishi sababli, hozircha faqat to'g'ri chiziq masofasini hisoblaymiz
  // Keyinchalik API keyi to'g'ri qo'yilganda, bu qatorni o'zgartirish mumkin bo'ladi
  return calculateDistance(startLat, startLong, endLat, endLong);

  // Quyidagi kod vaqtincha o'chirildi (API key muammosi tuzatilganda qayta yoqiladi)
  /*
  // API keyi hali to'g'ri qo'yilmagan bo'lsa, to'g'ri chiziq masofasini hisoblaymiz
  if (
    GOOGLE_MAPS_API_KEY === "YOUR_GOOGLE_MAPS_API_KEY" ||
    !useRouteIfPossible
  ) {
    return calculateDistance(startLat, startLong, endLat, endLong);
  }

  try {
    const routeDistance = await calculateRouteDistance(
      startLat,
      startLong,
      endLat,
      endLong
    );
    if (routeDistance !== null) {
      return routeDistance;
    }
  } catch (error) {
    console.error(
      "Route calculation failed, using straight line distance instead:",
      error
    );
  }

  // Fallback to straight line calculation
  return calculateDistance(startLat, startLong, endLat, endLong);
  */
};
