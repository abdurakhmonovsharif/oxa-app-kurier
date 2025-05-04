import React, { useEffect, useState, useRef } from "react";
import {
  Alert,
  StyleSheet,
  Text,
  View,
  FlatList,
  ActivityIndicator,
  Pressable,
  Linking,
  Platform,
  BackHandler,
  Modal,
  Image,
  ScrollView,
  TouchableOpacity,
  Dimensions,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Firebase imports using modular API
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  getDoc,
  limit,
  runTransaction,
  updateDoc,
} from "@react-native-firebase/firestore";
import firestore from "@react-native-firebase/firestore";

import { Ionicons } from "@expo/vector-icons";
import { calculateDistance } from "../utils/locationUtils";

function OrdersScreen({ route, navigation }) {
  const { acceptedOrderId, phoneNumber, preloadOrders, isNewlyAccepted } =
    route.params || {};
  const [orders, setOrders] = useState(preloadOrders || []);
  const [loading, setLoading] = useState(true);
  const [restaurants, setRestaurants] = useState({});
  const [restaurantLocations, setRestaurantLocations] = useState({});
  const [activeOrdersCount, setActiveOrdersCount] = useState(
    preloadOrders?.length || 0
  );
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [currentRestaurantId, setCurrentRestaurantId] = useState(null);
  const [courierPhone, setCourierPhone] = useState(phoneNumber || null);
  const [currentOrder, setCurrentOrder] = useState(null);
  const [productDetails, setProductDetails] = useState([]);
  const [cancelableOrders, setCancelableOrders] = useState({});
  const [cancelCountdowns, setCancelCountdowns] = useState({});
  // Add navigation ref to prevent multiple navigation attempts
  const navigationInProgress = useRef(false);
  let unsubscribeFunction = null;
  // Create a ref to store interval IDs for cleanup
  const intervalRefs = useRef({});

  console.log("OrdersScreen rendered with phoneNumber:", phoneNumber);
  console.log("Preloaded orders:", preloadOrders?.length || 0);

  // Function to open maps app with location
  const openMapsWithLocation = (location) => {
    if (!location || !location.lat || !location.long) {
      Alert.alert("Xatolik", "Joylashuv ma'lumotlari mavjud emas");
      return;
    }

    const { lat, long } = location;
    const label = "Manzil";
    const latLng = `${lat},${long}`;

    // Tizimning standart tanlash oynasini ishlatamiz, rasmda ko'rsatilgandek
    // Universal URL yaratib barcha map ilovalar undan foydalana oladi
    const url = Platform.select({
      ios: `http://maps.apple.com/?q=${label}&ll=${lat},${long}`,
      android: `geo:${lat},${long}?q=${lat},${long}(${label})`,
    });

    // Android/iOS tizimlarida mavjud ilovalar ro'yxatidan tanlash imkoniyatini beradi
    Linking.openURL(url).catch((err) => {
      console.error("Xaritani ochishda xatolik:", err);

      // Agar xatolik bo'lsa, Google Maps'ni brauzerda ochishga harakat qilamiz
      const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${long}`;
      Linking.openURL(googleMapsUrl).catch((err) => {
        Alert.alert("Xatolik", "Xaritani ochib bo'lmadi");
      });
    });
  };

  // Function to fetch restaurant names and locations
  const fetchRestaurantData = async (orderList) => {
    try {
      // Extract restaurant IDs from orders
      const restaurantIds = orderList
        .map((order) => order.restaurantId)
        .filter(Boolean);

      if (restaurantIds.length === 0) {
        console.log("No restaurant IDs found in orders");
        return;
      }

      console.log("Fetching data for restaurants:", restaurantIds);

      const uniqueIds = [...new Set(restaurantIds)];
      const restaurantData = {};
      const locationData = {};

      await Promise.all(
        uniqueIds.map(async (id) => {
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
                if (data?.location) {
                  locationData[id] = data.location;
                }
              } else {
                restaurantData[id] = "Noma'lum restoran";
              }
            } catch (error) {
              console.error(`Error fetching restaurant ${id}:`, error);
              restaurantData[id] = "Xatolik yuz berdi";
            }
          }
        })
      );

      console.log(
        "Restaurant data fetched:",
        Object.keys(restaurantData).length
      );
      setRestaurants(restaurantData);
      setRestaurantLocations(locationData);
    } catch (error) {
      console.error("Error fetching restaurant data in OrdersScreen:", error);
    }
  };

  // Function to fetch product details from restaurant menu
  const fetchProductDetails = async (restaurantId, products) => {
    if (!restaurantId || !products || products.length === 0) {
      Alert.alert("Xatolik", "Mahsulotlar ma'lumotlari mavjud emas");
      return [];
    }

    try {
      setLoadingProducts(true);

      // Get restaurant document with menu
      const restaurantDoc = await firestore()
        .collection("restaurants")
        .doc(restaurantId)
        .get();

      if (!restaurantDoc.exists) {
        throw new Error("Restoran ma'lumotlari topilmadi");
      }

      const restaurantData = restaurantDoc.data();
      const menuItems = restaurantData.menu || [];

      if (!menuItems.length) {
        throw new Error("Restoran menyusi bo'sh");
      }

      // Match products with menu items and include counts
      const productsWithDetails = products.map((product) => {
        const menuItem = menuItems.find((item) => item.id === product.id);

        return {
          ...product,
          details: menuItem || { title: "Noma'lum mahsulot", price: 0 },
        };
      });

      return productsWithDetails;
    } catch (error) {
      console.error("Error fetching product details:", error);
      Alert.alert(
        "Xatolik",
        error.message || "Mahsulotlar ma'lumotlarini yuklab bo'lmadi"
      );
      return [];
    } finally {
      setLoadingProducts(false);
    }
  };

  // Function to show products modal
  const showProductsModal = async (item) => {
    if (
      !item ||
      !item.restaurantId ||
      !item.products ||
      item.products.length === 0
    ) {
      Alert.alert("Xatolik", "Mahsulotlar ma'lumotlari mavjud emas");
      return;
    }

    setCurrentRestaurantId(item.restaurantId);
    setModalVisible(true);

    const productsWithDetails = await fetchProductDetails(
      item.restaurantId,
      item.products
    );
    setSelectedProducts(productsWithDetails);
  };

  // Render a product item in the modal
  const renderProductItem = ({ item }) => {
    const { count, details } = item;
    const { title, price, img, category } = details;

    // Calculate total price for this product (count * price)
    const totalPrice = count * (price || 0);

    return (
      <View style={styles.productItem}>
        {img ? (
          <Image
            source={{ uri: img }}
            style={styles.productImage}
            // Use a color placeholder instead of requiring an image
            defaultSource={{
              uri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAEDQIHgYJTcwAAAABJRU5ErkJggg==",
            }}
          />
        ) : (
          <View style={styles.productImagePlaceholder}>
            <Text style={{ color: "#999", fontSize: 12 }}>Rasm yo'q</Text>
          </View>
        )}

        <View style={styles.productInfo}>
          <Text style={styles.productTitle}>
            {title || "Noma'lum mahsulot"}
          </Text>
          <Text style={styles.productPrice}>
            {category || "Noma'lum kategoriya"}
          </Text>
          <View style={styles.countContainer}>
            <Text style={styles.countText}>Soni: {count}</Text>
          </View>
        </View>
        <View style={styles.productTotalPriceContainer}>
          <Text style={styles.productTotalPrice}>
            {totalPrice.toLocaleString()} so'm
          </Text>
        </View>
      </View>
    );
  };

  // Products modal component
  const ProductsModal = () => {
    // Calculate total sum of all products
    const totalOrderSum = selectedProducts.reduce((sum, product) => {
      const price = product.details?.price || 0;
      return sum + price * product.count;
    }, 0);

    return (
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => {
          setModalVisible(false);
        }}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Buyurtma mahsulotlari</Text>

            {loadingProducts ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#3498db" />
                <Text style={styles.loadingText}>
                  Mahsulotlar yuklanmoqda...
                </Text>
              </View>
            ) : selectedProducts.length > 0 ? (
              <FlatList
                data={selectedProducts}
                renderItem={renderProductItem}
                keyExtractor={(item, index) => `product-${index}-${item.id}`}
                contentContainerStyle={styles.productsList}
                showsVerticalScrollIndicator={false}
              />
            ) : (
              <Text style={styles.noProducts}>Mahsulotlar mavjud emas</Text>
            )}

            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setModalVisible(false)}
              activeOpacity={0.8}
            >
              <Text style={styles.closeButtonText}>Yopish</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  };

  // Function to clear all intervals on unmount
  const clearAllIntervals = () => {
    Object.values(intervalRefs.current).forEach((id) => {
      clearInterval(id);
    });
    intervalRefs.current = {};
  };

  // Cleanup function for component unmount
  useEffect(() => {
    return () => {
      clearAllIntervals();
    };
  }, []);

  // Effect to load orders
  useEffect(() => {
    let isComponentMounted = true;

    // Function to fetch courier's orders
    const fetchCourierOrders = async (courierPhoneNumber) => {
      try {
        if (!courierPhoneNumber) {
          console.error("No courier phone number provided");
          return;
        }

        console.log(
          "Fetching orders for courier with phone number:",
          courierPhoneNumber
        );

        // Listen for real-time order updates for the specific courier
        const unsubscribe = firestore()
          .collection("orders")
          .where("courier", "==", courierPhoneNumber)
          .where("status", "in", ["courier", "delivering"])
          .onSnapshot(
            (querySnapshot) => {
              if (!isComponentMounted) return;

              console.log(
                `Received ${querySnapshot.size} courier orders from Firestore`
              );

              const ordersList = [];
              const newCancelableOrders = { ...cancelableOrders };
              const newCancelCountdowns = { ...cancelCountdowns };

              // Clear old intervals that might be running
              clearAllIntervals();

              querySnapshot.forEach((documentSnapshot) => {
                const orderData = {
                  id: documentSnapshot.id,
                  ...documentSnapshot.data(),
                };

                // Check if this is a newly accepted order and set up timer for cancellation
                if (orderData.acceptedAt && !cancelableOrders[orderData.id]) {
                  const acceptedTime = orderData.acceptedAt.toDate();
                  const currentTime = new Date();
                  const secondsSinceAccepted = Math.floor(
                    (currentTime - acceptedTime) / 1000
                  );

                  // If order was accepted less than 30 seconds ago, allow cancellation
                  if (secondsSinceAccepted < 30) {
                    const remainingSeconds = 30 - secondsSinceAccepted;
                    newCancelableOrders[orderData.id] = true;
                    newCancelCountdowns[orderData.id] = remainingSeconds;

                    // Create a new interval for this order
                    const orderId = orderData.id;
                    const intervalId = setInterval(() => {
                      setCancelCountdowns((prev) => {
                        // If this order is no longer in the countdown state, clear the interval
                        if (!prev[orderId]) {
                          clearInterval(intervalId);
                          delete intervalRefs.current[orderId];
                          return prev;
                        }

                        const newCount = prev[orderId] - 1;

                        // When countdown reaches zero
                        if (newCount <= 0) {
                          clearInterval(intervalId);
                          delete intervalRefs.current[orderId];

                          // Remove from cancelable orders
                          setCancelableOrders((prevCancelable) => {
                            const updated = { ...prevCancelable };
                            delete updated[orderId];
                            return updated;
                          });

                          // Remove from countdown state
                          const updatedCountdowns = { ...prev };
                          delete updatedCountdowns[orderId];
                          return updatedCountdowns;
                        }

                        // Update countdown value
                        return {
                          ...prev,
                          [orderId]: newCount,
                        };
                      });
                    }, 1000);

                    // Store the interval ID for cleanup
                    intervalRefs.current[orderId] = intervalId;
                  }
                }

                ordersList.push(orderData);
              });

              setCancelableOrders(newCancelableOrders);
              setCancelCountdowns(newCancelCountdowns);
              setOrders(ordersList);
              setActiveOrdersCount(ordersList.length);
              setLoading(false);

              // If we have orders, fetch restaurant data
              if (ordersList.length > 0) {
                fetchRestaurantData(ordersList);
              }
            },
            (error) => {
              console.error("Error getting courier orders:", error);
              if (isComponentMounted) {
                setLoading(false);
              }
            }
          );

        return () => {
          unsubscribe();
          clearAllIntervals();
        };
      } catch (error) {
        console.error("Error in fetchCourierOrders:", error);
        if (isComponentMounted) {
          setLoading(false);
        }
        return null;
      }
    };

    // Get stored phone number if it wasn't passed in route params
    const getStoredPhoneNumber = async () => {
      if (!phoneNumber) {
        try {
          const storedPhoneNumber = await AsyncStorage.getItem(
            "courierPhoneNumber"
          );

          if (!storedPhoneNumber) {
            console.log("No stored phone number found, redirecting to login");
            navigation.replace("Login");
            return null;
          }

          console.log("Retrieved stored phone number:", storedPhoneNumber);
          setCourierPhone(storedPhoneNumber);
          return storedPhoneNumber;
        } catch (error) {
          console.error("Error getting stored phone number:", error);
          return null;
        }
      }
      return phoneNumber;
    };

    // Handle hardware back button
    const backHandler = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        // Show confirmation dialog before leaving orders screen
        if (navigationInProgress.current) return true;

        Alert.alert(
          "Chiqishni tasdiqlang",
          "Haqiqatan ham buyurtmalar sahifasidan chiqmoqchimisiz?",
          [
            {
              text: "Yo'q",
              onPress: () => null,
              style: "cancel",
            },
            {
              text: "Ha",
              onPress: () => {
                if (!navigationInProgress.current) {
                  navigationInProgress.current = true;

                  // Clean up firestore listeners first
                  if (
                    unsubscribeFunction &&
                    typeof unsubscribeFunction === "function"
                  ) {
                    unsubscribeFunction();
                    unsubscribeFunction = null;
                  }

                  // Use setTimeout to ensure all cleanup is done
                  setTimeout(() => {
                    navigation.navigate("Home");
                    navigationInProgress.current = false;
                  }, 50);
                }
              },
            },
          ],
          { cancelable: false }
        );
        return true; // Prevent default back button behavior
      }
    );

    // Add navigation focus listener to properly handle the screen coming into focus
    const unsubscribeFocus = navigation.addListener("focus", async () => {
      console.log("OrdersScreen focused");

      // Only reset orders if we don't have preloaded orders or if not a newly accepted order
      if (!isNewlyAccepted || !preloadOrders) {
        // Initialize empty orders array immediately to prevent errors
        setOrders([]);
      }

      // Get phone number and refresh data
      const currentPhone = await getStoredPhoneNumber();
      console.log("Using phone number for orders:", currentPhone);

      if (currentPhone) {
        const unsubFunc = await fetchCourierOrders(currentPhone);
        if (typeof unsubFunc === "function") {
          unsubscribeFunction = unsubFunc;
        }
      }
    });

    // Initial fetch when component mounts
    getStoredPhoneNumber().then((phone) => {
      if (phone) {
        fetchCourierOrders(phone).then((unsubFunc) => {
          if (typeof unsubFunc === "function") {
            unsubscribeFunction = unsubFunc;
          }
        });
      }
    });

    // Clean up resources on component unmount
    return () => {
      // Mark component as unmounted to prevent state updates
      isComponentMounted = false;

      // Clean up Firestore listener
      if (unsubscribeFunction && typeof unsubscribeFunction === "function") {
        unsubscribeFunction();
        unsubscribeFunction = null;
      }

      // Cleanup the navigation focus listener
      if (unsubscribeFocus) {
        unsubscribeFocus();
      }

      // Remove hardware back button listener
      backHandler.remove();

      // Reset navigation flag
      navigationInProgress.current = false;
    };
  }, [navigation, phoneNumber, preloadOrders, isNewlyAccepted]);

  // Effect to handle newly accepted orders
  useEffect(() => {
    if (isNewlyAccepted && acceptedOrderId) {
      console.log(
        `Setting up countdown for newly accepted order ${acceptedOrderId}`
      );

      // Set this newly accepted order as cancelable
      setCancelableOrders((prev) => ({
        ...prev,
        [acceptedOrderId]: true,
      }));

      // Initialize countdown at 30 seconds
      setCancelCountdowns((prev) => ({
        ...prev,
        [acceptedOrderId]: 30,
      }));

      // Create interval for countdown
      const intervalId = setInterval(() => {
        setCancelCountdowns((prev) => {
          // If this order is no longer in the countdown state, clear the interval
          if (!prev[acceptedOrderId]) {
            clearInterval(intervalId);
            delete intervalRefs.current[acceptedOrderId];
            return prev;
          }

          const newCount = prev[acceptedOrderId] - 1;

          // When countdown reaches zero
          if (newCount <= 0) {
            clearInterval(intervalId);
            delete intervalRefs.current[acceptedOrderId];

            // Remove from cancelable orders
            setCancelableOrders((prevCancelable) => {
              const updated = { ...prevCancelable };
              delete updated[acceptedOrderId];
              return updated;
            });

            // Remove from countdown state
            const updatedCountdowns = { ...prev };
            delete updatedCountdowns[acceptedOrderId];
            return updatedCountdowns;
          }

          // Update countdown value
          return {
            ...prev,
            [acceptedOrderId]: newCount,
          };
        });
      }, 1000);

      // Store the interval ID for cleanup
      intervalRefs.current[acceptedOrderId] = intervalId;

      // Cleanup interval when component unmounts
      return () => {
        clearInterval(intervalId);
        delete intervalRefs.current[acceptedOrderId];
      };
    }
  }, [isNewlyAccepted, acceptedOrderId]);

  // Buyurtma bajarildi funksiyasini Orders Screen componentiga qo'shamiz
  // Buyurtmani bajarilgan deb belgilash funksiyasi
  const markOrderAsDelivered = async (orderId) => {
    try {
      // Avval foydalanuvchidan tasdiqlashni so'raymiz
      Alert.alert(
        "Buyurtmani bajarish",
        "Buyurtma bajarilganini tasdiqlaysizmi?",
        [
          {
            text: "Yo'q",
            style: "cancel",
          },
          {
            text: "Ha, bajarildi",
            style: "default",
            onPress: async () => {
              try {
                // Firestore'da buyurtma statusini o'zgartiramiz
                await firestore().runTransaction(async (transaction) => {
                  // Buyurtmani olish
                  const orderDoc = await transaction.get(
                    firestore().collection("orders").doc(orderId)
                  );

                  if (!orderDoc.exists) {
                    throw new Error("Buyurtma topilmadi");
                  }

                  // Buyurtma statusini "delivered" ga o'zgartiramiz
                  transaction.update(
                    firestore().collection("orders").doc(orderId),
                    {
                      status: "delivered", // Bajarilgan deb belgilash
                    }
                  );
                });

                Alert.alert(
                  "Muvaffaqiyatli",
                  "Buyurtma bajarilgan deb belgilandi"
                );
              } catch (error) {
                console.error(
                  "Buyurtmani bajarilgan deb belgilashda xatolik:",
                  error
                );
                Alert.alert(
                  "Xatolik",
                  "Buyurtmani bajarilgan deb belgilashda xatolik yuz berdi"
                );
              }
            },
          },
        ]
      );
    } catch (error) {
      console.error("Buyurtmani bajarilgan deb belgilashda xatolik:", error);
      Alert.alert("Xatolik", "Amaliyotda xatolik yuz berdi");
    }
  };

  // Buyurtmani bekor qilish funksiyasi
  const cancelOrder = async (orderId) => {
    try {
      // Avval foydalanuvchidan tasdiqlashni so'raymiz
      Alert.alert(
        "Buyurtmani bekor qilish",
        "Haqiqatan ham bu buyurtmani bekor qilmoqchimisiz?",
        [
          {
            text: "Yo'q",
            style: "cancel",
          },
          {
            text: "Ha, bekor qilish",
            style: "destructive",
            onPress: async () => {
              try {
                // Firestore'da buyurtma statusini o'zgartiramiz
                await firestore().runTransaction(async (transaction) => {
                  // Buyurtmani olish
                  const orderDoc = await transaction.get(
                    firestore().collection("orders").doc(orderId)
                  );

                  if (!orderDoc.exists) {
                    throw new Error("Buyurtma topilmadi");
                  }

                  // Buyurtmani qayta "search_courier" statusiga o'tkazamiz va courier maydonini bo'sh qilamiz
                  transaction.update(
                    firestore().collection("orders").doc(orderId),
                    {
                      status: "search_courier", // Qayta qidiruv statusiga o'tkazish
                      courier: "", // Kuryer maydonini bo'shatish
                      acceptedAt: null, // Qabul qilingan vaqtni o'chiramiz
                    }
                  );
                });

                Alert.alert("Muvaffaqiyatli", "Buyurtma bekor qilindi");
              } catch (error) {
                console.error("Buyurtmani bekor qilishda xatolik:", error);
                Alert.alert(
                  "Xatolik",
                  "Buyurtmani bekor qilishda xatolik yuz berdi"
                );
              }
            },
          },
        ]
      );
    } catch (error) {
      console.error("Bekor qilishda xatolik:", error);
      Alert.alert("Xatolik", "Amaliyotda xatolik yuz berdi");
    }
  };

  // Buyurtmani delivering statusiga o'tkazish funksiyasi
  const startDelivering = async (orderId) => {
    try {
      // Avval foydalanuvchidan tasdiqlashni so'raymiz
      Alert.alert(
        "Buyurtmani yetkazishni boshlash",
        "Buyurtmani yetkazishni boshlaysizmi?",
        [
          {
            text: "Yo'q",
            style: "cancel",
          },
          {
            text: "Ha, boshlash",
            style: "default",
            onPress: async () => {
              try {
                // Firestore'da buyurtma statusini o'zgartiramiz
                await firestore().runTransaction(async (transaction) => {
                  // Buyurtmani olish
                  const orderDoc = await transaction.get(
                    firestore().collection("orders").doc(orderId)
                  );

                  if (!orderDoc.exists) {
                    throw new Error("Buyurtma topilmadi");
                  }

                  // Buyurtma statusini "delivering" ga o'zgartiramiz
                  transaction.update(
                    firestore().collection("orders").doc(orderId),
                    {
                      status: "delivering", // Yetkazish jarayonidagi status
                    }
                  );
                });

                Alert.alert(
                  "Muvaffaqiyatli",
                  "Buyurtma yetkazish jarayoniga o'tkazildi"
                );
              } catch (error) {
                console.error(
                  "Buyurtma statusini o'zgartirishda xatolik:",
                  error
                );
                Alert.alert(
                  "Xatolik",
                  "Buyurtma statusini o'zgartirishda xatolik yuz berdi"
                );
              }
            },
          },
        ]
      );
    } catch (error) {
      console.error("Buyurtma statusini o'zgartirishda xatolik:", error);
      Alert.alert("Xatolik", "Amaliyotda xatolik yuz berdi");
    }
  };

  const renderOrderItem = ({ item, index }) => {
    // Add index check to prevent out of bounds errors
    if (!item || index >= orders.length) {
      console.warn(
        `Attempted to render invalid item at index ${index}. Orders length: ${orders.length}`
      );
      return null;
    }

    // Calculate distance between restaurant and delivery location
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

    // Check if this is a newly accepted order
    const isNewlyAcceptedOrder = acceptedOrderId === item.id;

    // Calculate how long ago the order was created
    const orderTime = item.acceptedAt
      ? new Date(item.acceptedAt.toDate())
      : new Date();
    const currentTime = new Date();
    const minutesAgo = Math.floor((currentTime - orderTime) / (1000 * 60));
    const timeText =
      minutesAgo <= 0 ? "Hozirgina" : `${minutesAgo} daqiqa oldin`;

    return (
      <View style={styles.orderCard}>
        {isNewlyAcceptedOrder && (
          <View style={[styles.statusBadge, styles.statusBadgeNew]}>
            <Ionicons name="checkmark-circle" size={14} color="#fff" />
            <Text style={styles.statusBadgeText}>Yangi</Text>
          </View>
        )}

        {/* Status badge for different order statuses */}
        {item.status === "delivering" && (
          <View style={[styles.statusBadge, styles.statusBadgeDelivering]}>
            <Ionicons name="bicycle" size={14} color="#fff" />
            <Text style={styles.statusBadgeText}>Yetkazilmoqda</Text>
          </View>
        )}

        <Text style={styles.orderRestaurantTitle}>
          {restaurants[item.restaurantId] || "Restoran"}
        </Text>

        <Text style={styles.deliveryTimeText}>{timeText}</Text>

        <View style={styles.detailsContainer}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              marginBottom: 10,
            }}
          >
            <Ionicons
              name="cash-outline"
              size={20}
              color="#2ecc71"
              style={{ marginRight: 8 }}
            />
            <Text style={[styles.orderTitle, { marginBottom: 0 }]}>
              {item.deliveryPrice || 0} so'm
            </Text>
          </View>

          <View style={{ position: "relative" }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                marginLeft: 20,
              }}
            >
              <Ionicons
                name="basket-outline"
                size={18}
                color="#3498db"
                style={styles.detailIcon}
              />
              <Text style={styles.orderDetail}>
                Buyurtma:{" "}
                {(item.price || 0) + (item.servicePrice || 0) ||
                  "Ma'lumot yo'q"}{" "}
                so'm
              </Text>
            </View>

            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                marginLeft: 20,
              }}
            >
              <Ionicons
                name="navigate-outline"
                size={18}
                color="#e74c3c"
                style={styles.detailIcon}
              />
              <Text style={styles.orderDetail}>
                Masofa: {distance ? `${distance} km` : "Ma'lumot yo'q"}
              </Text>
            </View>

            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                marginLeft: 20,
              }}
            >
              <Ionicons
                name="call-outline"
                size={18}
                color="#9b59b6"
                style={styles.detailIcon}
              />
              <Text style={styles.orderDetail}>
                Mijoz: +998{item.phoneNumber || "Ma'lumot yo'q"}
              </Text>
            </View>

            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                marginLeft: 20,
              }}
            >
              <Ionicons
                name="cash-outline"
                size={18}
                color="#2ecc71"
                style={styles.detailIcon}
              />
              <Text style={styles.orderDetail}>
                Umumiy narx:{" "}
                {item.price + item.servicePrice + item.deliveryPrice ||
                  "Ma'lumot yo'q"}{" "}
                so'm
              </Text>
            </View>
          </View>
        </View>

        {cancelableOrders[item.id] && (
          <Pressable
            style={[
              styles.orderButton,
              styles.cancelButton,
              styles.fullWidthButton,
            ]}
            onPress={() => cancelOrder(item.id)}
          >
            <Ionicons name="close-outline" size={20} color="#fff" />
            <Text style={styles.orderButtonText}>
              Bekor qilish (
              <Text style={styles.countdownText}>
                {cancelCountdowns[item.id] || 30}
              </Text>{" "}
              s)
            </Text>
          </Pressable>
        )}

        <View style={styles.orderButtons}>
          <Pressable
            style={[
              styles.orderButton,
              styles.locationButton,
              { width: item.status === "delivering" ? "48.5%" : "100%" },
            ]}
            onPress={() => {
              if (restaurantLocations[item.restaurantId]) {
                openMapsWithLocation(restaurantLocations[item.restaurantId]);
              } else {
                Alert.alert("Xatolik", "Restoran joylashuvi mavjud emas");
              }
            }}
          >
            <Ionicons name="restaurant-outline" size={20} color="#fff" />
            <Text style={styles.orderButtonText}>Restoran</Text>
          </Pressable>

          {item.status === "delivering" && (
            <Pressable
              style={[
                styles.orderButton,
                styles.locationButton,
                { width: "48.5%" },
              ]}
              onPress={() => {
                if (item.location && item.location.lat && item.location.long) {
                  openMapsWithLocation(item.location);
                } else {
                  Alert.alert("Xatolik", "Mijoz joylashuvi mavjud emas");
                }
              }}
            >
              <Ionicons name="location-outline" size={20} color="#fff" />
              <Text style={styles.orderButtonText}>Manzil</Text>
            </Pressable>
          )}
        </View>

        <Pressable
          style={[
            styles.orderButton,
            styles.locationButton,
            { backgroundColor: "#2ecc71", marginTop: 5 },
          ]}
          onPress={() => {
            if (item.phoneNumber) {
              Linking.openURL(`tel:+998${item.phoneNumber}`);
            } else {
              Alert.alert("Xatolik", "Mijoz telefon raqami mavjud emas");
            }
          }}
        >
          <Ionicons name="call" size={18} color="#fff" />
          <Text style={styles.orderButtonText}>Mijoz bilan bog'lanish</Text>
        </Pressable>

        <View style={styles.orderButtonRow}>
          <Pressable
            style={[styles.orderButton, styles.productsButton]}
            onPress={() => showProductsModal(item)}
          >
            <Ionicons name="list-outline" size={20} color="#fff" />
            <Text style={styles.orderButtonText}>Mahsulotlar</Text>
          </Pressable>

          {item.status === "courier" ? (
            <Pressable
              style={[styles.orderButton, styles.deliveringButton]}
              onPress={() => startDelivering(item.id)}
            >
              <Ionicons name="bicycle-outline" size={20} color="#fff" />
              <Text style={styles.orderButtonText}>Yetkazishni boshlash</Text>
            </Pressable>
          ) : item.status === "delivering" ? (
            <Pressable
              style={[styles.orderButton, styles.deliveredButton]}
              onPress={() => markOrderAsDelivered(item.id)}
            >
              <Ionicons
                name="checkmark-circle-outline"
                size={20}
                color="#fff"
              />
              <Text style={styles.orderButtonText}>Bajarildi</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Products Modal */}
      <ProductsModal />

      <Text style={styles.header}>Buyurtmalarim</Text>

      <Text style={styles.headerSubtext}>
        {orders && orders.length > 0
          ? `Sizda ${orders.length} ta faol buyurtma mavjud`
          : "Hozirda faol buyurtmalar yo'q"}
      </Text>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#3498db" />
          <Text style={styles.loadingText}>Buyurtmalar yuklanmoqda...</Text>
        </View>
      ) : orders && orders.length > 0 ? (
        <FlatList
          key={`orders-list-${orders.length}`}
          data={orders}
          renderItem={renderOrderItem}
          keyExtractor={(item, index) => item?.id || `order-${index}`}
          contentContainerStyle={styles.ordersList}
          initialNumToRender={2}
          maxToRenderPerBatch={3}
          windowSize={5}
          extraData={{ orders, activeOrdersCount }}
          removeClippedSubviews={false}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={() => (
            <Text style={styles.noOrders}>
              Sizda hozirda faol buyurtmalar yo'q
            </Text>
          )}
        />
      ) : (
        <Text style={styles.noOrders}>Sizda hozirda faol buyurtmalar yo'q</Text>
      )}

      {/* "Yangi buyurtmalar" tugmasi - faqat 3 tadan kam buyurtma bo'lsagina ko'rsatiladi */}
      {activeOrdersCount < 3 && (
        <Pressable
          style={styles.backButton}
          onPress={async () => {
            try {
              // Prevent multiple navigation attempts
              if (navigationInProgress.current) return;
              navigationInProgress.current = true;

              // Ensure we have valid phone number
              const phoneNum =
                courierPhone ||
                phoneNumber ||
                (await AsyncStorage.getItem("courierPhoneNumber"));

              if (!phoneNum) {
                navigation.replace("Login");
                navigationInProgress.current = false;
                return;
              }

              // Clean up listeners before navigation
              if (typeof unsubscribeFunction === "function") {
                unsubscribeFunction();
                unsubscribeFunction = null;
              }

              // Use setTimeout to allow cleanup to complete
              setTimeout(() => {
                navigation.replace("Home", { phoneNumber: phoneNum });
                navigationInProgress.current = false;
              }, 50);
            } catch (error) {
              console.error("Error navigating to Home screen:", error);
              Alert.alert(
                "Xatolik",
                "Bosh sahifaga o'tishda xatolik yuz berdi"
              );
              navigationInProgress.current = false;
            }
          }}
        >
          <Ionicons name="add-circle-outline" size={22} color="#fff" />
          <Text style={styles.backButtonText}>Yangi buyurtmalar</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f6f9fe",
    paddingTop: Platform.OS === "ios" ? 50 : 15,
  },
  header: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 15,
    color: "#2c3e50",
    textAlign: "center",
    marginTop: 10,
  },
  headerSubtext: {
    fontSize: 14,
    color: "#7f8c8d",
    textAlign: "center",
    marginBottom: 15,
  },
  ordersList: {
    paddingHorizontal: 15,
    paddingBottom: 20,
  },
  orderCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    marginBottom: 15,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
    borderWidth: 0,
  },
  orderTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 15,
    color: "#2c3e50",
  },
  orderDetail: {
    fontSize: 15,
    marginBottom: 10,
    color: "#34495e",
    paddingLeft: 28,
    position: "relative",
    alignItems: "center",
  },
  detailIcon: {
    position: "absolute",
    left: 0,
    top: 1,
  },
  detailsContainer: {
    backgroundColor: "#f8f9fa",
    borderRadius: 12,
    padding: 15,
    marginBottom: 15,
  },
  noOrders: {
    fontSize: 16,
    color: "#7f8c8d",
    textAlign: "center",
    marginTop: 30,
    padding: 20,
  },
  orderButtons: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 15,
    marginBottom: 5,
    gap: 10,
  },
  orderButtonRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 10,
    gap: 10,
  },
  orderButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  locationButton: {
    backgroundColor: "#3498db",
    paddingHorizontal: 15,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  productsButton: {
    backgroundColor: "#f39c12",
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  deliveredButton: {
    backgroundColor: "#2ecc71",
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  cancelButton: {
    backgroundColor: "#e74c3c",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  orderButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
  },
  backButton: {
    backgroundColor: "#3498db",
    paddingVertical: 15,
    borderRadius: 12,
    marginVertical: 20,
    marginHorizontal: 15,
    shadowColor: "#3498db",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  backButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
    textAlign: "center",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 30,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: "#7f8c8d",
  },
  // Modal styles
  modalContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    padding: 20,
  },
  modalContent: {
    backgroundColor: "white",
    borderRadius: 16,
    padding: 20,
    width: "100%",
    maxHeight: "85%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 8,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 20,
    textAlign: "center",
    color: "#2c3e50",
  },
  productsList: {
    padding: 5,
  },
  productItem: {
    flexDirection: "row",
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
    alignItems: "center",
    marginBottom: 5,
  },
  productImage: {
    width: 65,
    height: 65,
    borderRadius: 8,
    marginRight: 12,
    backgroundColor: "#f5f5f5",
  },
  productImagePlaceholder: {
    width: 65,
    height: 65,
    borderRadius: 8,
    backgroundColor: "#f5f5f5",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  productInfo: {
    flex: 1,
  },
  productTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#2c3e50",
    marginBottom: 2,
  },
  productPrice: {
    fontSize: 14,
    color: "#7f8c8d",
    marginBottom: 8,
  },
  countContainer: {
    backgroundColor: "#f5f7fa",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "#e6eaf0",
  },
  countText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#34495e",
  },
  productTotalPriceContainer: {
    alignItems: "flex-end",
    minWidth: 85,
  },
  productTotalPrice: {
    fontSize: 15,
    fontWeight: "bold",
    color: "#3498db",
  },
  orderSummary: {
    borderTopWidth: 1,
    borderTopColor: "#f0f0f0",
    paddingTop: 15,
    marginTop: 15,
    alignItems: "flex-end",
  },
  orderSummaryText: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#2c3e50",
    marginBottom: 5,
  },
  orderItemsCount: {
    fontSize: 14,
    color: "#7f8c8d",
  },
  closeButton: {
    backgroundColor: "#3498db",
    padding: 12,
    borderRadius: 10,
    marginTop: 20,
    alignSelf: "center",
    minWidth: 120,
    shadowColor: "#3498db",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
  },
  closeButtonText: {
    color: "white",
    fontWeight: "bold",
    textAlign: "center",
    fontSize: 16,
  },
  noProducts: {
    fontSize: 16,
    color: "#7f8c8d",
    textAlign: "center",
    marginVertical: 30,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    position: "absolute",
    top: 10,
    right: 10,
    zIndex: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  statusBadgeNew: {
    backgroundColor: "#2ecc71",
  },
  statusBadgeDelivering: {
    backgroundColor: "#3498db",
  },
  statusBadgeText: {
    color: "white",
    fontWeight: "bold",
    fontSize: 12,
  },
  deliveryTimeText: {
    color: "#7f8c8d",
    fontSize: 13,
    marginTop: 3,
  },
  orderRestaurantTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#2c3e50",
    marginBottom: 5,
  },
  fullWidthButton: {
    width: "100%",
    marginBottom: 10,
  },
  countdownText: {
    fontWeight: "bold",
    fontSize: 16,
    color: "#ffffff",
  },
  deliveringButton: {
    backgroundColor: "#2ecc71",
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  callButton: {
    backgroundColor: "#2ecc71",
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },
});

export default OrdersScreen;
